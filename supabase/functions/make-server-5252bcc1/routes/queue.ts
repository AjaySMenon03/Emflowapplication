/**
 * EM Flow — Queue Staff Routes (auth required)
 */
import type { Hono } from "npm:hono";
import * as kv from "../kv_store.tsx";
import * as queueLogic from "../queue/index.ts";
import * as whatsapp from "../whatsapp/index.ts";
import { getAuthUser } from "../lib/helpers.ts";
import { notifyPosition3ViaWhatsApp } from "./public.ts";

export function register(app: Hono) {
  app.get("/queue/entries/:locationId", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const locationId = c.req.param("locationId");

      // ── Single batch round-trip for all entries ──────────────────────────────
      const entries = await queueLogic.getLocationEntries(locationId);
      const todayStr = queueLogic.today();

      // ── Fetch location + all queue types in parallel (2 round trips total) ──
      const location = await kv.get(`location:${locationId}`);
      const locBusinessId = location?.business_id;

      let activeQts: any[] = [];
      let serviceIds: string[] = [];
      if (locBusinessId) {
        const [qtIds, svcIds] = await Promise.all([
          kv.get(`business_queue_types:${locBusinessId}`),
          kv.get(`business_services:${locBusinessId}`),
        ]);
        serviceIds = svcIds || [];
        const qtIdList: string[] = qtIds || [];
        if (qtIdList.length > 0) {
          const qtValues = await kv.mget(
            qtIdList.map((id: string) => `queue_type:${id}`),
          );
          activeQts = (qtValues as any[]).filter(
            (qt) =>
              qt && qt.location_id === locationId && qt.status === "active",
          );
        }
      }

      // ── Build service-time map from loaded queue types ────────────────────────
      const qtServiceTimeMap = new Map<string, number>(
        activeQts.map((qt: any) => [qt.id, qt.estimated_service_time || 10]),
      );

      // ── Sort helper ───────────────────────────────────────────────────────────
      const sortEntries = (a: any, b: any) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        if ((a.position || 0) !== (b.position || 0))
          return (a.position || 0) - (b.position || 0);
        return (
          new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()
        );
      };

      // ── Compute positions & ETA entirely in memory (no extra KV reads) ────────
      const waitingRaw = entries.filter((e: any) => e.status === "waiting");
      // Group waiting entries by counter so we can derive per-counter position
      const waitingByCounter = new Map<string, any[]>();
      for (const e of waitingRaw) {
        const list = waitingByCounter.get(e.queue_type_id) || [];
        list.push(e);
        waitingByCounter.set(e.queue_type_id, list);
      }
      waitingByCounter.forEach((list) => list.sort(sortEntries));

      const waiting = waitingRaw
        .map((e: any) => {
          const avgMin = qtServiceTimeMap.get(e.queue_type_id) || 10;
          const list = waitingByCounter.get(e.queue_type_id) || [];
          const idx = list.findIndex((w: any) => w.id === e.id);
          const position = idx >= 0 ? idx + 1 : list.length + 1;
          return { ...e, estimatedMinutes: position * avgMin };
        })
        .sort(sortEntries);

      const next = entries.filter((e: any) => e.status === "next");
      const serving = entries.filter((e: any) => e.status === "serving");
      const completed = entries
        .filter((e: any) =>
          ["served", "no_show", "cancelled"].includes(e.status),
        )
        .sort(
          (a: any, b: any) =>
            new Date(
              b.completed_at || b.cancelled_at || b.created_at,
            ).getTime() -
            new Date(
              a.completed_at || a.cancelled_at || a.created_at,
            ).getTime(),
        )
        .slice(0, 50);

      // ── Compute exhausted service IDs in-memory (no extra KV reads) ──────────
      const exhaustedServiceIds: string[] = [];
      for (const sid of serviceIds) {
        const compatibleCounters = activeQts.filter((qt: any) =>
          (qt.service_ids || []).includes(sid),
        );
        if (compatibleCounters.length === 0) continue;
        const totalCapacity = compatibleCounters.reduce(
          (sum: number, qt: any) => sum + (qt.max_capacity || 1),
          0,
        );
        const compatibleQtIds = new Set(
          compatibleCounters.map((qt: any) => qt.id),
        );
        const servedToday = entries.filter(
          (e: any) =>
            compatibleQtIds.has(e.queue_type_id) &&
            e.status === "served" &&
            (e.joined_at || "").startsWith(todayStr),
        ).length;
        if (servedToday >= totalCapacity) exhaustedServiceIds.push(sid);
      }

      return c.json({ waiting, next, serving, completed, exhaustedServiceIds });
    } catch (err: any) {
      return c.json({ error: `Entries fetch failed: ${err.message}` }, 500);
    }
  });

  app.post("/queue/call-next", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const { queueTypeId, sessionId } = await c.req.json();
      const entry = await queueLogic.callNext({
        queueTypeId,
        sessionId,
        staffAuthUid: user.id,
      });
      if (!entry)
        return c.json({ entry: null, message: "No customers waiting" });
      if (entry.customer_phone) {
        const business = await kv.get(`business:${entry.business_id}`);
        whatsapp
          .sendYourTurnNotification({
            businessId: entry.business_id,
            entryId: entry.id,
            customerId: entry.customer_id,
            phone: entry.customer_phone,
            locale: "en",
            customerName: entry.customer_name || "Customer",
            ticketNumber: entry.ticket_number,
            queueName: entry.queue_type_name || "Queue",
            businessName: business?.name,
          })
          .catch((err: any) =>
            console.log(`[WhatsApp call-next] Error: ${err.message}`),
          );
      }
      notifyPosition3ViaWhatsApp(
        entry.queue_type_id,
        entry.queue_session_id,
      ).catch((err: any) =>
        console.error(`[Position3 notify] Error: ${err.message}`),
      );
      return c.json({ entry });
    } catch (err: any) {
      return c.json({ error: `Call next failed: ${err.message}` }, 500);
    }
  });

  app.post("/queue/start-serving/:entryId", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const entry = await queueLogic.startServing(
        c.req.param("entryId"),
        user.id,
      );
      return c.json({ entry });
    } catch (err: any) {
      return c.json({ error: `Start serving failed: ${err.message}` }, 500);
    }
  });

  app.post("/queue/mark-served/:entryId", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const entry = await queueLogic.markServed(c.req.param("entryId"));
      return c.json({ entry });
    } catch (err: any) {
      return c.json({ error: `Mark served failed: ${err.message}` }, 500);
    }
  });

  app.post("/queue/mark-noshow/:entryId", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const entry = await queueLogic.markNoShow(c.req.param("entryId"));
      return c.json({ entry });
    } catch (err: any) {
      return c.json({ error: `Mark no-show failed: ${err.message}` }, 500);
    }
  });

  app.post("/queue/move/:entryId", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const { newPosition } = await c.req.json();
      await queueLogic.moveEntry(c.req.param("entryId"), newPosition);
      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: `Move entry failed: ${err.message}` }, 500);
    }
  });

  app.post("/queue/reassign/:entryId", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const { newStaffAuthUid } = await c.req.json();
      const entry = await queueLogic.reassignStaff(
        c.req.param("entryId"),
        newStaffAuthUid,
      );
      return c.json({ entry });
    } catch (err: any) {
      return c.json({ error: `Reassign failed: ${err.message}` }, 500);
    }
  });

  app.get("/queue/types/:locationId", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const locationId = c.req.param("locationId");
      const staffRecord = await kv.get(`staff_user:${user.id}`);
      if (!staffRecord) return c.json({ error: "Staff record not found" }, 403);
      const queueTypes = await queueLogic.getQueueTypesForLocation(
        locationId,
        staffRecord.business_id,
      );
      return c.json({ queueTypes });
    } catch (err: any) {
      return c.json({ error: `Queue types fetch failed: ${err.message}` }, 500);
    }
  });

  app.post("/queue/session", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const { queueTypeId, locationId, businessId } = await c.req.json();
      const session = await queueLogic.getOrCreateTodaySession(
        queueTypeId,
        locationId,
        businessId,
      );
      return c.json({ session });
    } catch (err: any) {
      return c.json({ error: `Session fetch failed: ${err.message}` }, 500);
    }
  });

  app.post("/queue/session-smart", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const { queueTypeId, locationId, businessId, skipBusinessHoursCheck } =
        await c.req.json();
      const result = await queueLogic.getOrCreateTodaySessionSmart(
        queueTypeId,
        locationId,
        businessId,
        { skipBusinessHoursCheck: !!skipBusinessHoursCheck },
      );
      return c.json(result);
    } catch (err: any) {
      return c.json(
        { error: `Smart session fetch failed: ${err.message}` },
        500,
      );
    }
  });

  app.post("/queue/cancel-enhanced/:entryId", async (c: any) => {
    try {
      const entryId = c.req.param("entryId");
      let staffAuthUid: string | undefined;
      const user = await getAuthUser(c);
      if (user) staffAuthUid = user.id;
      const result = await queueLogic.cancelEntryEnhanced(
        entryId,
        staffAuthUid,
      );
      return c.json(result);
    } catch (err: any) {
      return c.json(
        { error: `Cancel failed: ${err.message}` },
        err.message.includes("Cannot cancel") || err.message.includes("already")
          ? 400
          : 500,
      );
    }
  });

  app.post("/queue/auto-noshow/:locationId", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const locationId = c.req.param("locationId");
      const body = await c.req.json().catch(() => ({}));
      const timeoutMinutes = body.timeoutMinutes || 10;
      const result = await queueLogic.processAutoNoShows(
        locationId,
        timeoutMinutes,
      );
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: `Auto no-show failed: ${err.message}` }, 500);
    }
  });

  app.post("/queue/mark-previous-served", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const { queueTypeId, sessionId } = await c.req.json();
      const entry = await queueLogic.markPreviousAsServed({
        queueTypeId,
        sessionId,
        staffAuthUid: user.id,
      });
      if (!entry)
        return c.json({ entry: null, message: "No previous entry to mark" });
      return c.json({ entry });
    } catch (err: any) {
      return c.json(
        { error: `Mark previous served failed: ${err.message}` },
        500,
      );
    }
  });

  // Session lifecycle (staff auth)
  app.post("/queue/session/close/:sessionId", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const staffRecord = await kv.get(`staff_user:${user.id}`);
      if (
        !staffRecord ||
        (staffRecord.role !== "owner" && staffRecord.role !== "admin")
      )
        return c.json({ error: "Only owners/admins can close sessions" }, 403);
      const sessionId = c.req.param("sessionId");
      const body = await c.req.json().catch(() => ({}));
      const result = await queueLogic.closeSession(
        sessionId,
        body.reason || "Manually closed by staff",
      );
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: `Session close failed: ${err.message}` }, 500);
    }
  });

  app.post("/queue/session/close-all/:locationId", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const staffRecord = await kv.get(`staff_user:${user.id}`);
      if (
        !staffRecord ||
        (staffRecord.role !== "owner" && staffRecord.role !== "admin")
      )
        return c.json(
          { error: "Only owners/admins can close all sessions" },
          403,
        );
      const locationId = c.req.param("locationId");
      const body = await c.req.json().catch(() => ({}));
      const result = await queueLogic.closeAllSessionsForLocation(
        locationId,
        body.reason || "Manually closed all sessions",
      );
      return c.json(result);
    } catch (err: any) {
      return c.json(
        { error: `Close all sessions failed: ${err.message}` },
        500,
      );
    }
  });

  app.post("/queue/session/archive/:locationId", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const staffRecord = await kv.get(`staff_user:${user.id}`);
      if (!staffRecord || staffRecord.role !== "owner")
        return c.json({ error: "Only owners can archive sessions" }, 403);
      const locationId = c.req.param("locationId");
      const body = await c.req.json().catch(() => ({}));
      const daysOld = body.daysOld || 30;
      const result = await queueLogic.archiveOldSessions(locationId, daysOld);
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: `Archive sessions failed: ${err.message}` }, 500);
    }
  });
}

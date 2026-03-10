/**
 * Quecumber — Customer Portal Routes (customer-facing, auth required)
 */
import type { Hono } from "npm:hono";
import * as kv from "../kv_store.tsx";
import { getAuthUser, now } from "../lib/helpers.ts";

export function register(app: Hono) {
  app.post("/customer/register", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const body = await c.req.json();
      const { name, phone, preferredLanguage } = body;
      let customer = await kv.get(`customer:${user.id}`);
      if (customer) return c.json({ customer, created: false });
      customer = {
        id: user.id,
        auth_user_id: user.id,
        name:
          name ||
          user.user_metadata?.name ||
          user.email?.split("@")[0] ||
          "Customer",
        phone: phone || user.phone || null,
        email: user.email || null,
        preferred_language: preferredLanguage || "en",
        created_at: now(),
        updated_at: now(),
      };
      await kv.set(`customer:${user.id}`, customer);
      return c.json({ customer, created: true });
    } catch (err: any) {
      return c.json(
        { error: `Customer registration failed: ${err.message}` },
        500,
      );
    }
  });

  app.get("/customer/profile", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const customer = await kv.get(`customer:${user.id}`);
      return c.json({ customer: customer || null });
    } catch (err: any) {
      return c.json({ error: `Profile fetch failed: ${err.message}` }, 500);
    }
  });

  app.put("/customer/profile", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      let customer = await kv.get(`customer:${user.id}`);
      if (!customer)
        customer = {
          id: user.id,
          auth_user_id: user.id,
          name: "",
          phone: null,
          email: user.email || null,
          preferred_language: "en",
          created_at: now(),
          updated_at: now(),
        };
      const body = await c.req.json();
      if (body.name !== undefined) customer.name = body.name;
      if (body.phone !== undefined) customer.phone = body.phone;
      if (body.preferredLanguage !== undefined)
        customer.preferred_language = body.preferredLanguage;
      customer.updated_at = now();
      await kv.set(`customer:${user.id}`, customer);
      return c.json({ customer });
    } catch (err: any) {
      return c.json({ error: `Profile update failed: ${err.message}` }, 500);
    }
  });

  app.get("/customer/summary", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const entryIds: string[] =
        (await kv.get(`customer_entries:${user.id}`)) || [];
      if (entryIds.length === 0)
        return c.json({
          totalVisits: 0,
          avgWaitTime: 0,
          avgServiceTime: 0,
          noShowCount: 0,
          noShowRate: 0,
          cancelledCount: 0,
          lastVisitDate: null,
          mostUsedService: null,
          daysSinceLastVisit: null,
        });
      const entries = [];
      for (const eid of entryIds) {
        const entry = await kv.get(`queue_entry:${eid}`);
        if (entry) entries.push(entry);
      }
      let totalWaitMs = 0,
        waitCount = 0,
        totalServiceMs = 0,
        serviceCount = 0,
        noShowCount = 0,
        cancelledCount = 0;
      let lastVisitDate: string | null = null;
      const svcMap: Record<string, { name: string; count: number }> = {};
      for (const e of entries) {
        if (e.called_at && e.joined_at) {
          const w =
            new Date(e.called_at).getTime() - new Date(e.joined_at).getTime();
          if (w > 0) {
            totalWaitMs += w;
            waitCount++;
          }
        }
        if (e.served_at && e.called_at) {
          const s =
            new Date(e.served_at).getTime() - new Date(e.called_at).getTime();
          if (s > 0) {
            totalServiceMs += s;
            serviceCount++;
          }
        }
        if (e.status === "no_show") noShowCount++;
        if (e.status === "cancelled") cancelledCount++;
        const d = e.served_at || e.joined_at;
        if (d && (!lastVisitDate || d > lastVisitDate)) lastVisitDate = d;
        const qtId = e.queue_type_id || "general";
        if (!svcMap[qtId])
          svcMap[qtId] = { name: e.queue_type_name || "General", count: 0 };
        svcMap[qtId].count++;
      }
      let mostUsedService: { id: string; name: string; count: number } | null =
        null;
      for (const [id, data] of Object.entries(svcMap)) {
        if (!mostUsedService || data.count > mostUsedService.count)
          mostUsedService = { id, name: data.name, count: data.count };
      }
      const daysSinceLastVisit = lastVisitDate
        ? Math.floor(
            (Date.now() - new Date(lastVisitDate).getTime()) / 86400000,
          )
        : null;
      return c.json({
        totalVisits: entries.length,
        avgWaitTime:
          waitCount > 0 ? Math.round(totalWaitMs / waitCount / 60000) : 0,
        avgServiceTime:
          serviceCount > 0
            ? Math.round(totalServiceMs / serviceCount / 60000)
            : 0,
        noShowCount,
        noShowRate:
          entries.length > 0
            ? Math.round((noShowCount / entries.length) * 100)
            : 0,
        cancelledCount,
        lastVisitDate,
        mostUsedService,
        daysSinceLastVisit,
      });
    } catch (err: any) {
      return c.json({ error: `Summary fetch failed: ${err.message}` }, 500);
    }
  });

  app.get("/customer/history", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const entryIds: string[] =
        (await kv.get(`customer_entries:${user.id}`)) || [];
      const limit = parseInt(c.req.query("limit") || "15", 10);
      const offset = parseInt(c.req.query("offset") || "0", 10);
      const locationFilter = c.req.query("locationId") || undefined;
      const serviceFilter = c.req.query("queueTypeId") || undefined;
      const startDate = c.req.query("startDate") || undefined;
      const endDate = c.req.query("endDate") || undefined;
      const allEntries = [];
      for (const eid of entryIds) {
        const entry = await kv.get(`queue_entry:${eid}`);
        if (entry) allEntries.push(entry);
      }
      allEntries.sort(
        (a: any, b: any) =>
          new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime(),
      );
      let filtered = allEntries;
      if (locationFilter)
        filtered = filtered.filter(
          (e: any) => e.location_id === locationFilter,
        );
      if (serviceFilter)
        filtered = filtered.filter(
          (e: any) => e.queue_type_id === serviceFilter,
        );
      if (startDate) {
        const s = new Date(startDate).getTime();
        filtered = filtered.filter(
          (e: any) => new Date(e.joined_at).getTime() >= s,
        );
      }
      if (endDate) {
        const ed = new Date(endDate).getTime() + 86400000;
        filtered = filtered.filter(
          (e: any) => new Date(e.joined_at).getTime() < ed,
        );
      }
      const locationCache: Record<string, string> = {};
      const paginated = filtered.slice(offset, offset + limit);
      for (const entry of paginated) {
        if (entry.location_id && !locationCache[entry.location_id]) {
          const loc = await kv.get(`location:${entry.location_id}`);
          locationCache[entry.location_id] = loc?.name || "Unknown";
        }
        (entry as any).location_name =
          locationCache[entry.location_id] || "Unknown";
      }
      const locationSet = new Map<string, string>();
      const serviceSet = new Map<string, string>();
      for (const entry of allEntries) {
        if (entry.location_id && !locationSet.has(entry.location_id)) {
          if (!locationCache[entry.location_id]) {
            const loc = await kv.get(`location:${entry.location_id}`);
            locationCache[entry.location_id] = loc?.name || "Unknown";
          }
          locationSet.set(entry.location_id, locationCache[entry.location_id]);
        }
        if (entry.queue_type_id)
          serviceSet.set(
            entry.queue_type_id,
            entry.queue_type_name || "General",
          );
      }
      return c.json({
        entries: paginated,
        total: filtered.length,
        offset,
        limit,
        filters: {
          locations: Array.from(locationSet.entries()).map(([id, name]) => ({
            id,
            name,
          })),
          services: Array.from(serviceSet.entries()).map(([id, name]) => ({
            id,
            name,
          })),
        },
      });
    } catch (err: any) {
      return c.json({ error: `History fetch failed: ${err.message}` }, 500);
    }
  });

  app.get("/customer/autofill", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ customer: null });
      const customer = await kv.get(`customer:${user.id}`);
      if (customer)
        return c.json({
          customer: {
            name: customer.name,
            phone: customer.phone,
            email: customer.email || user.email,
            preferred_language: customer.preferred_language,
          },
          isReturning: true,
        });
      return c.json({
        customer: {
          name: user.user_metadata?.name || "",
          phone: user.phone || "",
          email: user.email || "",
          preferred_language: "en",
        },
        isReturning: false,
      });
    } catch (err: any) {
      return c.json({ error: `Autofill check failed: ${err.message}` }, 500);
    }
  });
}

/**
 * Quecumber — Kiosk Routes
 */
import type { Hono } from "npm:hono";
import * as kv from "../kv_store.tsx";
import * as queueLogic from "../queue/index.ts";
import * as whatsapp from "../whatsapp/index.ts";
import { supabaseAdmin, getAuthUser } from "../lib/helpers.ts";

export function register(app: Hono) {
  app.post("/kiosk/verify-pin", async (c: any) => {
    try {
      const { locationId, pin } = await c.req.json();
      if (!locationId || !pin)
        return c.json({ error: "locationId and pin are required" }, 400);
      const location = await kv.get(`location:${locationId}`);
      if (!location) return c.json({ error: "Location not found" }, 404);
      if (!location.kiosk_pin)
        return c.json(
          { error: "No kiosk PIN configured", code: "NO_PIN_SET" },
          400,
        );
      if (location.kiosk_pin !== pin)
        return c.json({ error: "Invalid PIN", valid: false }, 403);
      return c.json({ valid: true });
    } catch (err: any) {
      return c.json({ error: `PIN verification failed: ${err.message}` }, 500);
    }
  });

  app.post("/kiosk/authenticate", async (c: any) => {
    try {
      const { email, password, locationId } = await c.req.json();
      if (!email || !password || !locationId)
        return c.json(
          { error: "email, password, and locationId are required" },
          400,
        );
      const supabase = supabaseAdmin();
      const { data: signInData, error: signInError } =
        await supabase.auth.signInWithPassword({ email, password });
      if (signInError || !signInData?.user)
        return c.json(
          {
            error: `Authentication failed: ${signInError?.message || "Invalid credentials"}`,
          },
          401,
        );
      const staffRecord = await kv.get(`staff_user:${signInData.user.id}`);
      if (!staffRecord)
        return c.json({ error: "Not authorized: no staff record found" }, 403);
      if (!["owner", "admin", "staff"].includes(staffRecord.role))
        return c.json(
          { error: `Role '${staffRecord.role}' not authorized` },
          403,
        );
      const location = await kv.get(`location:${locationId}`);
      if (!location) return c.json({ error: "Location not found" }, 404);
      if (location.business_id !== staffRecord.business_id)
        return c.json({ error: "Staff not authorized for this business" }, 403);
      return c.json({
        accessToken: signInData.session?.access_token,
        staff: {
          name: staffRecord.name,
          role: staffRecord.role,
          email: staffRecord.email,
        },
      });
    } catch (err: any) {
      return c.json({ error: `Kiosk auth failed: ${err.message}` }, 500);
    }
  });

  app.post("/kiosk/call-next", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const staffRecord = await kv.get(`staff_user:${user.id}`);
      if (
        !staffRecord ||
        !["owner", "admin", "staff"].includes(staffRecord.role)
      )
        return c.json({ error: "Not authorized" }, 403);
      const { locationId } = await c.req.json();
      if (!locationId) return c.json({ error: "locationId is required" }, 400);
      const location = await kv.get(`location:${locationId}`);
      if (!location || location.business_id !== staffRecord.business_id)
        return c.json({ error: "Not authorized for this location" }, 403);
      const entries = await queueLogic.getLocationEntries(locationId);
      const waitingEntries = entries
        .filter((e: any) => e.status === "waiting")
        .sort((a: any, b: any) => {
          if (b.priority !== a.priority) return b.priority - a.priority;
          if ((a.position || 0) !== (b.position || 0))
            return (a.position || 0) - (b.position || 0);
          return (
            new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()
          );
        });
      if (waitingEntries.length === 0)
        return c.json({ entry: null, message: "No customers waiting" });
      const nextEntry = waitingEntries[0];
      const entry = await queueLogic.callNext({
        queueTypeId: nextEntry.queue_type_id,
        sessionId: nextEntry.session_id,
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
            console.log(`[WhatsApp kiosk] Error: ${err.message}`),
          );
      }
      return c.json({ entry });
    } catch (err: any) {
      return c.json({ error: `Kiosk call-next failed: ${err.message}` }, 500);
    }
  });

  app.post("/kiosk/mark-served/:entryId", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const staffRecord = await kv.get(`staff_user:${user.id}`);
      if (
        !staffRecord ||
        !["owner", "admin", "staff"].includes(staffRecord.role)
      )
        return c.json({ error: "Not authorized" }, 403);
      const entry = await queueLogic.markServed(c.req.param("entryId"));
      return c.json({ entry });
    } catch (err: any) {
      return c.json({ error: `Kiosk mark-served failed: ${err.message}` }, 500);
    }
  });

  app.post("/kiosk/mark-noshow/:entryId", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const staffRecord = await kv.get(`staff_user:${user.id}`);
      if (
        !staffRecord ||
        !["owner", "admin", "staff"].includes(staffRecord.role)
      )
        return c.json({ error: "Not authorized" }, 403);
      const entry = await queueLogic.markNoShow(c.req.param("entryId"));
      return c.json({ entry });
    } catch (err: any) {
      return c.json({ error: `Kiosk mark-noshow failed: ${err.message}` }, 500);
    }
  });
}

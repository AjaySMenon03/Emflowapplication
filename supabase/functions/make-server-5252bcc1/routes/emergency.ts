/**
 * EM Flow — Emergency Controls Routes (owner-only)
 */
import type { Hono } from "npm:hono";
import * as kv from "../kv_store.tsx";
import * as queueLogic from "../queue/index.ts";
import { getAuthUser, now } from "../lib/helpers.ts";

export function register(app: Hono) {
    app.get("/emergency/status/:locationId", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const locationId = c.req.param("locationId");
            const emergency = (await kv.get(`emergency:${locationId}`)) || { paused: false, broadcast: null, paused_at: null, broadcast_at: null };
            return c.json({ emergency });
        } catch (err: any) { return c.json({ error: `Emergency status fetch failed: ${err.message}` }, 500); }
    });

    app.post("/emergency/pause/:locationId", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord || staffRecord.role !== "owner") return c.json({ error: "Only owners can use emergency controls" }, 403);
            const locationId = c.req.param("locationId");
            const body = await c.req.json().catch(() => ({}));
            const shouldPause = body.pause !== undefined ? !!body.pause : true;
            const existing = (await kv.get(`emergency:${locationId}`)) || { paused: false, broadcast: null, paused_at: null, broadcast_at: null };
            existing.paused = shouldPause; existing.paused_at = shouldPause ? now() : null;
            await kv.set(`emergency:${locationId}`, existing);
            await queueLogic.writeAuditLog({ locationId, businessId: staffRecord.business_id, eventType: shouldPause ? "EMERGENCY_PAUSE" : "EMERGENCY_RESUME", actorName: staffRecord.name, actorId: user.id, details: shouldPause ? "Queue paused — new joins blocked" : "Queue resumed — joins re-enabled" });
            const counter = ((await kv.get(`realtime_counter:${locationId}`)) || 0) + 1;
            await kv.set(`realtime_counter:${locationId}`, counter);
            await kv.set(`realtime_event:${locationId}`, { type: shouldPause ? "EMERGENCY_PAUSE" : "EMERGENCY_RESUME", timestamp: now() });
            return c.json({ emergency: existing });
        } catch (err: any) { return c.json({ error: `Emergency pause failed: ${err.message}` }, 500); }
    });

    app.post("/emergency/close/:locationId", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord || staffRecord.role !== "owner") return c.json({ error: "Only owners can use emergency close" }, 403);
            const locationId = c.req.param("locationId");
            const entries = await queueLogic.getLocationEntries(locationId);
            const waitingEntries = entries.filter((e: any) => e.status === "waiting");
            let cancelledCount = 0;
            for (const entry of waitingEntries) {
                try { const updated = await kv.get(`queue_entry:${entry.id}`); if (updated && updated.status === "waiting") { updated.status = "cancelled"; updated.cancelled_at = now(); updated.notes = (updated.notes || "") + " [Emergency close by owner]"; await kv.set(`queue_entry:${entry.id}`, updated); cancelledCount++; } } catch { }
            }
            const closeResult = await queueLogic.closeAllSessionsForLocation(locationId, "Emergency close by owner");
            const existing = (await kv.get(`emergency:${locationId}`)) || {}; existing.paused = true; existing.paused_at = now();
            await kv.set(`emergency:${locationId}`, existing);
            await queueLogic.writeAuditLog({ locationId, businessId: staffRecord.business_id, eventType: "EMERGENCY_CLOSE", actorName: staffRecord.name, actorId: user.id, details: `Emergency close: ${cancelledCount} waiting entries cancelled, ${closeResult.closedCount || 0} sessions closed` });
            const counter = ((await kv.get(`realtime_counter:${locationId}`)) || 0) + 1;
            await kv.set(`realtime_counter:${locationId}`, counter);
            await kv.set(`realtime_event:${locationId}`, { type: "EMERGENCY_CLOSE", timestamp: now() });
            return c.json({ cancelledEntries: cancelledCount, closedSessions: closeResult.closedCount || 0, emergency: existing });
        } catch (err: any) { return c.json({ error: `Emergency close failed: ${err.message}` }, 500); }
    });

    app.post("/emergency/broadcast/:locationId", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord || staffRecord.role !== "owner") return c.json({ error: "Only owners can broadcast notices" }, 403);
            const locationId = c.req.param("locationId"); const body = await c.req.json();
            const message = body.message?.trim() || null;
            const existing = (await kv.get(`emergency:${locationId}`)) || { paused: false, broadcast: null, paused_at: null, broadcast_at: null };
            existing.broadcast = message; existing.broadcast_at = message ? now() : null;
            await kv.set(`emergency:${locationId}`, existing);
            await queueLogic.writeAuditLog({ locationId, businessId: staffRecord.business_id, eventType: message ? "EMERGENCY_BROADCAST" : "EMERGENCY_BROADCAST_CLEAR", actorName: staffRecord.name, actorId: user.id, details: message ? `Broadcast notice: "${message}"` : "Broadcast notice cleared" });
            const counter = ((await kv.get(`realtime_counter:${locationId}`)) || 0) + 1;
            await kv.set(`realtime_counter:${locationId}`, counter);
            await kv.set(`realtime_event:${locationId}`, { type: message ? "EMERGENCY_BROADCAST" : "EMERGENCY_BROADCAST_CLEAR", timestamp: now() });
            return c.json({ emergency: existing });
        } catch (err: any) { return c.json({ error: `Broadcast failed: ${err.message}` }, 500); }
    });
}

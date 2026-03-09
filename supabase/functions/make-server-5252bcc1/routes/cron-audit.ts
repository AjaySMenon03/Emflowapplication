/**
 * EM Flow — Cron & Audit Routes
 */
import type { Hono } from "npm:hono";
import * as kv from "../kv_store.tsx";
import * as queueLogic from "../queue/index.ts";
import { getAuthUser } from "../lib/helpers.ts";

export function register(app: Hono) {
    // Audit log
    app.get("/audit/:locationId", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord || staffRecord.role !== "owner") return c.json({ error: "Only owners can view audit logs" }, 403);
            const locationId = c.req.param("locationId");
            const startDate = c.req.query("startDate") || undefined;
            const endDate = c.req.query("endDate") || undefined;
            const eventType = c.req.query("eventType") || undefined;
            const staffId = c.req.query("staffId") || undefined;
            const limit = parseInt(c.req.query("limit") || "50", 10);
            const offset = parseInt(c.req.query("offset") || "0", 10);
            const result = await queueLogic.readAuditLog({ locationId, startDate, endDate, eventType: eventType as any, staffId, limit, offset });
            return c.json(result);
        } catch (err: any) { return c.json({ error: `Audit log fetch failed: ${err.message}` }, 500); }
    });

    // Auto-close expired sessions (cron)
    app.post("/cron/auto-close-sessions", async (c: any) => {
        try {
            const authHeader = c.req.header("Authorization")?.split(" ")[1];
            const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
            let isAuthorized = false;
            if (authHeader === serviceRoleKey) isAuthorized = true;
            else { const user = await getAuthUser(c); if (user) { const staffRecord = await kv.get(`staff_user:${user.id}`); if (staffRecord && (staffRecord.role === "owner" || staffRecord.role === "admin")) isAuthorized = true; } }
            if (!isAuthorized) return c.json({ error: "Unauthorized for cron operation" }, 401);
            const body = await c.req.json().catch(() => ({}));
            const { businessId } = body;
            if (!businessId) return c.json({ error: "businessId is required" }, 400);
            const result = await queueLogic.autoCloseExpiredSessions(businessId);
            console.log(`[cron/auto-close] Business ${businessId}: processed ${result.locationsProcessed} locations, closed ${result.totalClosed} sessions, cancelled ${result.totalCancelled} entries`);
            return c.json(result);
        } catch (err: any) { return c.json({ error: `Auto-close cron failed: ${err.message}` }, 500); }
    });

    // Midnight rotation (cron)
    app.post("/cron/midnight-rotation/:locationId", async (c: any) => {
        try {
            const authHeader = c.req.header("Authorization")?.split(" ")[1];
            const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
            let isAuthorized = false;
            if (authHeader === serviceRoleKey) isAuthorized = true;
            else { const user = await getAuthUser(c); if (user) { const staffRecord = await kv.get(`staff_user:${user.id}`); if (staffRecord && (staffRecord.role === "owner" || staffRecord.role === "admin")) isAuthorized = true; } }
            if (!isAuthorized) return c.json({ error: "Unauthorized for midnight rotation" }, 401);
            const locationId = c.req.param("locationId");
            const result = await queueLogic.midnightRotation(locationId);
            console.log(`[cron/midnight] Location ${locationId}: closed ${result.closedPrevious} sessions, cancelled ${result.cancelledEntries} entries`);
            return c.json(result);
        } catch (err: any) { return c.json({ error: `Midnight rotation failed: ${err.message}` }, 500); }
    });
}

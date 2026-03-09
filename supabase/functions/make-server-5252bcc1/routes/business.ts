/**
 * EM Flow — Business Routes
 */
import type { Hono } from "npm:hono";
import * as kv from "../kv_store.tsx";
import { getAuthUser } from "../lib/helpers.ts";

export function register(app: Hono) {
    app.get("/business/:id", async (c: any) => {
        try {
            const user = await getAuthUser(c);
            if (!user) return c.json({ error: "Unauthorized" }, 401);
            const businessId = c.req.param("id");
            const business = await kv.get(`business:${businessId}`);
            if (!business) return c.json({ error: "Business not found" }, 404);
            return c.json({ business });
        } catch (err: any) {
            return c.json({ error: `Business fetch failed: ${err.message}` }, 500);
        }
    });

    app.get("/business/:id/locations", async (c: any) => {
        try {
            const user = await getAuthUser(c);
            if (!user) return c.json({ error: "Unauthorized" }, 401);
            const businessId = c.req.param("id");
            const locationIds: string[] = (await kv.get(`business_locations:${businessId}`)) || [];
            const locations: any[] = [];
            for (const lid of locationIds) {
                const loc = await kv.get(`location:${lid}`);
                if (loc) locations.push(loc);
            }
            return c.json({ locations });
        } catch (err: any) {
            return c.json({ error: `Locations fetch failed: ${err.message}` }, 500);
        }
    });

    app.get("/business/:id/staff", async (c: any) => {
        try {
            const user = await getAuthUser(c);
            if (!user) return c.json({ error: "Unauthorized" }, 401);
            const businessId = c.req.param("id");
            const staffIds: string[] = (await kv.get(`business_staff:${businessId}`)) || [];
            const ownerId = await kv.get(`business_owner:${businessId}`);
            const allIds = ownerId ? [ownerId, ...staffIds.filter((s: string) => s !== ownerId)] : staffIds;
            const staff: any[] = [];
            for (const sid of allIds) {
                const record = await kv.get(`staff_user:${sid}`);
                if (record && record.status === "active") {
                    staff.push({
                        auth_user_id: record.auth_user_id, name: record.name,
                        email: record.email, role: record.role, locations: record.locations || [],
                    });
                }
            }
            return c.json({ staff });
        } catch (err: any) {
            return c.json({ error: `Staff list fetch failed: ${err.message}` }, 500);
        }
    });
}

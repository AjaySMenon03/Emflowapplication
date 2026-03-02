/**
 * Business Controller
 */
import { getAuthUser } from "../middleware/auth.js";
import * as kv from "../models/kv-store.js";

// GET /api/business/:id
export async function getBusiness(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const businessId = req.params.id;
        const business = await kv.get(`business:${businessId}`);
        if (!business) return res.status(404).json({ error: "Business not found" });
        return res.json({ business });
    } catch (err) {
        return res.status(500).json({ error: `Business fetch failed: ${err.message}` });
    }
}

// GET /api/business/:id/locations
export async function getLocations(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const businessId = req.params.id;
        const locationIds = (await kv.get(`business_locations:${businessId}`)) || [];
        const locations = [];
        for (const lid of locationIds) {
            const loc = await kv.get(`location:${lid}`);
            if (loc) locations.push(loc);
        }
        return res.json({ locations });
    } catch (err) {
        return res.status(500).json({ error: `Locations fetch failed: ${err.message}` });
    }
}

// GET /api/business/:id/staff
export async function getStaff(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const businessId = req.params.id;
        const staffIds = (await kv.get(`business_staff:${businessId}`)) || [];
        const ownerId = await kv.get(`business_owner:${businessId}`);
        const allIds = ownerId
            ? [ownerId, ...staffIds.filter((s) => s !== ownerId)]
            : staffIds;
        const staff = [];
        for (const sid of allIds) {
            const record = await kv.get(`staff_user:${sid}`);
            if (record && record.status === "active") {
                staff.push({
                    auth_user_id: record.auth_user_id,
                    name: record.name,
                    email: record.email,
                    role: record.role,
                    locations: record.locations || [],
                });
            }
        }
        return res.json({ staff });
    } catch (err) {
        return res.status(500).json({ error: `Staff list fetch failed: ${err.message}` });
    }
}

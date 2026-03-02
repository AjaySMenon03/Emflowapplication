/**
 * Onboarding Controller
 */
import { getAuthUser } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";
import * as kv from "../models/kv-store.js";
import crypto from "crypto";

function uuid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }

// POST /api/onboarding/business
export async function createBusiness(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized while creating business" });

        const body = req.body;
        const businessId = uuid();
        const timestamp = now();

        const business = {
            id: businessId,
            name: body.name,
            slug: (body.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
            industry: body.industry || null,
            phone: body.phone || null,
            email: body.email || user.email,
            address: body.address || null,
            owner_id: user.id,
            status: "active",
            created_at: timestamp,
            updated_at: timestamp,
        };

        await kv.set(`business:${businessId}`, business);

        const staffUser = {
            id: uuid(),
            auth_user_id: user.id,
            business_id: businessId,
            email: user.email,
            name: user.user_metadata?.name || body.ownerName || "",
            role: "owner",
            status: "active",
            locations: [],
            created_at: timestamp,
            updated_at: timestamp,
        };

        await kv.set(`staff_user:${user.id}`, staffUser);
        await kv.set(`business_owner:${businessId}`, user.id);

        return res.json({ business, staffUser });
    } catch (err) {
        return res.status(500).json({ error: `Business creation failed: ${err.message}` });
    }
}

// POST /api/onboarding/location
export async function createLocation(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized while creating location" });

        const body = req.body;
        const locationId = uuid();
        const timestamp = now();
        const slug = (body.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

        const location = {
            id: locationId,
            business_id: body.businessId,
            name: body.name,
            slug,
            address: body.address || null,
            city: body.city || null,
            phone: body.phone || null,
            status: "active",
            timezone: body.timezone || "Europe/Istanbul",
            created_at: timestamp,
            updated_at: timestamp,
        };

        await kv.set(`location:${locationId}`, location);
        await kv.set(`location_slug:${slug}`, locationId);

        const existingLocations = (await kv.get(`business_locations:${body.businessId}`)) || [];
        existingLocations.push(locationId);
        await kv.set(`business_locations:${body.businessId}`, existingLocations);

        const staffRecord = await kv.get(`staff_user:${user.id}`);
        if (staffRecord) {
            staffRecord.locations = [...(staffRecord.locations || []), locationId];
            staffRecord.updated_at = timestamp;
            await kv.set(`staff_user:${user.id}`, staffRecord);
        }

        return res.json({ location });
    } catch (err) {
        return res.status(500).json({ error: `Location creation failed: ${err.message}` });
    }
}

// POST /api/onboarding/queue-types
export async function createQueueTypes(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized while creating queue types" });

        const { businessId, locationId, queueTypes } = req.body;
        const timestamp = now();
        const created = [];

        for (const qt of queueTypes) {
            const queueTypeId = uuid();
            const queueType = {
                id: queueTypeId,
                business_id: businessId,
                location_id: locationId,
                name: qt.name,
                prefix: qt.prefix || qt.name.charAt(0).toUpperCase(),
                description: qt.description || null,
                estimated_service_time: qt.estimatedServiceTime || 10,
                max_capacity: qt.maxCapacity || 100,
                status: "active",
                sort_order: qt.sortOrder || created.length,
                created_at: timestamp,
                updated_at: timestamp,
            };
            await kv.set(`queue_type:${queueTypeId}`, queueType);
            created.push(queueType);
        }

        const existing = (await kv.get(`business_queue_types:${businessId}`)) || [];
        const newIds = created.map((q) => q.id);
        await kv.set(`business_queue_types:${businessId}`, [...existing, ...newIds]);

        return res.json({ queueTypes: created });
    } catch (err) {
        return res.status(500).json({ error: `Queue type creation failed: ${err.message}` });
    }
}

// POST /api/onboarding/business-hours
export async function saveBusinessHours(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized while saving business hours" });

        const body = req.body;
        await kv.set(`business_hours:${body.locationId}`, {
            business_id: body.businessId,
            location_id: body.locationId,
            hours: body.hours,
            updated_at: now(),
        });
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: `Business hours save failed: ${err.message}` });
    }
}

// POST /api/onboarding/whatsapp
export async function saveWhatsApp(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized while saving WhatsApp settings" });

        const body = req.body;
        await kv.set(`whatsapp_settings:${body.businessId}`, {
            business_id: body.businessId,
            enabled: !!body.enabled,
            phone_number: body.phoneNumber || null,
            updated_at: now(),
        });
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: `WhatsApp settings save failed: ${err.message}` });
    }
}

// POST /api/onboarding/staff
export async function createStaff(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized while adding staff" });

        const { businessId, locationId, staffMembers } = req.body;
        const timestamp = now();
        const created = [];
        const supabase = supabaseAdmin();

        for (const member of staffMembers) {
            const { data: authData, error: authError } = await supabase.auth.admin.createUser({
                email: member.email,
                password: member.password || "EMFlow2026!",
                user_metadata: { name: member.name },
                email_confirm: true,
            });

            if (authError) {
                console.log(`Staff creation warning for ${member.email}: ${authError.message}`);
                continue;
            }

            const staffUser = {
                id: uuid(),
                auth_user_id: authData.user.id,
                business_id: businessId,
                email: member.email,
                name: member.name,
                role: member.role || "staff",
                status: "active",
                locations: [locationId],
                created_at: timestamp,
                updated_at: timestamp,
            };

            await kv.set(`staff_user:${authData.user.id}`, staffUser);
            created.push(staffUser);
        }

        const existing = (await kv.get(`business_staff:${businessId}`)) || [];
        const newIds = created.map((s) => s.auth_user_id);
        await kv.set(`business_staff:${businessId}`, [...existing, ...newIds]);

        return res.json({ staff: created });
    } catch (err) {
        return res.status(500).json({ error: `Staff creation failed: ${err.message}` });
    }
}

// POST /api/onboarding/complete
export async function complete(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized while completing onboarding" });

        const staffRecord = await kv.get(`staff_user:${user.id}`);
        if (staffRecord) {
            staffRecord.onboarding_completed = true;
            staffRecord.updated_at = now();
            await kv.set(`staff_user:${user.id}`, staffRecord);
        }

        return res.json({ success: true, redirectTo: "/admin" });
    } catch (err) {
        return res.status(500).json({ error: `Onboarding completion failed: ${err.message}` });
    }
}

/**
 * Settings Controller — CRUD for queue types, staff, business, location, whatsapp, hours
 */
import { getAuthUser } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";
import * as kv from "../models/kv-store.js";
import crypto from "crypto";

function uuid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }

// ── Queue Type CRUD ──

export async function createQueueType(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const staffRecord = await kv.get(`staff_user:${user.id}`);
        if (!staffRecord || (staffRecord.role !== "owner" && staffRecord.role !== "admin"))
            return res.status(403).json({ error: "Only owners/admins can manage queue types" });

        const body = req.body;
        const queueTypeId = uuid();
        const timestamp = now();

        const queueType = {
            id: queueTypeId, business_id: staffRecord.business_id, location_id: body.locationId,
            name: body.name, prefix: body.prefix || body.name.charAt(0).toUpperCase(),
            description: body.description || null, estimated_service_time: body.estimatedServiceTime || 10,
            max_capacity: body.maxCapacity || 100, status: "active",
            sort_order: body.sortOrder || 0, created_at: timestamp, updated_at: timestamp,
        };

        await kv.set(`queue_type:${queueTypeId}`, queueType);
        const existing = (await kv.get(`business_queue_types:${staffRecord.business_id}`)) || [];
        existing.push(queueTypeId);
        await kv.set(`business_queue_types:${staffRecord.business_id}`, existing);

        return res.json({ queueType });
    } catch (err) {
        return res.status(500).json({ error: `Create queue type failed: ${err.message}` });
    }
}

export async function updateQueueType(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const staffRecord = await kv.get(`staff_user:${user.id}`);
        if (!staffRecord || (staffRecord.role !== "owner" && staffRecord.role !== "admin"))
            return res.status(403).json({ error: "Only owners/admins can manage queue types" });

        const id = req.params.id;
        const existing = await kv.get(`queue_type:${id}`);
        if (!existing) return res.status(404).json({ error: "Queue type not found" });

        const body = req.body;
        const updated = {
            ...existing,
            name: body.name ?? existing.name, prefix: body.prefix ?? existing.prefix,
            description: body.description ?? existing.description,
            estimated_service_time: body.estimatedServiceTime ?? existing.estimated_service_time,
            max_capacity: body.maxCapacity ?? existing.max_capacity,
            status: body.status ?? existing.status, sort_order: body.sortOrder ?? existing.sort_order,
            updated_at: now(),
        };

        await kv.set(`queue_type:${id}`, updated);
        return res.json({ queueType: updated });
    } catch (err) {
        return res.status(500).json({ error: `Update queue type failed: ${err.message}` });
    }
}

export async function deleteQueueType(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const staffRecord = await kv.get(`staff_user:${user.id}`);
        if (!staffRecord || staffRecord.role !== "owner")
            return res.status(403).json({ error: "Only owners can delete queue types" });

        const id = req.params.id;
        const existing = await kv.get(`queue_type:${id}`);
        if (!existing) return res.status(404).json({ error: "Queue type not found" });

        existing.status = "inactive";
        existing.updated_at = now();
        await kv.set(`queue_type:${id}`, existing);
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: `Delete queue type failed: ${err.message}` });
    }
}

// ── Staff Management ──

export async function updateStaff(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const staffRecord = await kv.get(`staff_user:${user.id}`);
        if (!staffRecord || staffRecord.role !== "owner")
            return res.status(403).json({ error: "Only owners can manage staff" });

        const targetUid = req.params.authUid;
        const target = await kv.get(`staff_user:${targetUid}`);
        if (!target) return res.status(404).json({ error: "Staff not found" });

        const body = req.body;
        const updated = {
            ...target,
            role: body.role ?? target.role, status: body.status ?? target.status,
            name: body.name ?? target.name, locations: body.locations ?? target.locations,
            updated_at: now(),
        };

        await kv.set(`staff_user:${targetUid}`, updated);
        return res.json({ staff: updated });
    } catch (err) {
        return res.status(500).json({ error: `Update staff failed: ${err.message}` });
    }
}

export async function deleteStaff(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const staffRecord = await kv.get(`staff_user:${user.id}`);
        if (!staffRecord || staffRecord.role !== "owner")
            return res.status(403).json({ error: "Only owners can deactivate staff" });

        const targetUid = req.params.authUid;
        if (targetUid === user.id) return res.status(400).json({ error: "Cannot deactivate yourself" });

        const target = await kv.get(`staff_user:${targetUid}`);
        if (!target) return res.status(404).json({ error: "Staff not found" });

        target.status = "inactive";
        target.updated_at = now();
        await kv.set(`staff_user:${targetUid}`, target);
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: `Deactivate staff failed: ${err.message}` });
    }
}

export async function inviteStaff(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const staffRecord = await kv.get(`staff_user:${user.id}`);
        if (!staffRecord || staffRecord.role !== "owner")
            return res.status(403).json({ error: "Only owners can invite staff" });

        const { email, name, role, locationIds, password } = req.body;
        if (!email || !name) return res.status(400).json({ error: "Email and name are required" });

        const supabase = supabaseAdmin();
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email, password: password || "EMFlow2026!",
            user_metadata: { name }, email_confirm: true,
        });

        if (authError) return res.status(400).json({ error: `Auth error: ${authError.message}` });

        const timestamp = now();
        const newStaff = {
            id: uuid(), auth_user_id: authData.user.id, business_id: staffRecord.business_id,
            email, name, role: role || "staff", status: "active",
            locations: locationIds || staffRecord.locations || [],
            created_at: timestamp, updated_at: timestamp,
        };

        await kv.set(`staff_user:${authData.user.id}`, newStaff);
        const existing = (await kv.get(`business_staff:${staffRecord.business_id}`)) || [];
        existing.push(authData.user.id);
        await kv.set(`business_staff:${staffRecord.business_id}`, existing);

        return res.json({ staff: newStaff });
    } catch (err) {
        return res.status(500).json({ error: `Staff invite failed: ${err.message}` });
    }
}

// ── Business Profile ──

export async function updateBusiness(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const staffRecord = await kv.get(`staff_user:${user.id}`);
        if (!staffRecord || (staffRecord.role !== "owner" && staffRecord.role !== "admin"))
            return res.status(403).json({ error: "Only owners/admins can edit business" });

        const id = req.params.id;
        const business = await kv.get(`business:${id}`);
        if (!business) return res.status(404).json({ error: "Business not found" });

        const body = req.body;
        const updated = {
            ...business,
            name: body.name ?? business.name, phone: body.phone ?? business.phone,
            email: body.email ?? business.email, address: body.address ?? business.address,
            industry: body.industry ?? business.industry, updated_at: now(),
        };
        await kv.set(`business:${id}`, updated);
        return res.json({ business: updated });
    } catch (err) {
        return res.status(500).json({ error: `Update business failed: ${err.message}` });
    }
}

// ── Location Management ──

export async function updateLocation(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const staffRecord = await kv.get(`staff_user:${user.id}`);
        if (!staffRecord || (staffRecord.role !== "owner" && staffRecord.role !== "admin"))
            return res.status(403).json({ error: "Only owners/admins can edit locations" });

        const id = req.params.id;
        const location = await kv.get(`location:${id}`);
        if (!location) return res.status(404).json({ error: "Location not found" });

        const body = req.body;
        const updated = {
            ...location,
            name: body.name ?? location.name, address: body.address ?? location.address,
            city: body.city ?? location.city, phone: body.phone ?? location.phone,
            timezone: body.timezone ?? location.timezone, updated_at: now(),
        };
        await kv.set(`location:${id}`, updated);
        return res.json({ location: updated });
    } catch (err) {
        return res.status(500).json({ error: `Update location failed: ${err.message}` });
    }
}

// ── WhatsApp Config ──

export async function getWhatsAppSettings(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const businessId = req.params.businessId;
        const settings = await kv.get(`whatsapp_settings:${businessId}`);
        return res.json({ settings: settings || { enabled: false, phone_number: null } });
    } catch (err) {
        return res.status(500).json({ error: `WhatsApp settings fetch failed: ${err.message}` });
    }
}

export async function updateWhatsAppSettings(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const staffRecord = await kv.get(`staff_user:${user.id}`);
        if (!staffRecord || (staffRecord.role !== "owner" && staffRecord.role !== "admin"))
            return res.status(403).json({ error: "Only owners/admins can update WhatsApp settings" });

        const businessId = req.params.businessId;
        const body = req.body;
        const settings = {
            business_id: businessId, enabled: !!body.enabled,
            phone_number: body.phoneNumber || null, provider: body.provider || "twilio",
            updated_at: now(),
        };
        await kv.set(`whatsapp_settings:${businessId}`, settings);
        return res.json({ settings });
    } catch (err) {
        return res.status(500).json({ error: `WhatsApp settings update failed: ${err.message}` });
    }
}

// ── Business Hours ──

export async function getBusinessHours(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const locationId = req.params.locationId;
        const hours = await kv.get(`business_hours:${locationId}`);
        return res.json({ hours: hours || null });
    } catch (err) {
        return res.status(500).json({ error: `Failed to fetch business hours: ${err.message}` });
    }
}

export async function updateBusinessHours(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const locationId = req.params.locationId;
        const { businessId, hours } = req.body;

        const staffRecord = await kv.get(`staff_user:${user.id}`);
        if (!staffRecord || staffRecord.business_id !== businessId)
            return res.status(403).json({ error: "Forbidden: not authorized for this business" });
        if (staffRecord.role !== "owner" && staffRecord.role !== "admin")
            return res.status(403).json({ error: "Forbidden: owner or admin role required" });

        const data = { location_id: locationId, business_id: businessId, hours, updated_at: now() };
        await kv.set(`business_hours:${locationId}`, data);
        return res.json({ hours: data });
    } catch (err) {
        return res.status(500).json({ error: `Failed to update business hours: ${err.message}` });
    }
}

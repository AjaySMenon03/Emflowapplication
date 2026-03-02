/**
 * Public Controller — Unauthenticated endpoints for customers/kiosks
 */
import * as kv from "../models/kv-store.js";
import * as queueLogic from "../services/queue.service.js";
import * as whatsapp from "../services/whatsapp.service.js";
import crypto from "crypto";

function uuid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }

// GET /api/public/location/:slug
export async function getLocation(req, res) {
    try {
        const slug = req.params.slug;
        const locationId = await kv.get(`location_slug:${slug}`);
        if (!locationId) return res.status(404).json({ error: "Location not found" });

        const location = await kv.get(`location:${locationId}`);
        if (!location) return res.status(404).json({ error: "Location not found" });

        const business = await kv.get(`business:${location.business_id}`);
        const queueTypes = await queueLogic.getQueueTypesForLocation(locationId, location.business_id);

        return res.json({ location, business, queueTypes });
    } catch (err) {
        return res.status(500).json({ error: `Public location fetch failed: ${err.message}` });
    }
}

// GET /api/public/location-by-id/:id
export async function getLocationById(req, res) {
    try {
        const locationId = req.params.id;
        const location = await kv.get(`location:${locationId}`);
        if (!location) return res.status(404).json({ error: "Location not found" });

        const business = await kv.get(`business:${location.business_id}`);
        const queueTypes = await queueLogic.getQueueTypesForLocation(locationId, location.business_id);

        return res.json({ location, business, queueTypes });
    } catch (err) {
        return res.status(500).json({ error: `Location by ID fetch failed: ${err.message}` });
    }
}

// POST /api/public/queue/join
export async function joinQueue(req, res) {
    try {
        const { queueTypeId, locationId, businessId, name, phone, email, locale } = req.body;

        if (!queueTypeId || !locationId || !businessId) {
            return res.status(400).json({ error: "queueTypeId, locationId, and businessId are required" });
        }
        if (!name?.trim()) {
            return res.status(400).json({ error: "Name is required" });
        }

        let customerId = null;
        if (phone || email) {
            customerId = uuid();
            await kv.set(`customer:${customerId}`, {
                id: customerId,
                auth_user_id: null,
                name: name.trim(),
                phone: phone || null,
                email: email || null,
                preferred_locale: locale || "en",
                created_at: now(),
                updated_at: now(),
            });
        }

        const entry = await queueLogic.createQueueEntry({
            queueTypeId,
            locationId,
            businessId,
            customerId,
            customerName: name.trim(),
            customerPhone: phone || null,
        });

        const position = await queueLogic.calculatePosition(entry.id);
        const eta = await queueLogic.calculateETA(entry.id);

        if (phone) {
            const location = await kv.get(`location:${locationId}`);
            const business = await kv.get(`business:${businessId}`);
            whatsapp.sendJoinConfirmation({
                businessId,
                entryId: entry.id,
                customerId,
                phone,
                locale: locale || "en",
                customerName: name.trim(),
                ticketNumber: entry.ticket_number,
                queueName: entry.queue_type_name || "Queue",
                position: position.position,
                estimatedMinutes: eta.estimatedMinutes,
                businessName: business?.name,
                locationName: location?.name,
            }).catch((err) => console.log(`[WhatsApp join] Error: ${err.message}`));

            await queueLogic.logNotification({
                entryId: entry.id,
                customerId,
                businessId,
                channel: "whatsapp",
                recipient: phone,
                message: `Confirmation: ${entry.ticket_number} — Position #${position.position}, ~${eta.estimatedMinutes} min`,
            });
        }

        return res.json({
            entry,
            position: position.position,
            totalWaiting: position.total,
            estimatedMinutes: eta.estimatedMinutes,
        });
    } catch (err) {
        return res.status(500).json({ error: `Queue join failed: ${err.message}` });
    }
}

// GET /api/public/queue/status/:entryId
export async function getStatus(req, res) {
    try {
        const entryId = req.params.entryId;
        const entry = await kv.get(`queue_entry:${entryId}`);
        if (!entry) return res.status(404).json({ error: "Entry not found" });

        let position = { position: 0, total: 0 };
        let eta = { estimatedMinutes: 0, estimatedTime: "" };

        if (entry.status === "waiting") {
            position = await queueLogic.calculatePosition(entryId);
            eta = await queueLogic.calculateETA(entryId);
        }

        const location = await kv.get(`location:${entry.location_id}`);
        const business = await kv.get(`business:${entry.business_id}`);

        return res.json({
            entry,
            position: position.position,
            totalWaiting: position.total,
            estimatedMinutes: eta.estimatedMinutes,
            location: location ? { name: location.name, address: location.address } : null,
            businessName: business?.name || null,
        });
    } catch (err) {
        return res.status(500).json({ error: `Status fetch failed: ${err.message}` });
    }
}

// POST /api/public/queue/cancel/:entryId
export async function cancelEntry(req, res) {
    try {
        const entryId = req.params.entryId;
        const entry = await queueLogic.cancelEntry(entryId);
        return res.json({ entry });
    } catch (err) {
        return res.status(500).json({ error: `Cancel failed: ${err.message}` });
    }
}

// GET /api/public/queue/entries/:locationId
export async function getPublicEntries(req, res) {
    try {
        const locationId = req.params.locationId;
        const entries = await queueLogic.getLocationEntries(locationId);

        const waiting = entries
            .filter((e) => e.status === "waiting")
            .sort((a, b) => {
                if (b.priority !== a.priority) return b.priority - a.priority;
                return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
            });
        const serving = entries.filter((e) => e.status === "serving");

        return res.json({ waiting, serving });
    } catch (err) {
        return res.status(500).json({ error: `Public entries fetch failed: ${err.message}` });
    }
}

// GET /api/public/business-hours/:locationId
export async function getPublicBusinessHours(req, res) {
    try {
        const locationId = req.params.locationId;
        const hours = await kv.get(`business_hours:${locationId}`);

        if (!hours) {
            return res.json({ hours: null, isOpen: true });
        }

        const nowDate = new Date();
        const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
        const todayKey = dayNames[nowDate.getDay()];
        const todaySchedule = hours.hours?.[todayKey];

        let isOpen = true;
        if (todaySchedule) {
            if (!todaySchedule.open) {
                isOpen = false;
            } else {
                const currentMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
                const [openH, openM] = (todaySchedule.openTime || "09:00").split(":").map(Number);
                const [closeH, closeM] = (todaySchedule.closeTime || "18:00").split(":").map(Number);
                const openMinutes = openH * 60 + openM;
                const closeMinutes = closeH * 60 + closeM;
                isOpen = currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
            }
        }

        return res.json({ hours: hours.hours, isOpen, today: todayKey });
    } catch (err) {
        return res.status(500).json({ error: `Failed to fetch public business hours: ${err.message}` });
    }
}

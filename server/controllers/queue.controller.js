/**
 * Queue Controller — Staff queue operations (auth required)
 */
import { getAuthUser } from "../middleware/auth.js";
import * as kv from "../models/kv-store.js";
import * as queueLogic from "../services/queue.service.js";
import * as whatsapp from "../services/whatsapp.service.js";

// GET /api/queue/entries/:locationId
export async function getEntries(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });

        const locationId = req.params.locationId;
        const entries = await queueLogic.getLocationEntries(locationId);

        const waiting = entries
            .filter((e) => e.status === "waiting")
            .sort((a, b) => {
                if (b.priority !== a.priority) return b.priority - a.priority;
                return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
            });
        const serving = entries.filter((e) => e.status === "serving");
        const completed = entries
            .filter((e) => e.status === "served" || e.status === "no_show" || e.status === "cancelled")
            .sort((a, b) =>
                new Date(b.completed_at || b.cancelled_at || b.created_at).getTime() -
                new Date(a.completed_at || a.cancelled_at || a.created_at).getTime()
            )
            .slice(0, 50);

        return res.json({ waiting, serving, completed });
    } catch (err) {
        return res.status(500).json({ error: `Entries fetch failed: ${err.message}` });
    }
}

// POST /api/queue/call-next
export async function callNext(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });

        const { queueTypeId, sessionId } = req.body;
        const entry = await queueLogic.callNext({
            queueTypeId,
            sessionId,
            staffAuthUid: user.id,
        });

        if (!entry) {
            return res.json({ entry: null, message: "No customers waiting" });
        }

        if (entry.customer_phone) {
            const business = await kv.get(`business:${entry.business_id}`);
            whatsapp.sendYourTurnNotification({
                businessId: entry.business_id,
                entryId: entry.id,
                customerId: entry.customer_id,
                phone: entry.customer_phone,
                locale: "en",
                customerName: entry.customer_name || "Customer",
                ticketNumber: entry.ticket_number,
                queueName: entry.queue_type_name || "Queue",
                businessName: business?.name,
            }).catch((err) => console.log(`[WhatsApp call-next] Error: ${err.message}`));
        }

        return res.json({ entry });
    } catch (err) {
        return res.status(500).json({ error: `Call next failed: ${err.message}` });
    }
}

// POST /api/queue/mark-served/:entryId
export async function markServed(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const entry = await queueLogic.markServed(req.params.entryId);
        return res.json({ entry });
    } catch (err) {
        return res.status(500).json({ error: `Mark served failed: ${err.message}` });
    }
}

// POST /api/queue/mark-noshow/:entryId
export async function markNoShow(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const entry = await queueLogic.markNoShow(req.params.entryId);
        return res.json({ entry });
    } catch (err) {
        return res.status(500).json({ error: `Mark no-show failed: ${err.message}` });
    }
}

// POST /api/queue/move/:entryId
export async function moveEntry(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const { newPosition } = req.body;
        await queueLogic.moveEntry(req.params.entryId, newPosition);
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: `Move entry failed: ${err.message}` });
    }
}

// POST /api/queue/reassign/:entryId
export async function reassignStaff(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const { newStaffAuthUid } = req.body;
        const entry = await queueLogic.reassignStaff(req.params.entryId, newStaffAuthUid);
        return res.json({ entry });
    } catch (err) {
        return res.status(500).json({ error: `Reassign failed: ${err.message}` });
    }
}

// GET /api/queue/types/:locationId
export async function getQueueTypes(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });

        const locationId = req.params.locationId;
        const staffRecord = await kv.get(`staff_user:${user.id}`);
        if (!staffRecord) return res.status(403).json({ error: "Staff record not found" });

        const queueTypes = await queueLogic.getQueueTypesForLocation(locationId, staffRecord.business_id);
        return res.json({ queueTypes });
    } catch (err) {
        return res.status(500).json({ error: `Queue types fetch failed: ${err.message}` });
    }
}

// POST /api/queue/session
export async function getSession(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        const { queueTypeId, locationId, businessId } = req.body;
        const session = await queueLogic.getOrCreateTodaySession(queueTypeId, locationId, businessId);
        return res.json({ session });
    } catch (err) {
        return res.status(500).json({ error: `Session fetch failed: ${err.message}` });
    }
}

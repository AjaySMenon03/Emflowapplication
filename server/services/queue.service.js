/**
 * EM Flow — Centralized Queue Logic Service
 *
 * Pure business-rule functions. No HTTP handling.
 * All state is persisted via the KV store.
 *
 * Ported from supabase/functions/server/queue-logic.tsx
 */
import * as kv from "../models/kv-store.js";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// ── helpers ──

function uuid() {
    return crypto.randomUUID();
}
function now() {
    return new Date().toISOString();
}
function today() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ──────────────────────────────────────────────
//  1. getOrCreateTodaySession
// ──────────────────────────────────────────────
export async function getOrCreateTodaySession(
    queueTypeId,
    locationId,
    businessId
) {
    const dateStr = today();
    const cacheKey = `queue_session_today:${queueTypeId}:${dateStr}`;

    const existingId = await kv.get(cacheKey);
    if (existingId) {
        const session = await kv.get(`queue_session:${existingId}`);
        if (session && session.session_date === dateStr) return session;
    }

    const sessionId = uuid();
    const session = {
        id: sessionId,
        queue_type_id: queueTypeId,
        location_id: locationId,
        business_id: businessId,
        session_date: dateStr,
        status: "active",
        current_number: 0,
        last_called_number: 0,
        created_at: now(),
        updated_at: now(),
    };

    await kv.set(`queue_session:${sessionId}`, session);
    await kv.set(cacheKey, sessionId);
    return session;
}

// ──────────────────────────────────────────────
//  2. createQueueEntry
// ──────────────────────────────────────────────
export async function createQueueEntry(params) {
    const {
        queueTypeId,
        locationId,
        businessId,
        customerId,
        customerName,
        customerPhone,
        priority = 0,
        notes = null,
    } = params;

    const queueType = await kv.get(`queue_type:${queueTypeId}`);
    if (!queueType) throw new Error(`Queue type ${queueTypeId} not found`);
    if (queueType.status !== "active")
        throw new Error(`Queue type ${queueType.name} is not active`);

    const session = await getOrCreateTodaySession(
        queueTypeId,
        locationId,
        businessId
    );

    const sessionEntries =
        (await kv.get(`session_entries:${session.id}`)) || [];
    const activeCount = await countActiveEntries(sessionEntries);
    if (activeCount >= (queueType.max_capacity || 100)) {
        throw new Error(
            `Queue "${queueType.name}" has reached maximum capacity (${queueType.max_capacity})`
        );
    }

    session.current_number += 1;
    session.updated_at = now();
    await kv.set(`queue_session:${session.id}`, session);

    const ticketNumber = `${queueType.prefix || "Q"}${String(
        session.current_number
    ).padStart(3, "0")}`;

    const waitingAhead = activeCount;
    const estimatedWait =
        waitingAhead * (queueType.estimated_service_time || 10);

    const entryId = uuid();
    const entry = {
        id: entryId,
        queue_session_id: session.id,
        queue_type_id: queueTypeId,
        customer_id: customerId,
        business_id: businessId,
        location_id: locationId,
        ticket_number: ticketNumber,
        status: "waiting",
        priority,
        served_by: null,
        joined_at: now(),
        called_at: null,
        served_at: null,
        completed_at: null,
        cancelled_at: null,
        estimated_wait_minutes: estimatedWait,
        notes: notes || null,
        created_at: now(),
        customer_name: customerName,
        customer_phone: customerPhone,
        queue_type_name: queueType.name,
        queue_type_prefix: queueType.prefix,
    };

    await kv.set(`queue_entry:${entryId}`, entry);

    sessionEntries.push(entryId);
    await kv.set(`session_entries:${session.id}`, sessionEntries);

    const locationEntries =
        (await kv.get(`location_entries:${locationId}`)) || [];
    locationEntries.push(entryId);
    await kv.set(`location_entries:${locationId}`, locationEntries);

    if (customerId) {
        const custEntries =
            (await kv.get(`customer_entries:${customerId}`)) || [];
        custEntries.push(entryId);
        await kv.set(`customer_entries:${customerId}`, custEntries);
    }

    await broadcastChange(businessId, locationId, "entry_created", entry);
    return entry;
}

// ──────────────────────────────────────────────
//  3. calculatePosition
// ──────────────────────────────────────────────
export async function calculatePosition(entryId) {
    const entry = await kv.get(`queue_entry:${entryId}`);
    if (!entry) throw new Error(`Entry ${entryId} not found`);

    const sessionEntries =
        (await kv.get(`session_entries:${entry.queue_session_id}`)) || [];

    let position = 0;
    let total = 0;

    for (const eid of sessionEntries) {
        const e = await kv.get(`queue_entry:${eid}`);
        if (!e) continue;
        if (e.queue_type_id !== entry.queue_type_id) continue;
        if (e.status === "waiting") {
            total++;
            if (
                e.joined_at < entry.joined_at ||
                (e.joined_at === entry.joined_at && e.priority > entry.priority)
            ) {
                position++;
            }
        }
    }

    if (entry.status === "waiting") {
        position += 1;
    }

    return { position, total };
}

// ──────────────────────────────────────────────
//  4. calculateETA
// ──────────────────────────────────────────────
export async function calculateETA(entryId) {
    const entry = await kv.get(`queue_entry:${entryId}`);
    if (!entry) throw new Error(`Entry ${entryId} not found`);

    const queueType = await kv.get(`queue_type:${entry.queue_type_id}`);
    const serviceTime = queueType?.estimated_service_time || 10;

    const { position } = await calculatePosition(entryId);
    const estimatedMinutes = Math.max(0, (position - 1) * serviceTime);

    const eta = new Date(Date.now() + estimatedMinutes * 60 * 1000);
    const estimatedTime = eta.toISOString();

    return { estimatedMinutes, estimatedTime };
}

// ──────────────────────────────────────────────
//  5. callNext
// ──────────────────────────────────────────────
export async function callNext(params) {
    const { queueTypeId, sessionId, staffAuthUid } = params;

    const sessionEntries =
        (await kv.get(`session_entries:${sessionId}`)) || [];

    for (const eid of sessionEntries) {
        const e = await kv.get(`queue_entry:${eid}`);
        if (e && e.queue_type_id === queueTypeId && e.status === "serving") {
            throw new Error(
                `There is already a customer being served in this queue (${e.ticket_number}). Complete or skip them first.`
            );
        }
    }

    let candidates = [];
    for (const eid of sessionEntries) {
        const e = await kv.get(`queue_entry:${eid}`);
        if (e && e.queue_type_id === queueTypeId && e.status === "waiting") {
            candidates.push(e);
        }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
    });

    const next = candidates[0];
    next.status = "serving";
    next.called_at = now();
    next.served_by = staffAuthUid;

    await kv.set(`queue_entry:${next.id}`, next);

    const session = await kv.get(`queue_session:${sessionId}`);
    if (session) {
        const num = parseInt(next.ticket_number.replace(/[^0-9]/g, ""), 10);
        session.last_called_number = num || session.last_called_number + 1;
        session.updated_at = now();
        await kv.set(`queue_session:${sessionId}`, session);
    }

    await broadcastChange(
        next.business_id,
        next.location_id,
        "entry_called",
        next
    );

    return next;
}

// ──────────────────────────────────────────────
//  6. markServed
// ──────────────────────────────────────────────
export async function markServed(entryId) {
    const entry = await kv.get(`queue_entry:${entryId}`);
    if (!entry) throw new Error(`Entry ${entryId} not found`);
    if (entry.status !== "serving")
        throw new Error(
            `Entry ${entry.ticket_number} is not currently being served`
        );

    entry.status = "served";
    entry.served_at = now();
    entry.completed_at = now();

    await kv.set(`queue_entry:${entryId}`, entry);
    await broadcastChange(
        entry.business_id,
        entry.location_id,
        "entry_served",
        entry
    );
    return entry;
}

// ──────────────────────────────────────────────
//  7. markNoShow
// ──────────────────────────────────────────────
export async function markNoShow(entryId) {
    const entry = await kv.get(`queue_entry:${entryId}`);
    if (!entry) throw new Error(`Entry ${entryId} not found`);
    if (entry.status !== "waiting" && entry.status !== "serving")
        throw new Error(
            `Cannot mark ${entry.ticket_number} as no-show (status: ${entry.status})`
        );

    entry.status = "no_show";
    entry.cancelled_at = now();

    await kv.set(`queue_entry:${entryId}`, entry);
    await broadcastChange(
        entry.business_id,
        entry.location_id,
        "entry_noshow",
        entry
    );
    return entry;
}

// ──────────────────────────────────────────────
//  8. cancelEntry
// ──────────────────────────────────────────────
export async function cancelEntry(entryId) {
    const entry = await kv.get(`queue_entry:${entryId}`);
    if (!entry) throw new Error(`Entry ${entryId} not found`);
    if (entry.status !== "waiting")
        throw new Error(`Can only cancel entries with status 'waiting'`);

    entry.status = "cancelled";
    entry.cancelled_at = now();

    await kv.set(`queue_entry:${entryId}`, entry);
    await broadcastChange(
        entry.business_id,
        entry.location_id,
        "entry_cancelled",
        entry
    );
    return entry;
}

// ──────────────────────────────────────────────
//  9. moveEntry
// ──────────────────────────────────────────────
export async function moveEntry(entryId, newPosition) {
    const entry = await kv.get(`queue_entry:${entryId}`);
    if (!entry) throw new Error(`Entry ${entryId} not found`);
    if (entry.status !== "waiting")
        throw new Error("Can only reorder entries that are still waiting");

    const sessionEntries =
        (await kv.get(`session_entries:${entry.queue_session_id}`)) || [];

    const waitingEntries = [];
    for (const eid of sessionEntries) {
        const e = await kv.get(`queue_entry:${eid}`);
        if (
            e &&
            e.queue_type_id === entry.queue_type_id &&
            e.status === "waiting"
        ) {
            waitingEntries.push(e);
        }
    }

    waitingEntries.sort(
        (a, b) =>
            new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()
    );

    const totalWaiting = waitingEntries.length;
    const clampedPos = Math.max(1, Math.min(newPosition, totalWaiting));

    for (let i = 0; i < waitingEntries.length; i++) {
        const e = waitingEntries[i];
        if (e.id === entryId) {
            e.priority = totalWaiting - clampedPos + 1;
        } else {
            e.priority = 0;
        }
        await kv.set(`queue_entry:${e.id}`, e);
    }

    await broadcastChange(
        entry.business_id,
        entry.location_id,
        "entry_moved",
        entry
    );
}

// ──────────────────────────────────────────────
// 10. reassignStaff
// ──────────────────────────────────────────────
export async function reassignStaff(entryId, newStaffAuthUid) {
    const entry = await kv.get(`queue_entry:${entryId}`);
    if (!entry) throw new Error(`Entry ${entryId} not found`);
    if (entry.status !== "serving")
        throw new Error(
            "Can only reassign entries that are currently being served"
        );

    const staffRecord = await kv.get(`staff_user:${newStaffAuthUid}`);
    if (!staffRecord) throw new Error("Target staff member not found");

    if (
        staffRecord.locations &&
        staffRecord.locations.length > 0 &&
        !staffRecord.locations.includes(entry.location_id)
    ) {
        throw new Error("Staff member does not have access to this location");
    }

    entry.served_by = newStaffAuthUid;
    await kv.set(`queue_entry:${entryId}`, entry);

    await broadcastChange(
        entry.business_id,
        entry.location_id,
        "entry_reassigned",
        entry
    );
    return entry;
}

// ──────────────────────────────────────────────
// Helpers — get entries for views
// ──────────────────────────────────────────────

export async function getLocationEntries(locationId) {
    const entryIds = (await kv.get(`location_entries:${locationId}`)) || [];
    const entries = [];
    for (const eid of entryIds) {
        const e = await kv.get(`queue_entry:${eid}`);
        if (e) entries.push(e);
    }
    return entries;
}

export async function getSessionEntries(sessionId) {
    const entryIds = (await kv.get(`session_entries:${sessionId}`)) || [];
    const entries = [];
    for (const eid of entryIds) {
        const e = await kv.get(`queue_entry:${eid}`);
        if (e) entries.push(e);
    }
    return entries;
}

export async function getQueueTypesForLocation(locationId, businessId) {
    const allQtIds =
        (await kv.get(`business_queue_types:${businessId}`)) || [];
    const queueTypes = [];
    for (const qtId of allQtIds) {
        const qt = await kv.get(`queue_type:${qtId}`);
        if (qt && qt.location_id === locationId && qt.status === "active") {
            queueTypes.push(qt);
        }
    }
    queueTypes.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    return queueTypes;
}

// ── count active (waiting + serving) entries ──
async function countActiveEntries(entryIds) {
    let count = 0;
    for (const eid of entryIds) {
        const e = await kv.get(`queue_entry:${eid}`);
        if (e && (e.status === "waiting" || e.status === "serving")) count++;
    }
    return count;
}

// ── Notification log ──
export async function logNotification(params) {
    const id = uuid();
    await kv.set(`notification_log:${id}`, {
        id,
        queue_entry_id: params.entryId,
        customer_id: params.customerId,
        business_id: params.businessId,
        channel: params.channel,
        recipient: params.recipient,
        message: params.message,
        status: "sent",
        sent_at: now(),
        created_at: now(),
    });
}

// ── Broadcast helper ──
async function broadcastChange(businessId, locationId, eventType, entry) {
    const event = {
        type: eventType,
        entry,
        timestamp: now(),
        business_id: businessId,
        location_id: locationId,
    };
    await kv.set(`realtime_event:${locationId}`, event);
    const counter = (await kv.get(`realtime_counter:${locationId}`)) || 0;
    await kv.set(`realtime_counter:${locationId}`, counter + 1);

    // ── Supabase Realtime Broadcast ──
    try {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        const channelName = `queue-events:${locationId}`;
        const channel = supabase.channel(channelName);
        await channel.send({
            type: "broadcast",
            event: "queue_change",
            payload: event,
        });
        await supabase.removeChannel(channel);
    } catch (err) {
        console.log(
            `[Realtime broadcast] Warning: ${err.message || err}`
        );
    }
}

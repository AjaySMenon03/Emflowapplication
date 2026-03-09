/**
 * EM Flow — Audit / System Event Log
 */

import * as kv from "../kv_store.tsx";
import { uuid, now } from "./helpers.ts";
import type { AuditEventType, AuditLogEntry } from "./types.ts";

/**
 * Append an event to the audit log for a location.
 * KV key: audit_log:{locationId} → AuditLogEntry[]
 * Keeps at most 1000 entries (FIFO).
 */
export async function writeAuditLog(params: {
    locationId: string;
    businessId: string;
    eventType: AuditEventType;
    actorName?: string;
    actorId?: string | null;
    customerName?: string | null;
    ticketNumber?: string | null;
    queueTypeName?: string | null;
    queueTypeId?: string | null;
    entryId?: string | null;
    sessionId?: string | null;
    details?: string | null;
}): Promise<void> {
    try {
        const logEntry: AuditLogEntry = {
            id: uuid(),
            timestamp: now(),
            location_id: params.locationId,
            business_id: params.businessId,
            event_type: params.eventType,
            actor: params.actorName || "System",
            actor_id: params.actorId || null,
            customer_name: params.customerName || null,
            ticket_number: params.ticketNumber || null,
            queue_type_name: params.queueTypeName || null,
            queue_type_id: params.queueTypeId || null,
            entry_id: params.entryId || null,
            session_id: params.sessionId || null,
            details: params.details || null,
        };

        const key = `audit_log:${params.locationId}`;
        const existing: AuditLogEntry[] = (await kv.get(key)) || [];
        existing.push(logEntry);

        // Keep at most 1000 recent entries
        const trimmed = existing.length > 1000 ? existing.slice(-1000) : existing;
        await kv.set(key, trimmed);
    } catch (err: any) {
        console.log(`[AuditLog] Warning: failed to write audit log: ${err.message}`);
    }
}

/**
 * Read audit log entries for a location with optional filters.
 */
export async function readAuditLog(params: {
    locationId: string;
    startDate?: string;
    endDate?: string;
    eventType?: AuditEventType;
    staffId?: string;
    limit?: number;
    offset?: number;
}): Promise<{ entries: AuditLogEntry[]; total: number }> {
    const key = `audit_log:${params.locationId}`;
    const allEntries: AuditLogEntry[] = (await kv.get(key)) || [];

    let filtered = allEntries;

    // Filter by date range
    if (params.startDate) {
        filtered = filtered.filter((e) => e.timestamp >= params.startDate!);
    }
    if (params.endDate) {
        // endDate is inclusive — add a day
        const endPlusOne = new Date(params.endDate);
        endPlusOne.setDate(endPlusOne.getDate() + 1);
        const endStr = endPlusOne.toISOString();
        filtered = filtered.filter((e) => e.timestamp < endStr);
    }

    // Filter by event type
    if (params.eventType) {
        filtered = filtered.filter((e) => e.event_type === params.eventType);
    }

    // Filter by staff
    if (params.staffId) {
        filtered = filtered.filter((e) => e.actor_id === params.staffId);
    }

    // Sort newest first
    filtered.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const total = filtered.length;
    const limit = params.limit || 50;
    const offset = params.offset || 0;
    const entries = filtered.slice(offset, offset + limit);

    return { entries, total };
}

// Helper to get staff name for audit logging
export async function getStaffName(staffAuthUid: string): Promise<string> {
    const staff = await kv.get(`staff_user:${staffAuthUid}`);
    return staff?.name || "Unknown Staff";
}

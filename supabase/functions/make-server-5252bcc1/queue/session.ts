/**
 * EM Flow — Session Lifecycle Management
 */

import * as kv from "../kv_store.tsx";
import { uuid, now, today } from "./helpers.ts";
import { withTransaction } from "./transaction.ts";
import { writeAuditLog } from "./audit.ts";
import { checkBusinessHours } from "./business-hours.ts";
import { getQueueTypesForLocation } from "./read-helpers.ts";
import { todayInTimezone } from "./timezone.ts";
import type { QueueSession, BusinessHoursCheck } from "./types.ts";

/**
 * Get or create today's session (simple, no business hours check).
 */
export async function getOrCreateTodaySession(
    queueTypeId: string,
    locationId: string,
    businessId: string
): Promise<QueueSession> {
    const sessionDate = today();
    const cacheKey = `queue_session_today:${queueTypeId}:${sessionDate}`;
    const existingId = await kv.get(cacheKey);

    if (existingId) {
        const session = await kv.get(`queue_session:${existingId}`);
        if (session && session.session_date === sessionDate) {
            return session;
        }
    }

    // Create new session
    const sessionId = uuid();
    const session: QueueSession = {
        id: sessionId,
        queue_type_id: queueTypeId,
        location_id: locationId,
        business_id: businessId,
        session_date: sessionDate,
        status: "open",
        current_number: 0,
        last_called_number: 0,
        created_at: now(),
        updated_at: now(),
    };

    await kv.set(`queue_session:${sessionId}`, session);
    await kv.set(cacheKey, sessionId);
    await indexSessionForLocation(locationId, sessionId);

    return session;
}

/**
 * Index a session under its location for later retrieval.
 */
async function indexSessionForLocation(locationId: string, sessionId: string): Promise<void> {
    const existing: string[] = (await kv.get(`location_sessions:${locationId}`)) || [];
    if (!existing.includes(sessionId)) {
        existing.push(sessionId);
        await kv.set(`location_sessions:${locationId}`, existing);
    }
}

/**
 * Get or create today's session with timezone awareness.
 */
export async function getOrCreateTodaySessionSmart(
    queueTypeId: string,
    locationId: string,
    businessId: string,
    options?: { skipBusinessHoursCheck?: boolean }
): Promise<{ session: QueueSession; businessHours: BusinessHoursCheck }> {
    const location = await kv.get(`location:${locationId}`);
    const timezone = location?.timezone || "UTC";
    const dateStr = todayInTimezone(timezone);

    // Check business hours
    const businessHours = await checkBusinessHours(locationId);

    // Look for existing session for this date
    const cacheKey = `queue_session_location_today:${locationId}:${dateStr}`;
    const existingId = await kv.get(cacheKey);

    if (existingId) {
        const session = await kv.get(`queue_session:${existingId}`);
        if (session && session.session_date === dateStr) {
            return { session, businessHours };
        }
    }

    // No existing session — check if we should create one
    if (!options?.skipBusinessHoursCheck && !businessHours.isOpen) {
        const sessionId = uuid();
        const session: QueueSession = {
            id: sessionId,
            queue_type_id: queueTypeId,
            location_id: locationId,
            business_id: businessId,
            session_date: dateStr,
            status: "closed",
            current_number: 0,
            last_called_number: 0,
            created_at: now(),
            updated_at: now(),
            closed_at: now(),
        };
        await kv.set(`queue_session:${sessionId}`, session);
        await kv.set(cacheKey, sessionId);
        await indexSessionForLocation(locationId, sessionId);

        return { session, businessHours };
    }

    // Create new open session
    const sessionId = uuid();
    const session: QueueSession = {
        id: sessionId,
        queue_type_id: queueTypeId,
        location_id: locationId,
        business_id: businessId,
        session_date: dateStr,
        status: "open",
        current_number: 0,
        last_called_number: 0,
        created_at: now(),
        updated_at: now(),
    };

    await kv.set(`queue_session:${sessionId}`, session);
    await kv.set(cacheKey, sessionId);
    await indexSessionForLocation(locationId, sessionId);

    return { session, businessHours };
}

/**
 * Get the currently active (open) sessions for a location.
 */
export async function getActiveSession(
    locationId: string
): Promise<{ sessions: QueueSession[]; businessHours: BusinessHoursCheck }> {
    const location = await kv.get(`location:${locationId}`);
    if (!location) {
        throw new Error(`Location ${locationId} not found`);
    }

    const timezone = location.timezone || "UTC";
    const dateStr = todayInTimezone(timezone);
    const businessHours = await checkBusinessHours(locationId);

    const queueTypes = await getQueueTypesForLocation(locationId, location.business_id);
    const sessions: QueueSession[] = [];

    for (const qt of queueTypes) {
        const cacheKey = `queue_session_today:${qt.id}:${dateStr}`;
        const sessionId = await kv.get(cacheKey);
        if (sessionId) {
            const session = await kv.get(`queue_session:${sessionId}`);
            if (session && session.session_date === dateStr && session.status === "open") {
                sessions.push(session);
            }
        }
    }

    return { sessions, businessHours };
}

/**
 * Close a session: set status to "closed", cancel all remaining WAITING entries.
 */
export async function closeSession(
    sessionId: string,
    reason?: string
): Promise<{ session: QueueSession; cancelledCount: number }> {
    const session = await kv.get(`queue_session:${sessionId}`);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    if (session.status === "closed" || session.status === "archived") {
        return { session, cancelledCount: 0 };
    }

    const lockKey = `queue_lock:close:${sessionId}`;

    return await withTransaction<{ session: QueueSession; cancelledCount: number }>(
        lockKey,
        async (batch) => {
            const freshSession = await kv.get(`queue_session:${sessionId}`);
            if (!freshSession || freshSession.status === "closed" || freshSession.status === "archived") {
                return { session: freshSession || session, cancelledCount: 0 };
            }

            const entryIds: string[] = (await kv.get(`session_entries:${sessionId}`)) || [];
            let cancelledCount = 0;
            const timestamp = now();

            for (const eid of entryIds) {
                const entry = await kv.get(`queue_entry:${eid}`);
                if (!entry) continue;

                if (entry.status === "waiting" || entry.status === "next") {
                    entry.status = "cancelled";
                    entry.cancelled_at = timestamp;
                    entry.notes = (entry.notes || "") +
                        ` [Auto-cancelled: session closed${reason ? ` — ${reason}` : ""}]`;
                    batch.set(`queue_entry:${eid}`, entry);
                    cancelledCount++;

                    if (entry.status === "next") {
                        const nextKey = `next_entry:${sessionId}:${entry.queue_type_id}`;
                        batch.del(nextKey);
                    }
                }
            }

            freshSession.status = "closed";
            freshSession.closed_at = timestamp;
            freshSession.updated_at = timestamp;
            batch.set(`queue_session:${sessionId}`, freshSession);

            return { session: freshSession, cancelledCount };
        }
    ).then(async (result) => {
        if (result.cancelledCount > 0 || result.session.status === "closed") {
            await writeAuditLog({
                locationId: result.session.location_id,
                businessId: result.session.business_id,
                eventType: "SESSION_CLOSED",
                actorName: "System",
                actorId: null,
                sessionId: result.session.id,
                details: `Session closed${reason ? `: ${reason}` : ""}. ${result.cancelledCount} entries auto-cancelled.`,
            });
        }
        return result;
    });
}

/**
 * Close all open sessions for a location.
 */
export async function closeAllSessionsForLocation(
    locationId: string,
    reason?: string
): Promise<{ closedCount: number; cancelledEntries: number }> {
    const location = await kv.get(`location:${locationId}`);
    if (!location) throw new Error(`Location ${locationId} not found`);

    const timezone = location.timezone || "UTC";
    const dateStr = todayInTimezone(timezone);

    const queueTypes = await getQueueTypesForLocation(locationId, location.business_id);

    let closedCount = 0;
    let cancelledEntries = 0;

    for (const qt of queueTypes) {
        const cacheKey = `queue_session_today:${qt.id}:${dateStr}`;
        const sessionId = await kv.get(cacheKey);
        if (!sessionId) continue;

        const session = await kv.get(`queue_session:${sessionId}`);
        if (!session || session.status !== "open") continue;

        const result = await closeSession(sessionId, reason || "Business hours ended");
        closedCount++;
        cancelledEntries += result.cancelledCount;
    }

    // Broadcast the closure event
    if (closedCount > 0) {
        const event = {
            type: "sessions_closed",
            timestamp: now(),
            business_id: location.business_id,
            location_id: locationId,
            closedCount,
            cancelledEntries,
        };
        await kv.set(`realtime_event:${locationId}`, event);
        const counter = (await kv.get(`realtime_counter:${locationId}`)) || 0;
        await kv.set(`realtime_counter:${locationId}`, counter + 1);
    }

    return { closedCount, cancelledEntries };
}

/**
 * Archive sessions older than `daysOld` days.
 */
export async function archiveOldSessions(
    locationId: string,
    daysOld: number = 30
): Promise<{ archivedCount: number }> {
    const location = await kv.get(`location:${locationId}`);
    if (!location) throw new Error(`Location ${locationId} not found`);

    const sessionIds: string[] = (await kv.get(`location_sessions:${locationId}`)) || [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);

    let archivedCount = 0;

    for (const sid of sessionIds) {
        const session = await kv.get(`queue_session:${sid}`);
        if (!session) continue;

        if (session.status === "archived") continue;
        if (session.session_date > cutoffStr) continue;

        if (session.status === "open" || session.status === "active") {
            await closeSession(sid, "Auto-closed for archival");
        }

        session.status = "archived";
        session.archived_at = now();
        session.updated_at = now();
        await kv.set(`queue_session:${sid}`, session);
        archivedCount++;
    }

    return { archivedCount };
}

/**
 * Auto-close sessions check — called periodically.
 */
export async function autoCloseExpiredSessions(
    businessId: string
): Promise<{ locationsProcessed: number; totalClosed: number; totalCancelled: number }> {
    const locationIds: string[] = (await kv.get(`business_locations:${businessId}`)) || [];

    let locationsProcessed = 0;
    let totalClosed = 0;
    let totalCancelled = 0;

    for (const locId of locationIds) {
        const hoursCheck = await checkBusinessHours(locId);

        if (!hoursCheck.isOpen) {
            const result = await closeAllSessionsForLocation(locId, "Auto-close: past business hours");
            if (result.closedCount > 0) {
                totalClosed += result.closedCount;
                totalCancelled += result.cancelledEntries;
            }
        }

        locationsProcessed++;
    }

    return { locationsProcessed, totalClosed, totalCancelled };
}

/**
 * Midnight session rotation.
 */
export async function midnightRotation(
    locationId: string
): Promise<{ closedPrevious: number; cancelledEntries: number }> {
    const result = await closeAllSessionsForLocation(
        locationId,
        "Midnight auto-close: day ended"
    );

    await archiveOldSessions(locationId, 30).catch((err) => {
        console.log(`[midnightRotation] Archive warning for ${locationId}: ${err.message}`);
    });

    return {
        closedPrevious: result.closedCount,
        cancelledEntries: result.cancelledEntries,
    };
}

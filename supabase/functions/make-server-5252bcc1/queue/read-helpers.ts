/**
 * EM Flow — Read Helpers (no locks needed)
 */

import * as kv from "../kv_store.tsx";
import type { QueueEntry } from "./types.ts";

export async function getLocationEntries(
    locationId: string
): Promise<QueueEntry[]> {
    const entryIds: string[] =
        (await kv.get(`location_entries:${locationId}`)) || [];
    const entries: QueueEntry[] = [];
    for (const eid of entryIds) {
        const e = await kv.get(`queue_entry:${eid}`);
        if (e) entries.push(e);
    }
    return entries;
}

export async function getSessionEntries(
    sessionId: string
): Promise<QueueEntry[]> {
    const entryIds: string[] =
        (await kv.get(`session_entries:${sessionId}`)) || [];
    const entries: QueueEntry[] = [];
    for (const eid of entryIds) {
        const e = await kv.get(`queue_entry:${eid}`);
        if (e) entries.push(e);
    }
    return entries;
}

export async function getQueueTypesForLocation(
    locationId: string,
    businessId: string
): Promise<any[]> {
    const allQtIds: string[] =
        (await kv.get(`business_queue_types:${businessId}`)) || [];
    const queueTypes: any[] = [];
    for (const qtId of allQtIds) {
        const qt = await kv.get(`queue_type:${qtId}`);
        if (qt && qt.location_id === locationId && qt.status === "active") {
            queueTypes.push(qt);
        }
    }
    queueTypes.sort(
        (a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0)
    );
    return queueTypes;
}

export async function countActiveEntries(entryIds: string[]): Promise<number> {
    let count = 0;
    for (const eid of entryIds) {
        const e = await kv.get(`queue_entry:${eid}`);
        if (
            e &&
            (e.status === "waiting" || e.status === "next" || e.status === "serving")
        )
            count++;
    }
    return count;
}

export async function calculateTotalBacklogTime(entryIds: string[]): Promise<number> {
    let totalMinutes = 0;
    for (const eid of entryIds) {
        const e = await kv.get(`queue_entry:${eid}`);
        if (
            e &&
            (e.status === "waiting" || e.status === "next" || e.status === "serving")
        ) {
            // Find the service duration or default to 10
            let duration = 10;
            if (e.service_id) {
                const service = await kv.get(`service:${e.service_id}`);
                if (service && service.average_service_time) {
                    duration = service.average_service_time;
                }
            } else if (e.queue_type_id) {
                const queueType = await kv.get(`queue_type:${e.queue_type_id}`);
                if (queueType && queueType.estimated_service_time) {
                    duration = queueType.estimated_service_time;
                }
            }
            totalMinutes += duration;
        }
    }
    return totalMinutes;
}

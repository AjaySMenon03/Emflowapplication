/**
 * EM Flow — Duplicate Prevention
 */

import * as kv from "../kv_store.tsx";
import type { QueueEntry, QueueEntryStatus } from "./types.ts";

/**
 * Check if a customer already has an active (WAITING or NEXT) entry
 * for this location in today's session. Matches by phone OR customerId.
 */
export async function checkDuplicateEntry(params: {
    locationId: string;
    customerPhone: string | null;
    customerId: string | null;
}): Promise<QueueEntry | null> {
    const { locationId, customerPhone, customerId } = params;
    if (!customerPhone && !customerId) return null;

    const entryIds: string[] =
        (await kv.get(`location_entries:${locationId}`)) || [];

    for (const eid of entryIds) {
        const entry: QueueEntry | null = await kv.get(`queue_entry:${eid}`);
        if (!entry) continue;
        if (entry.status !== "waiting" && entry.status !== "next") continue;

        if (customerPhone && entry.customer_phone && entry.customer_phone === customerPhone) {
            return entry;
        }
        if (customerId && entry.customer_id && entry.customer_id === customerId) {
            return entry;
        }
    }
    return null;
}

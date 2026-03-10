/**
 * Quecumber — Read Helpers (no locks needed)
 */

import * as kv from "../kv_store.tsx";
import { today } from "./helpers.ts";
import type { QueueEntry } from "./types.ts";

/** Batch-fetch all entries for a location in a single DB round trip. */
export async function getLocationEntries(
  locationId: string,
): Promise<QueueEntry[]> {
  const entryIds: string[] =
    (await kv.get(`location_entries:${locationId}`)) || [];
  if (entryIds.length === 0) return [];
  const values = await kv.mget(entryIds.map((id) => `queue_entry:${id}`));
  return (values as QueueEntry[]).filter(Boolean);
}

/** Batch-fetch all entries for a session in a single DB round trip. */
export async function getSessionEntries(
  sessionId: string,
): Promise<QueueEntry[]> {
  const entryIds: string[] =
    (await kv.get(`session_entries:${sessionId}`)) || [];
  if (entryIds.length === 0) return [];
  const values = await kv.mget(entryIds.map((id) => `queue_entry:${id}`));
  return (values as QueueEntry[]).filter(Boolean);
}

/** Batch-fetch active queue types for a location in a single DB round trip. */
export async function getQueueTypesForLocation(
  locationId: string,
  businessId: string,
): Promise<any[]> {
  const allQtIds: string[] =
    (await kv.get(`business_queue_types:${businessId}`)) || [];
  if (allQtIds.length === 0) return [];
  const values = await kv.mget(allQtIds.map((id) => `queue_type:${id}`));
  const queueTypes = (values as any[]).filter(
    (qt) => qt && qt.location_id === locationId && qt.status === "active",
  );
  queueTypes.sort(
    (a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0),
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

/**
 * Determine whether the daily capacity for a given service has been fully consumed.
 *
 * A slot is permanently consumed ONLY when a customer is marked SERVED.
 * No-shows and currently-active entries (waiting/next/serving) do NOT count
 * toward this limit — a no-show frees the slot for a new confirmed booking.
 *
 * Compares total served entries today across all active counters that support
 * the service against their combined max_capacity.
 */
export async function isServiceExhausted(
  serviceId: string,
  locationId: string,
  businessId: string,
): Promise<boolean> {
  // Find all active counters at this location that support this service
  const allQtIds: string[] =
    (await kv.get(`business_queue_types:${businessId}`)) || [];
  const compatibleCounters: any[] = [];
  for (const qtId of allQtIds) {
    const qt = await kv.get(`queue_type:${qtId}`);
    if (
      qt &&
      qt.location_id === locationId &&
      qt.status === "active" &&
      (qt.service_ids || []).includes(serviceId)
    ) {
      compatibleCounters.push(qt);
    }
  }
  if (compatibleCounters.length === 0) return false;

  const totalCapacity = compatibleCounters.reduce(
    (sum: number, qt: any) => sum + (qt.max_capacity || 1),
    0,
  );
  const compatibleQtIds = new Set(compatibleCounters.map((qt: any) => qt.id));
  const todayStr = today();

  // A slot is permanently consumed only when a customer is actually SERVED.
  // No-shows free the physical slot for re-booking; pending entries (waiting /
  // next / serving) hold the slot but don't permanently consume it.
  const locationEntryIds: string[] =
    (await kv.get(`location_entries:${locationId}`)) || [];
  let servedToday = 0;
  for (const eid of locationEntryIds) {
    const e = await kv.get(`queue_entry:${eid}`);
    if (
      e &&
      compatibleQtIds.has(e.queue_type_id) &&
      e.status === "served" &&
      (e.joined_at || "").startsWith(todayStr)
    ) {
      servedToday++;
    }
  }

  return servedToday >= totalCapacity;
}

/**
 * Check whether a specific counter (queue type) has consumed all of its
 * daily slot allocation. Counts every confirmed entry today on that counter
 * regardless of which service it was for.
 *
 * Used by promoteFromWaitlist to guard against promoting when the counter
 * that owns the waitlisted entry is physically at capacity.
 */
export async function isCounterAtDailyCapacity(
  queueTypeId: string,
  locationId: string,
): Promise<boolean> {
  const qt = await kv.get(`queue_type:${queueTypeId}`);
  if (!qt) return false;
  const maxCapacity: number = qt.max_capacity || 1;
  const todayStr = today();
  const locationEntryIds: string[] =
    (await kv.get(`location_entries:${locationId}`)) || [];
  // Only count truly served customers — the limit is reached when the counter
  // has actually served its full capacity, not when slots are merely booked or
  // a customer was a no-show.
  let servedCount = 0;
  for (const eid of locationEntryIds) {
    const e = await kv.get(`queue_entry:${eid}`);
    if (
      e &&
      e.queue_type_id === queueTypeId &&
      e.status === "served" &&
      (e.joined_at || "").startsWith(todayStr)
    ) {
      servedCount++;
    }
  }
  return servedCount >= maxCapacity;
}

export async function calculateTotalBacklogTime(
  entryIds: string[],
): Promise<number> {
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

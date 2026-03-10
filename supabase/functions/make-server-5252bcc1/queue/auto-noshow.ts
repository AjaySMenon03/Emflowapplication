/**
 * Quecumber — Auto No-Show Processing
 */

import * as kv from "../kv_store.tsx";
import { now } from "./helpers.ts";
import { withTransaction } from "./transaction.ts";
import { broadcastChange } from "./broadcast.ts";
import { writeAuditLog } from "./audit.ts";
import { recalcPositions } from "./entry.ts";
import { DEFAULT_AUTO_NOSHOW_TIMEOUT_MINUTES } from "./types.ts";
import type { QueueEntry } from "./types.ts";

/**
 * Scan a location for NEXT entries older than `timeoutMinutes`.
 * Marks them NO_SHOW and auto-promotes the next waiting entry.
 */
export async function processAutoNoShows(
  locationId: string,
  timeoutMinutes: number = DEFAULT_AUTO_NOSHOW_TIMEOUT_MINUTES,
): Promise<{ noShowCount: number; promotedCount: number }> {
  const entryIds: string[] =
    (await kv.get(`location_entries:${locationId}`)) || [];
  const cutoff = Date.now() - timeoutMinutes * 60 * 1000;
  const staleNextEntries: QueueEntry[] = [];

  for (const eid of entryIds) {
    const entry: QueueEntry | null = await kv.get(`queue_entry:${eid}`);
    if (!entry || entry.status !== "next") continue;
    const calledAt = entry.called_at ? new Date(entry.called_at).getTime() : 0;
    if (calledAt > 0 && calledAt < cutoff) staleNextEntries.push(entry);
  }

  let noShowCount = 0;
  let promotedCount = 0;

  for (const staleEntry of staleNextEntries) {
    const lockKey = `queue_lock:${staleEntry.queue_session_id}:${staleEntry.queue_type_id}`;
    const nextKey = `next_entry:${staleEntry.queue_session_id}:${staleEntry.queue_type_id}`;

    try {
      const result = await withTransaction<{ promoted: boolean }>(
        lockKey,
        async (batch) => {
          const fresh = await kv.get(`queue_entry:${staleEntry.id}`);
          if (!fresh || fresh.status !== "next") throw new Error("skip");

          fresh.status = "no_show";
          fresh.cancelled_at = now();
          fresh.notes =
            (fresh.notes || "") +
            ` [Auto no-show: ${timeoutMinutes}min timeout]`;
          batch.set(`queue_entry:${staleEntry.id}`, fresh);
          batch.del(nextKey);

          const sessionEntryIds: string[] =
            (await kv.get(`session_entries:${fresh.queue_session_id}`)) || [];
          const candidates: QueueEntry[] = [];
          for (const eid of sessionEntryIds) {
            if (eid === staleEntry.id) continue;
            const e = await kv.get(`queue_entry:${eid}`);
            if (
              e &&
              e.queue_type_id === fresh.queue_type_id &&
              e.status === "waiting"
            )
              candidates.push(e);
          }
          candidates.sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            if ((a.position || 0) !== (b.position || 0))
              return (a.position || 0) - (b.position || 0);
            return (
              new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()
            );
          });

          let promoted = false;
          if (candidates.length > 0) {
            const next = candidates[0];
            next.status = "next";
            next.called_at = now();
            next.served_by = fresh.served_by;
            batch.set(`queue_entry:${next.id}`, next);
            batch.set(nextKey, next.id);
            promoted = true;
          }
          await recalcPositions(
            fresh.queue_session_id,
            fresh.queue_type_id,
            batch,
            staleEntry.id,
          );
          return { promoted };
        },
      );

      noShowCount++;
      if (result.promoted) promotedCount++;

      await writeAuditLog({
        locationId: staleEntry.location_id,
        businessId: staleEntry.business_id,
        eventType: "AUTO_NO_SHOW",
        actorName: "System",
        actorId: null,
        customerName: staleEntry.customer_name,
        ticketNumber: staleEntry.ticket_number,
        queueTypeName: staleEntry.queue_type_name,
        queueTypeId: staleEntry.queue_type_id,
        entryId: staleEntry.id,
        sessionId: staleEntry.queue_session_id,
        details: `Auto no-show after ${timeoutMinutes} min in NEXT status`,
      });
      await broadcastChange(
        staleEntry.business_id,
        staleEntry.location_id,
        "entry_noshow",
        staleEntry,
      ).catch(() => {});
    } catch {
      // skip
    }
  }
  return { noShowCount, promotedCount };
}

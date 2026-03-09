/**
 * EM Flow — Queue Entry Creation & Position Helpers
 */

import * as kv from "../kv_store.tsx";
import { uuid, now, today } from "./helpers.ts";
import { TransactionBatch, withTransaction } from "./transaction.ts";
import {
  validateSessionActive,
  validateStaffForQueueType,
} from "./validation.ts";
import { broadcastChange } from "./broadcast.ts";
import { writeAuditLog, getStaffName } from "./audit.ts";
import {
  countActiveEntries,
  calculateTotalBacklogTime,
} from "./read-helpers.ts";
import type { QueueEntry, QueueEntryStatus, QueueSession } from "./types.ts";

/**
 * Create a new queue entry inside a transaction.
 *
 * - Validates session is active
 * - When waitlisted=false: increments the global location sequence → ticket #N, status=waiting
 * - When waitlisted=true:  assigns counter-local WL slot → ticket WLn, status=waitlisted
 * - Writes entry to KV and indexes (session_entries, location_entries)
 */
export async function createQueueEntry(params: {
  queueTypeId: string;
  sessionId: string;
  locationId: string;
  businessId: string;
  customerName: string;
  customerPhone: string | null;
  customerId: string | null;
  serviceId: string | null;
  serviceName: string | null;
  priority: number;
  notes: string | null;
  staffAuthUid?: string;
  /** When true the entry is placed on this counter's waitlist instead of the confirmed queue. */
  waitlisted?: boolean;
}): Promise<QueueEntry> {
  await validateSessionActive(params.sessionId);
  const queueType = await kv.get(`queue_type:${params.queueTypeId}`);
  if (!queueType) throw new Error(`Queue type ${params.queueTypeId} not found`);

  const lockKey = `queue_lock:${params.sessionId}:${params.queueTypeId}`;

  return await withTransaction<QueueEntry>(lockKey, async (batch) => {
    // Re-read session inside lock
    const freshSession = await kv.get(`queue_session:${params.sessionId}`);
    if (
      !freshSession ||
      freshSession.status === "closed" ||
      freshSession.status === "archived"
    ) {
      throw new Error("Session has been closed — please start a new session");
    }

    // Bump session counter for stats regardless of path
    freshSession.current_number = (freshSession.current_number || 0) + 1;
    freshSession.updated_at = now();
    batch.set(`queue_session:${params.sessionId}`, freshSession);

    // Snapshot all existing entries in this session (used in both paths)
    const sessionEntryIds: string[] =
      (await kv.get(`session_entries:${params.sessionId}`)) || [];

    const entryId = uuid();
    let ticketNumber: string;
    let entryStatus: QueueEntryStatus;
    let position: number;
    let waitlistNumber: number | undefined;

    if (params.waitlisted) {
      // ── WAITLISTED PATH ──────────────────────────────────────────────────────
      // Find the highest existing WL number for this specific counter and add 1
      let maxWlNumber = 0;
      for (const eid of sessionEntryIds) {
        const e = await kv.get(`queue_entry:${eid}`);
        if (
          e &&
          e.queue_type_id === params.queueTypeId &&
          e.status === "waitlisted" &&
          (e.waitlist_number || 0) > maxWlNumber
        ) {
          maxWlNumber = e.waitlist_number;
        }
      }
      waitlistNumber = maxWlNumber + 1;
      ticketNumber = `WL${waitlistNumber}`;
      entryStatus = "waitlisted";
      position = 0; // waitlisted entries have no confirmed position
    } else {
      // ── CONFIRMED / WAITING PATH ─────────────────────────────────────────────
      // Increment the single global sequence shared across ALL counters at this location
      const seqKey = `global_seq:${params.locationId}:${today()}`;
      const currentGlobalSeq = (await kv.get(seqKey)) || 0;
      const nextGlobalSeq = currentGlobalSeq + 1;
      batch.set(seqKey, nextGlobalSeq);

      ticketNumber = `#${nextGlobalSeq}`;
      entryStatus = "waiting";

      // Position = number of already-waiting entries for this counter + 1
      let waitingCount = 0;
      for (const eid of sessionEntryIds) {
        const e = await kv.get(`queue_entry:${eid}`);
        if (
          e &&
          e.queue_type_id === params.queueTypeId &&
          e.status === "waiting"
        ) {
          waitingCount++;
        }
      }
      position = waitingCount + 1;
    }

    const entry: QueueEntry = {
      id: entryId,
      queue_session_id: params.sessionId,
      queue_type_id: params.queueTypeId,
      customer_id: params.customerId,
      business_id: params.businessId,
      location_id: params.locationId,
      ticket_number: ticketNumber,
      status: entryStatus,
      priority: params.priority || 0,
      position,
      served_by: params.staffAuthUid || null,
      joined_at: now(),
      called_at: null,
      served_at: null,
      completed_at: null,
      cancelled_at: null,
      estimated_wait_minutes: null,
      notes: params.notes,
      created_at: now(),
      customer_name: params.customerName,
      customer_phone: params.customerPhone,
      queue_type_name: queueType.name || null,
      queue_type_prefix: queueType.prefix || null,
      service_id: params.serviceId,
      service_name: params.serviceName,
      waitlist_number: waitlistNumber,
    };

    batch.set(`queue_entry:${entryId}`, entry);

    // Index: session_entries
    const updatedSessionEntries = [...sessionEntryIds, entryId];
    batch.set(`session_entries:${params.sessionId}`, updatedSessionEntries);

    // Index: location_entries
    const locationEntryIds: string[] =
      (await kv.get(`location_entries:${params.locationId}`)) || [];
    batch.set(`location_entries:${params.locationId}`, [
      ...locationEntryIds,
      entryId,
    ]);

    return entry;
  }).then(async (entry) => {
    await broadcastChange(
      entry.business_id,
      entry.location_id,
      "entry_joined",
      entry,
    ).catch(() => {});
    return entry;
  });
}

/**
 * Calculate current position for a specific entry.
 */
export async function calculatePosition(entryId: string): Promise<{
  position: number;
  totalWaiting: number;
}> {
  const entry = await kv.get(`queue_entry:${entryId}`);
  if (!entry) throw new Error(`Entry ${entryId} not found`);
  if (entry.status !== "waiting") return { position: 0, totalWaiting: 0 };

  const sessionEntryIds: string[] =
    (await kv.get(`session_entries:${entry.queue_session_id}`)) || [];
  const waitingEntries: QueueEntry[] = [];
  for (const eid of sessionEntryIds) {
    const e = await kv.get(`queue_entry:${eid}`);
    if (
      e &&
      e.queue_type_id === entry.queue_type_id &&
      e.status === "waiting"
    ) {
      waitingEntries.push(e);
    }
  }

  // Sort by priority DESC → position ASC → joined_at ASC
  waitingEntries.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if ((a.position || 0) !== (b.position || 0))
      return (a.position || 0) - (b.position || 0);
    return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
  });

  const idx = waitingEntries.findIndex((e) => e.id === entryId);
  return {
    position: idx >= 0 ? idx + 1 : waitingEntries.length + 1,
    totalWaiting: waitingEntries.length,
  };
}

/**
 * Calculate estimated wait time for a specific entry.
 */
export async function calculateETA(entryId: string): Promise<{
  estimatedMinutes: number;
  position: number;
}> {
  const { position, totalWaiting } = await calculatePosition(entryId);
  const entry = await kv.get(`queue_entry:${entryId}`);
  if (!entry) return { estimatedMinutes: 0, position: 0 };

  // Try to get service time from queue type config
  let avgServiceMinutes = 10; // default
  if (entry.queue_type_id) {
    const queueType = await kv.get(`queue_type:${entry.queue_type_id}`);
    if (queueType && queueType.estimated_service_time) {
      avgServiceMinutes = queueType.estimated_service_time;
    }
  }

  return {
    estimatedMinutes: position * avgServiceMinutes,
    position,
  };
}

/**
 * Recalculates position values for all WAITING entries in a session/queueType,
 * excluding `excludeEntryId` (which is being removed from the queue).
 */
export async function recalcPositions(
  sessionId: string,
  queueTypeId: string,
  batch: TransactionBatch,
  excludeEntryId?: string,
): Promise<void> {
  const sessionEntryIds: string[] =
    (await kv.get(`session_entries:${sessionId}`)) || [];

  const waitingEntries: QueueEntry[] = [];
  for (const eid of sessionEntryIds) {
    if (eid === excludeEntryId) continue;
    const e = await kv.get(`queue_entry:${eid}`);
    if (e && e.queue_type_id === queueTypeId && e.status === "waiting") {
      waitingEntries.push(e);
    }
  }

  // Sort by priority DESC → position ASC → joined_at ASC
  waitingEntries.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if ((a.position || 0) !== (b.position || 0))
      return (a.position || 0) - (b.position || 0);
    return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
  });

  for (let i = 0; i < waitingEntries.length; i++) {
    const e = waitingEntries[i];
    if (e.position !== i + 1) {
      e.position = i + 1;
      batch.set(`queue_entry:${e.id}`, e);
    }
  }
}

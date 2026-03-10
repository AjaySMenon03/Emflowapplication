/**
 * Quecumber — Queue Operations
 *
 * callNext, startServing, markServed, markNoShow, cancelEntry,
 * moveEntry, reassignStaff, cancelEntryEnhanced, markPreviousAsServed
 */

import * as kv from "../kv_store.tsx";
import { now } from "./helpers.ts";
import { withTransaction } from "./transaction.ts";
import type { TransactionBatch } from "./transaction.ts";
import {
  validateSessionActive,
  validateStaffForQueueType,
} from "./validation.ts";
import { broadcastChange } from "./broadcast.ts";
import { writeAuditLog, getStaffName } from "./audit.ts";
import { recalcPositions } from "./entry.ts";
import { promoteFromWaitlist } from "./waitlist.ts";
import type { QueueEntry, QueueEntryStatus, QueueSession } from "./types.ts";

// ══════════════════════════════════════════════
//  callNext — WAITING → NEXT
// ══════════════════════════════════════════════

export async function callNext(params: {
  queueTypeId: string;
  sessionId: string;
  staffAuthUid: string;
}): Promise<QueueEntry | null> {
  const { queueTypeId, sessionId, staffAuthUid } = params;

  // Validate staff has access to this queue type
  await validateStaffForQueueType(staffAuthUid, queueTypeId);

  const lockKey = `queue_lock:${sessionId}:${queueTypeId}`;
  const nextKey = `next_entry:${sessionId}:${queueTypeId}`;

  // Check if there's already a NEXT entry
  const existingNextId = await kv.get(nextKey);
  if (existingNextId) {
    const existingNext = await kv.get(`queue_entry:${existingNextId}`);
    if (existingNext && existingNext.status === "next") {
      throw new Error(
        `There is already a NEXT customer: ${existingNext.customer_name} (${existingNext.ticket_number}). ` +
          `Please serve or mark them before calling next.`,
      );
    }
  }

  return await withTransaction<QueueEntry | null>(lockKey, async (batch) => {
    // Re-check inside lock
    const lockedNextId = await kv.get(nextKey);
    if (lockedNextId) {
      const lockedNext = await kv.get(`queue_entry:${lockedNextId}`);
      if (lockedNext && lockedNext.status === "next") {
        throw new Error(
          `There is already a NEXT customer: ${lockedNext.customer_name} (${lockedNext.ticket_number}). ` +
            `Please serve or mark them before calling next.`,
        );
      }
    }

    // Get all WAITING entries for this queue type in this session
    const sessionEntryIds: string[] =
      (await kv.get(`session_entries:${sessionId}`)) || [];
    const candidates: QueueEntry[] = [];

    for (const eid of sessionEntryIds) {
      const entry = await kv.get(`queue_entry:${eid}`);
      if (
        entry &&
        entry.queue_type_id === queueTypeId &&
        entry.status === "waiting"
      ) {
        candidates.push(entry);
      }
    }

    if (candidates.length === 0) return null;

    // Sort: highest priority first → lowest position first → earliest joined first
    candidates.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if ((a.position || 0) !== (b.position || 0))
        return (a.position || 0) - (b.position || 0);
      return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
    });

    const next = candidates[0];
    next.status = "next";
    next.called_at = now();
    next.served_by = staffAuthUid;

    // Update session
    const session = await kv.get(`queue_session:${sessionId}`);
    if (session) {
      session.last_called_number = parseInt(
        next.ticket_number.replace(/[^0-9]/g, "") || "0",
        10,
      );
      session.updated_at = now();
      batch.set(`queue_session:${sessionId}`, session);
    }

    batch.set(`queue_entry:${next.id}`, next);
    batch.set(nextKey, next.id); // NEXT constraint pointer

    return next;
  }).then(async (entry) => {
    if (entry) {
      await broadcastChange(
        entry.business_id,
        entry.location_id,
        "entry_called",
        entry,
      ).catch(() => {});
      await writeAuditLog({
        locationId: entry.location_id,
        businessId: entry.business_id,
        eventType: "CALLED_NEXT",
        actorName: await getStaffName(entry.served_by || ""),
        actorId: entry.served_by,
        customerName: entry.customer_name,
        ticketNumber: entry.ticket_number,
        queueTypeName: entry.queue_type_name,
        queueTypeId: entry.queue_type_id,
        entryId: entry.id,
        sessionId: entry.queue_session_id,
      });
    }
    return entry;
  });
}

// ══════════════════════════════════════════════
//  startServing — NEXT → SERVING
// ══════════════════════════════════════════════

export async function startServing(
  entryId: string,
  staffAuthUid: string,
): Promise<QueueEntry> {
  const entry = await kv.get(`queue_entry:${entryId}`);
  if (!entry) throw new Error(`Entry ${entryId} not found`);

  await validateStaffForQueueType(staffAuthUid, entry.queue_type_id);

  if (entry.status !== "next") {
    throw new Error(
      `Can only start serving entries with status "next" (current: ${entry.status})`,
    );
  }

  const lockKey = `queue_lock:${entry.queue_session_id}:${entry.queue_type_id}`;

  return await withTransaction<QueueEntry>(lockKey, async (batch) => {
    // Re-read inside lock
    const fresh = await kv.get(`queue_entry:${entryId}`);
    if (!fresh || fresh.status !== "next") {
      throw new Error("Entry is no longer in NEXT status — state has changed");
    }

    fresh.status = "serving";
    fresh.served_at = now();

    batch.set(`queue_entry:${entryId}`, fresh);

    // Clear the NEXT pointer since entry is now serving
    const nextKey = `next_entry:${fresh.queue_session_id}:${fresh.queue_type_id}`;
    batch.del(nextKey);

    return fresh;
  }).then(async (entry) => {
    await broadcastChange(
      entry.business_id,
      entry.location_id,
      "entry_serving",
      entry,
    ).catch(() => {});
    await writeAuditLog({
      locationId: entry.location_id,
      businessId: entry.business_id,
      eventType: "SERVED",
      actorName: await getStaffName(entry.served_by || ""),
      actorId: entry.served_by,
      customerName: entry.customer_name,
      ticketNumber: entry.ticket_number,
      queueTypeName: entry.queue_type_name,
      queueTypeId: entry.queue_type_id,
      entryId: entry.id,
      sessionId: entry.queue_session_id,
    });
    return entry;
  });
}

// ══════════════════════════════════════════════
//  markServed — NEXT|SERVING → SERVED
// ══════════════════════════════════════════════

export async function markServed(entryId: string): Promise<QueueEntry> {
  const entry = await kv.get(`queue_entry:${entryId}`);
  if (!entry) throw new Error(`Entry ${entryId} not found`);
  if (entry.status !== "serving" && entry.status !== "next") {
    throw new Error(
      `Entry ${entry.ticket_number} must be in "next" or "serving" status to mark served (current: ${entry.status})`,
    );
  }

  const lockKey = `queue_lock:${entry.queue_session_id}:${entry.queue_type_id}`;

  return await withTransaction<QueueEntry>(lockKey, async (batch) => {
    const fresh = await kv.get(`queue_entry:${entryId}`);
    if (!fresh || (fresh.status !== "serving" && fresh.status !== "next")) {
      throw new Error("Entry state has changed — please refresh");
    }

    fresh.status = "served";
    fresh.served_at = fresh.served_at || now();
    fresh.completed_at = now();

    batch.set(`queue_entry:${entryId}`, fresh);

    // Clear NEXT pointer if this was the NEXT entry
    const nextKey = `next_entry:${fresh.queue_session_id}:${fresh.queue_type_id}`;
    const currentNextId = await kv.get(nextKey);
    if (currentNextId === entryId) {
      batch.del(nextKey);
    }

    return fresh;
  }).then(async (entry) => {
    await broadcastChange(
      entry.business_id,
      entry.location_id,
      "entry_served",
      entry,
    ).catch(() => {});
    await writeAuditLog({
      locationId: entry.location_id,
      businessId: entry.business_id,
      eventType: "SERVED",
      actorName: await getStaffName(entry.served_by || ""),
      actorId: entry.served_by,
      customerName: entry.customer_name,
      ticketNumber: entry.ticket_number,
      queueTypeName: entry.queue_type_name,
      queueTypeId: entry.queue_type_id,
      entryId: entry.id,
      sessionId: entry.queue_session_id,
    });

    // Slot freed — promote the next waitlisted person (if any) to confirmed
    await promoteFromWaitlist(
      entry.queue_session_id,
      entry.queue_type_id,
    ).catch((err) => {
      console.error(`[promoteFromWaitlist] Error: ${err.message}`);
    });

    return entry;
  });
}

// ══════════════════════════════════════════════
//  markNoShow — WAITING|NEXT|SERVING → NO_SHOW
// ══════════════════════════════════════════════

export async function markNoShow(entryId: string): Promise<QueueEntry> {
  const entry = await kv.get(`queue_entry:${entryId}`);
  if (!entry) throw new Error(`Entry ${entryId} not found`);

  const validStatuses: QueueEntryStatus[] = ["waiting", "next", "serving"];
  if (!validStatuses.includes(entry.status)) {
    throw new Error(
      `Cannot mark ${entry.ticket_number} as no-show (status: ${entry.status})`,
    );
  }

  const lockKey = `queue_lock:${entry.queue_session_id}:${entry.queue_type_id}`;

  return await withTransaction<QueueEntry>(lockKey, async (batch) => {
    const fresh = await kv.get(`queue_entry:${entryId}`);
    if (!fresh) throw new Error("Entry not found");

    const wasNext = fresh.status === "next";
    fresh.status = "no_show";
    fresh.cancelled_at = now();

    batch.set(`queue_entry:${entryId}`, fresh);

    // Clear NEXT pointer if this was the NEXT entry
    if (wasNext) {
      const nextKey = `next_entry:${fresh.queue_session_id}:${fresh.queue_type_id}`;
      batch.del(nextKey);
    }

    // Recalculate positions for remaining waiting entries
    await recalcPositions(
      fresh.queue_session_id,
      fresh.queue_type_id,
      batch,
      entryId,
    );

    return fresh;
  }).then(async (entry) => {
    await broadcastChange(
      entry.business_id,
      entry.location_id,
      "entry_noshow",
      entry,
    ).catch(() => {});
    await writeAuditLog({
      locationId: entry.location_id,
      businessId: entry.business_id,
      eventType: "NO_SHOW",
      actorName: await getStaffName(entry.served_by || ""),
      actorId: entry.served_by,
      customerName: entry.customer_name,
      ticketNumber: entry.ticket_number,
      queueTypeName: entry.queue_type_name,
      queueTypeId: entry.queue_type_id,
      entryId: entry.id,
      sessionId: entry.queue_session_id,
    });

    // Attempt to promote from waitlist
    await promoteFromWaitlist(
      entry.queue_session_id,
      entry.queue_type_id,
    ).catch((err) => {
      console.error(`[promoteFromWaitlist] Error: ${err.message}`);
    });

    return entry;
  });
}

// ══════════════════════════════════════════════
//  cancelEntry — WAITING → CANCELLED (customer self-cancel)
// ══════════════════════════════════════════════

export async function cancelEntry(entryId: string): Promise<QueueEntry> {
  const entry = await kv.get(`queue_entry:${entryId}`);
  if (!entry) throw new Error(`Entry ${entryId} not found`);
  if (entry.status !== "waiting") {
    throw new Error(
      `Can only cancel entries with status "waiting" (current: ${entry.status})`,
    );
  }

  const lockKey = `queue_lock:${entry.queue_session_id}:${entry.queue_type_id}`;

  return await withTransaction<QueueEntry>(lockKey, async (batch) => {
    const fresh = await kv.get(`queue_entry:${entryId}`);
    if (!fresh || fresh.status !== "waiting") {
      throw new Error("Entry can no longer be cancelled — status has changed");
    }

    fresh.status = "cancelled";
    fresh.cancelled_at = now();

    batch.set(`queue_entry:${entryId}`, fresh);

    // Recalculate positions
    await recalcPositions(
      fresh.queue_session_id,
      fresh.queue_type_id,
      batch,
      entryId,
    );

    return fresh;
  }).then(async (entry) => {
    await broadcastChange(
      entry.business_id,
      entry.location_id,
      "entry_cancelled",
      entry,
    ).catch(() => {});
    await writeAuditLog({
      locationId: entry.location_id,
      businessId: entry.business_id,
      eventType: "CANCELLED",
      actorName: await getStaffName(entry.served_by || ""),
      actorId: entry.served_by,
      customerName: entry.customer_name,
      ticketNumber: entry.ticket_number,
      queueTypeName: entry.queue_type_name,
      queueTypeId: entry.queue_type_id,
      entryId: entry.id,
      sessionId: entry.queue_session_id,
    });

    // Attempt to promote from waitlist
    await promoteFromWaitlist(
      entry.queue_session_id,
      entry.queue_type_id,
    ).catch((err) => {
      console.error(`[promoteFromWaitlist] Error: ${err.message}`);
    });

    return entry;
  });
}

// ══════════════════════════════════════════════
// moveEntry — ATOMIC reorder within the queue
// ══════════════════════════════════════════════

export async function moveEntry(
  entryId: string,
  newPosition: number,
): Promise<void> {
  const entry = await kv.get(`queue_entry:${entryId}`);
  if (!entry) throw new Error(`Entry ${entryId} not found`);
  if (entry.status !== "waiting") {
    throw new Error("Can only reorder entries that are still waiting");
  }

  const lockKey = `queue_lock:${entry.queue_session_id}:${entry.queue_type_id}`;

  await withTransaction<void>(lockKey, async (batch) => {
    // Re-read inside lock
    const fresh = await kv.get(`queue_entry:${entryId}`);
    if (!fresh || fresh.status !== "waiting") {
      throw new Error("Entry is no longer waiting — cannot reorder");
    }

    const sessionEntries: string[] =
      (await kv.get(`session_entries:${fresh.queue_session_id}`)) || [];

    // Gather waiting entries sorted by current position → joined_at
    const waitingEntries: QueueEntry[] = [];
    for (const eid of sessionEntries) {
      const e = await kv.get(`queue_entry:${eid}`);
      if (
        e &&
        e.queue_type_id === fresh.queue_type_id &&
        e.status === "waiting"
      ) {
        waitingEntries.push(e);
      }
    }

    waitingEntries.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if ((a.position || 0) !== (b.position || 0))
        return (a.position || 0) - (b.position || 0);
      return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
    });

    // Remove the moved entry from the list
    const filtered = waitingEntries.filter((e) => e.id !== entryId);
    const clampedIdx = Math.max(0, Math.min(newPosition - 1, filtered.length));

    // Insert at new position
    filtered.splice(clampedIdx, 0, fresh);

    // Reassign positions 1..N
    for (let i = 0; i < filtered.length; i++) {
      const e = filtered[i];
      e.position = i + 1;
      if (e.id === entryId) {
        e.priority = 0;
      }
      batch.set(`queue_entry:${e.id}`, e);
    }
  }).then(async () => {
    await broadcastChange(
      entry.business_id,
      entry.location_id,
      "entry_moved",
      entry,
    ).catch(() => {});
    await writeAuditLog({
      locationId: entry.location_id,
      businessId: entry.business_id,
      eventType: "REORDERED",
      actorName: await getStaffName(entry.served_by || ""),
      actorId: entry.served_by,
      customerName: entry.customer_name,
      ticketNumber: entry.ticket_number,
      queueTypeName: entry.queue_type_name,
      queueTypeId: entry.queue_type_id,
      entryId: entry.id,
      sessionId: entry.queue_session_id,
    });
  });
}

// ══════════════════════════════════════════════
// reassignStaff — ATOMIC staff reassignment
// ══════════════════════════════════════════════

export async function reassignStaff(
  entryId: string,
  newStaffAuthUid: string,
): Promise<QueueEntry> {
  const entry = await kv.get(`queue_entry:${entryId}`);
  if (!entry) throw new Error(`Entry ${entryId} not found`);

  const validStatuses: QueueEntryStatus[] = ["next", "serving"];
  if (!validStatuses.includes(entry.status)) {
    throw new Error(
      `Can only reassign entries that are "next" or "serving" (current: ${entry.status})`,
    );
  }

  const staffRecord = await kv.get(`staff_user:${newStaffAuthUid}`);
  if (!staffRecord) throw new Error("Target staff member not found");

  // Staff must match location (owner/admin bypass)
  if (
    staffRecord.role !== "owner" &&
    staffRecord.role !== "admin" &&
    staffRecord.locations &&
    staffRecord.locations.length > 0 &&
    !staffRecord.locations.includes(entry.location_id)
  ) {
    throw new Error("Staff member does not have access to this location");
  }

  const lockKey = `queue_lock:${entry.queue_session_id}:${entry.queue_type_id}`;

  return await withTransaction<QueueEntry>(lockKey, async (batch) => {
    const fresh = await kv.get(`queue_entry:${entryId}`);
    if (!fresh) throw new Error("Entry not found");
    if (fresh.status !== "next" && fresh.status !== "serving") {
      throw new Error("Entry status has changed — cannot reassign");
    }

    fresh.served_by = newStaffAuthUid;
    batch.set(`queue_entry:${entryId}`, fresh);

    return fresh;
  }).then(async (entry) => {
    await broadcastChange(
      entry.business_id,
      entry.location_id,
      "entry_reassigned",
      entry,
    ).catch(() => {});
    await writeAuditLog({
      locationId: entry.location_id,
      businessId: entry.business_id,
      eventType: "REASSIGNED",
      actorName: await getStaffName(entry.served_by || ""),
      actorId: entry.served_by,
      customerName: entry.customer_name,
      ticketNumber: entry.ticket_number,
      queueTypeName: entry.queue_type_name,
      queueTypeId: entry.queue_type_id,
      entryId: entry.id,
      sessionId: entry.queue_session_id,
    });
    return entry;
  });
}

// ══════════════════════════════════════════════
// cancelEntryEnhanced — Cancel WAITING or NEXT with auto-promote
// ══════════════════════════════════════════════

export async function cancelEntryEnhanced(
  entryId: string,
  staffAuthUid?: string,
): Promise<{ cancelled: QueueEntry; promoted: QueueEntry | null }> {
  const entry = await kv.get(`queue_entry:${entryId}`);
  if (!entry) throw new Error(`Entry ${entryId} not found`);

  if (entry.status === "served")
    throw new Error("Cannot cancel — entry has already been served");
  if (entry.status === "cancelled")
    throw new Error("Entry is already cancelled");
  if (entry.status === "no_show")
    throw new Error("Cannot cancel — entry is marked as no-show");
  if (entry.status === "serving")
    throw new Error(
      "Cannot cancel while being served — mark as served or no-show instead",
    );

  const wasNext = entry.status === "next";
  const lockKey = `queue_lock:${entry.queue_session_id}:${entry.queue_type_id}`;
  const nextKey = `next_entry:${entry.queue_session_id}:${entry.queue_type_id}`;

  return await withTransaction<{
    cancelled: QueueEntry;
    promoted: QueueEntry | null;
  }>(lockKey, async (batch) => {
    const fresh = await kv.get(`queue_entry:${entryId}`);
    if (!fresh) throw new Error("Entry not found");
    if (fresh.status !== "waiting" && fresh.status !== "next") {
      throw new Error(
        `Entry can no longer be cancelled (status: ${fresh.status})`,
      );
    }

    const freshWasNext = fresh.status === "next";
    fresh.status = "cancelled";
    fresh.cancelled_at = now();
    batch.set(`queue_entry:${entryId}`, fresh);

    let promoted: QueueEntry | null = null;

    if (freshWasNext) {
      batch.del(nextKey);

      const sessionEntryIds: string[] =
        (await kv.get(`session_entries:${fresh.queue_session_id}`)) || [];
      const candidates: QueueEntry[] = [];
      for (const eid of sessionEntryIds) {
        if (eid === entryId) continue;
        const e = await kv.get(`queue_entry:${eid}`);
        if (
          e &&
          e.queue_type_id === fresh.queue_type_id &&
          e.status === "waiting"
        ) {
          candidates.push(e);
        }
      }

      candidates.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        if ((a.position || 0) !== (b.position || 0))
          return (a.position || 0) - (b.position || 0);
        return (
          new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()
        );
      });

      if (candidates.length > 0) {
        const next = candidates[0];
        next.status = "next";
        next.called_at = now();
        next.served_by = staffAuthUid || fresh.served_by;
        batch.set(`queue_entry:${next.id}`, next);
        batch.set(nextKey, next.id);
        promoted = next;
      }
    }

    await recalcPositions(
      fresh.queue_session_id,
      fresh.queue_type_id,
      batch,
      entryId,
    );
    return { cancelled: fresh, promoted };
  }).then(async (result) => {
    await broadcastChange(
      entry.business_id,
      entry.location_id,
      "entry_cancelled",
      result.cancelled,
    ).catch(() => {});
    const actorName = staffAuthUid
      ? await getStaffName(staffAuthUid)
      : "Customer";
    await writeAuditLog({
      locationId: entry.location_id,
      businessId: entry.business_id,
      eventType: "CANCELLED",
      actorName,
      actorId: staffAuthUid || null,
      customerName: entry.customer_name,
      ticketNumber: entry.ticket_number,
      queueTypeName: entry.queue_type_name,
      queueTypeId: entry.queue_type_id,
      entryId: entry.id,
      sessionId: entry.queue_session_id,
      details: wasNext ? "Cancelled while in NEXT status" : undefined,
    });
    if (result.promoted) {
      await broadcastChange(
        result.promoted.business_id,
        result.promoted.location_id,
        "entry_called",
        result.promoted,
      ).catch(() => {});
      await writeAuditLog({
        locationId: result.promoted.location_id,
        businessId: result.promoted.business_id,
        eventType: "CALLED_NEXT",
        actorName: "System",
        actorId: null,
        customerName: result.promoted.customer_name,
        ticketNumber: result.promoted.ticket_number,
        queueTypeName: result.promoted.queue_type_name,
        queueTypeId: result.promoted.queue_type_id,
        entryId: result.promoted.id,
        sessionId: result.promoted.queue_session_id,
        details: "Auto-promoted after NEXT entry was cancelled",
      });
    }

    // Also attempt to promote someone from waitlist to confirmed
    await promoteFromWaitlist(
      entry.queue_session_id,
      entry.queue_type_id,
    ).catch((err) => {
      console.error(`[promoteFromWaitlist] Error: ${err.message}`);
    });

    return result;
  });
}

// ══════════════════════════════════════════════
// markPreviousAsServed
// ══════════════════════════════════════════════

export async function markPreviousAsServed(params: {
  queueTypeId: string;
  sessionId: string;
  staffAuthUid: string;
}): Promise<QueueEntry | null> {
  const { queueTypeId, sessionId, staffAuthUid } = params;
  await validateStaffForQueueType(staffAuthUid, queueTypeId);

  const sessionEntryIds: string[] =
    (await kv.get(`session_entries:${sessionId}`)) || [];
  const servingEntries: QueueEntry[] = [];
  for (const eid of sessionEntryIds) {
    const e = await kv.get(`queue_entry:${eid}`);
    if (
      e &&
      e.queue_type_id === queueTypeId &&
      (e.status === "serving" || e.status === "next")
    ) {
      servingEntries.push(e);
    }
  }

  if (servingEntries.length === 0) return null;

  servingEntries.sort(
    (a, b) =>
      new Date(b.called_at || b.joined_at).getTime() -
      new Date(a.called_at || a.joined_at).getTime(),
  );

  const target = servingEntries[0];
  const lockKey = `queue_lock:${sessionId}:${queueTypeId}`;

  return await withTransaction<QueueEntry>(lockKey, async (batch) => {
    const fresh = await kv.get(`queue_entry:${target.id}`);
    if (!fresh || (fresh.status !== "serving" && fresh.status !== "next")) {
      throw new Error("No eligible previous entry to mark as served");
    }
    fresh.status = "served";
    fresh.served_at = fresh.served_at || now();
    fresh.completed_at = now();
    batch.set(`queue_entry:${fresh.id}`, fresh);

    const nextKey = `next_entry:${sessionId}:${queueTypeId}`;
    const currentNextId = await kv.get(nextKey);
    if (currentNextId === fresh.id) batch.del(nextKey);

    return fresh;
  }).then(async (entry) => {
    await broadcastChange(
      entry.business_id,
      entry.location_id,
      "entry_served",
      entry,
    ).catch(() => {});
    const staffName = await getStaffName(staffAuthUid);
    await writeAuditLog({
      locationId: entry.location_id,
      businessId: entry.business_id,
      eventType: "MARK_PREVIOUS_SERVED",
      actorName: staffName,
      actorId: staffAuthUid,
      customerName: entry.customer_name,
      ticketNumber: entry.ticket_number,
      queueTypeName: entry.queue_type_name,
      queueTypeId: entry.queue_type_id,
      entryId: entry.id,
      sessionId: entry.queue_session_id,
      details:
        "Staff manually marked previous entry as served (forgot earlier)",
    });
    return entry;
  });
}

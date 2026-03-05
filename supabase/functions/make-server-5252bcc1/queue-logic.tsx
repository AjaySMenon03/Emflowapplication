/**
 * EM Flow — Centralized Queue Logic Module (v2 — Atomic Transactions)
 *
 * All queue mutations go through this module with:
 *   - Application-level distributed locks (KV-based mutex)
 *   - Batch atomic writes via mset (single DB round-trip)
 *   - Rollback on failure
 *   - "next" status: only ONE entry per queue_type per session
 *
 * Status lifecycle:
 *   WAITING → NEXT → SERVING → SERVED
 *                  ↘ NO_SHOW / CANCELLED
 *
 * KV key patterns:
 *   queue_session:{id}                     → QueueSession
 *   queue_session_today:{queueTypeId}:{d}  → session id for today
 *   queue_entry:{id}                       → QueueEntry
 *   session_entries:{sessionId}            → string[]  (ordered entry ids)
 *   location_entries:{locationId}          → string[]  (all active entry ids)
 *   customer:{customerId}                  → Customer record
 *   customer_entries:{customerId}          → string[]  (entry ids)
 *   queue_type:{id}                        → QueueType
 *   staff_user:{authUid}                   → StaffUser
 *   notification_log:{id}                  → NotificationLog
 *   queue_lock:{sessionId}:{queueTypeId}   → Lock record
 *   next_entry:{sessionId}:{queueTypeId}   → entry id of current NEXT
 *   audit_log:{locationId}                 → AuditLogEntry[] (system event log)
 */

import * as kv from "./kv_store.tsx";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════

function uuid(): string {
  return crypto.randomUUID();
}
function now(): string {
  return new Date().toISOString();
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

export type QueueEntryStatus =
  | "waiting"
  | "next"
  | "serving"
  | "served"
  | "cancelled"
  | "no_show";

export type SessionStatus = "open" | "closed" | "archived";

export interface QueueSession {
  id: string;
  queue_type_id: string;
  location_id: string;
  business_id: string;
  session_date: string;
  status: string; // SessionStatus: "open" | "closed" | "archived"
  current_number: number;
  last_called_number: number;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  archived_at?: string;
}

export interface QueueEntry {
  id: string;
  queue_session_id: string;
  queue_type_id: string;
  customer_id: string | null;
  business_id: string;
  location_id: string;
  ticket_number: string;
  status: QueueEntryStatus;
  priority: number;
  position: number; // explicit position for ordering
  served_by: string | null;
  joined_at: string;
  called_at: string | null;
  served_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  estimated_wait_minutes: number | null;
  notes: string | null;
  created_at: string;
  // Denormalized for convenience
  customer_name: string | null;
  customer_phone: string | null;
  queue_type_name: string | null;
  queue_type_prefix: string | null;
}

interface LockRecord {
  id: string;
  acquired_at: number;
}

// ══════════════════════════════════════════════
// CONFIGURABLE TIMEOUTS
// ══════════════════════════════════════════════

/** Default timeout (minutes) before NEXT entries are auto-marked NO_SHOW */
const DEFAULT_AUTO_NOSHOW_TIMEOUT_MINUTES = 10;

// ══════════════════════════════════════════════
// AUDIT / SYSTEM EVENT LOG
// ══════════════════════════════════════════════

export type AuditEventType =
  | "CALLED_NEXT"
  | "SERVED"
  | "NO_SHOW"
  | "CANCELLED"
  | "REORDERED"
  | "REASSIGNED"
  | "AUTO_NO_SHOW"
  | "AUTO_CANCEL"
  | "SESSION_CLOSED"
  | "SESSION_ARCHIVED"
  | "DUPLICATE_BLOCKED"
  | "MARK_PREVIOUS_SERVED"
  | "EMERGENCY_PAUSE"
  | "EMERGENCY_RESUME"
  | "EMERGENCY_CLOSE"
  | "EMERGENCY_BROADCAST"
  | "EMERGENCY_BROADCAST_CLEAR";

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  location_id: string;
  business_id: string;
  event_type: AuditEventType;
  actor: string; // staff name or "System"
  actor_id: string | null; // staff auth uid or null for system
  customer_name: string | null;
  ticket_number: string | null;
  queue_type_name: string | null;
  queue_type_id: string | null;
  entry_id: string | null;
  session_id: string | null;
  details: string | null;
}

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
async function getStaffName(staffAuthUid: string): Promise<string> {
  const staff = await kv.get(`staff_user:${staffAuthUid}`);
  return staff?.name || "Unknown Staff";
}

// ══════════════════════════════════════════════
// DISTRIBUTED LOCK  (KV-based mutex)
// ══════════════════════════════════════════════

const LOCK_TTL_MS = 15_000; // stale after 15 s
const LOCK_RETRY_INTERVAL_MS = 50;
const LOCK_MAX_WAIT_MS = 8_000;

/**
 * Acquire a lock for a given key.
 * Uses check-set-verify pattern to minimise race windows.
 * Returns lockId on success, null on timeout.
 */
async function acquireLock(lockKey: string): Promise<string | null> {
  const lockId = uuid();
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    const existing: LockRecord | null = await kv.get(lockKey);

    if (existing && Date.now() - existing.acquired_at < LOCK_TTL_MS) {
      // Lock is held and still valid — wait and retry
      await sleep(LOCK_RETRY_INTERVAL_MS);
      continue;
    }

    // Either no lock or stale lock — attempt to acquire
    const record: LockRecord = { id: lockId, acquired_at: Date.now() };
    await kv.set(lockKey, record);

    // Verify we won the race
    await sleep(10); // small delay to let concurrent writers flush
    const verify: LockRecord | null = await kv.get(lockKey);
    if (verify?.id === lockId) {
      return lockId;
    }

    // Lost the race — retry
    await sleep(LOCK_RETRY_INTERVAL_MS);
  }

  return null; // timed out
}

async function releaseLock(lockKey: string, lockId: string): Promise<void> {
  try {
    const current: LockRecord | null = await kv.get(lockKey);
    if (current?.id === lockId) {
      await kv.del(lockKey);
    }
  } catch {
    // Best-effort release; TTL will clean up
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ══════════════════════════════════════════════
// TRANSACTION BATCH  (atomic multi-key write)
// ══════════════════════════════════════════════

class TransactionBatch {
  private writes = new Map<string, unknown>();
  private deletes: string[] = [];

  set(key: string, value: unknown): void {
    this.writes.set(key, value);
  }

  del(key: string): void {
    this.deletes.push(key);
    this.writes.delete(key); // avoid writing something we're deleting
  }

  get pendingCount(): number {
    return this.writes.size + this.deletes.length;
  }

  /** Flush all pending writes/deletes in minimal round-trips */
  async commit(): Promise<void> {
    if (this.writes.size > 0) {
      const keys = [...this.writes.keys()];
      const values = [...this.writes.values()];
      await kv.mset(keys, values);
    }
    if (this.deletes.length > 0) {
      await kv.mdel(this.deletes);
    }
  }
}

/**
 * Execute `fn` inside a lock, with a TransactionBatch that is
 * committed only on success. On error the batch is discarded (rollback).
 */
async function withTransaction<T>(
  lockKey: string,
  fn: (batch: TransactionBatch) => Promise<T>
): Promise<T> {
  const lockId = await acquireLock(lockKey);
  if (!lockId) {
    throw new Error(
      "Queue operation in progress — please try again in a moment (lock timeout)"
    );
  }

  const batch = new TransactionBatch();
  try {
    const result = await fn(batch);
    // Success — commit all writes atomically
    await batch.commit();
    return result;
  } catch (err) {
    // Failure — batch is never committed (automatic rollback)
    throw err;
  } finally {
    await releaseLock(lockKey, lockId);
  }
}

// ══════════════════════════════════════════════
// VALIDATION HELPERS
// ══════════════════════════════════════════════

async function validateSessionActive(sessionId: string): Promise<QueueSession> {
  const session = await kv.get(`queue_session:${sessionId}`);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  if (session.status === "closed" || session.status === "archived") {
    throw new Error(
      `Queue session for ${session.session_date} is ${session.status}. Please start a new session.`
    );
  }
  // Accept both legacy "active" and new "open" as valid statuses
  return session;
}

async function validateStaffForQueueType(
  staffAuthUid: string,
  queueTypeId: string
): Promise<void> {
  const staffRecord = await kv.get(`staff_user:${staffAuthUid}`);
  if (!staffRecord) {
    throw new Error("Staff record not found — you may not have access");
  }

  const queueType = await kv.get(`queue_type:${queueTypeId}`);
  if (!queueType) {
    throw new Error(`Queue type ${queueTypeId} not found`);
  }

  // Owner/admin bypass location check
  if (staffRecord.role === "owner" || staffRecord.role === "admin") return;

  // Staff must have the queue type's location in their locations array
  if (
    staffRecord.locations &&
    staffRecord.locations.length > 0 &&
    queueType.location_id &&
    !staffRecord.locations.includes(queueType.location_id)
  ) {
    throw new Error(
      `You do not have access to the queue "${queueType.name}" at this location`
    );
  }
}

// ══════════════════════════════════════════════
//  1. getOrCreateTodaySession
// ══════════════════════════════════════════════

export async function getOrCreateTodaySession(
  queueTypeId: string,
  locationId: string,
  businessId: string
): Promise<QueueSession> {
  const dateStr = today();
  const cacheKey = `queue_session_today:${queueTypeId}:${dateStr}`;

  const existingId = await kv.get(cacheKey);
  if (existingId) {
    const session = await kv.get(`queue_session:${existingId}`);
    if (session && session.session_date === dateStr) return session;
  }

  // Create new session
  const sessionId = uuid();
  const session: QueueSession = {
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

// ══════════════════════════════════════════════
//  2. createQueueEntry  (transactional)
// ══════════════════════════════════════════════

export async function createQueueEntry(params: {
  queueTypeId: string;
  locationId: string;
  businessId: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  priority?: number;
  notes?: string;
}): Promise<QueueEntry> {
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
    throw new Error(`Queue type "${queueType.name}" is not active`);

  // ── Duplicate prevention ──
  const duplicate = await checkDuplicateEntry({
    locationId,
    customerPhone,
    customerId,
  });
  if (duplicate) {
    throw new Error(
      `DUPLICATE_ENTRY: Customer already has an active entry (${duplicate.ticket_number}) in this queue`
    );
  }

  const session = await getOrCreateTodaySession(
    queueTypeId,
    locationId,
    businessId
  );

  if (session.status === "closed") {
    throw new Error(
      `Queue session for today is closed. New entries cannot be added.`
    );
  }

  const lockKey = `queue_lock:${session.id}:${queueTypeId}`;

  return await withTransaction<QueueEntry>(lockKey, async (batch) => {
    // Re-read session inside lock for freshness
    const freshSession: QueueSession = await kv.get(
      `queue_session:${session.id}`
    );

    const sessionEntries: string[] =
      (await kv.get(`session_entries:${freshSession.id}`)) || [];
    const activeCount = await countActiveEntries(sessionEntries);
    if (activeCount >= (queueType.max_capacity || 100)) {
      throw new Error(
        `Queue "${queueType.name}" has reached maximum capacity (${queueType.max_capacity})`
      );
    }

    // Increment ticket
    freshSession.current_number += 1;
    freshSession.updated_at = now();

    const ticketNumber = `${queueType.prefix || "Q"}${String(
      freshSession.current_number
    ).padStart(3, "0")}`;

    const waitingAhead = activeCount;
    const estimatedWait =
      waitingAhead * (queueType.estimated_service_time || 10);

    const entryId = uuid();
    const entry: QueueEntry = {
      id: entryId,
      queue_session_id: freshSession.id,
      queue_type_id: queueTypeId,
      customer_id: customerId,
      business_id: businessId,
      location_id: locationId,
      ticket_number: ticketNumber,
      status: "waiting",
      priority,
      position: activeCount + 1,
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

    // Index updates
    sessionEntries.push(entryId);
    const locationEntries: string[] =
      (await kv.get(`location_entries:${locationId}`)) || [];
    locationEntries.push(entryId);

    // Batch all writes
    batch.set(`queue_entry:${entryId}`, entry);
    batch.set(`queue_session:${freshSession.id}`, freshSession);
    batch.set(`session_entries:${freshSession.id}`, sessionEntries);
    batch.set(`location_entries:${locationId}`, locationEntries);

    if (customerId) {
      const custEntries: string[] =
        (await kv.get(`customer_entries:${customerId}`)) || [];
      custEntries.push(entryId);
      batch.set(`customer_entries:${customerId}`, custEntries);
    }

    return entry;
  }).then(async (entry) => {
    // Post-commit: broadcast (non-critical)
    await broadcastChange(
      entry.business_id,
      entry.location_id,
      "entry_created",
      entry
    ).catch(() => { });
    return entry;
  });
}

// ══════════════════════════════════════════════
//  3. calculatePosition
// ══════════════════════════════════════════════

export async function calculatePosition(
  entryId: string
): Promise<{ position: number; total: number }> {
  const entry = await kv.get(`queue_entry:${entryId}`);
  if (!entry) throw new Error(`Entry ${entryId} not found`);

  const sessionEntries: string[] =
    (await kv.get(`session_entries:${entry.queue_session_id}`)) || [];

  const waitingEntries: QueueEntry[] = [];
  for (const eid of sessionEntries) {
    const e = await kv.get(`queue_entry:${eid}`);
    if (!e || e.queue_type_id !== entry.queue_type_id) continue;
    if (e.status === "waiting") waitingEntries.push(e);
  }

  // Sort by priority DESC, position ASC, joined_at ASC
  waitingEntries.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if ((a.position || 0) !== (b.position || 0))
      return (a.position || 0) - (b.position || 0);
    return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
  });

  const total = waitingEntries.length;
  let position = 0;

  if (entry.status === "waiting") {
    const idx = waitingEntries.findIndex((e) => e.id === entryId);
    position = idx >= 0 ? idx + 1 : total + 1;
  } else if (entry.status === "next") {
    position = 0; // You're next!
  }

  return { position, total };
}

// ══════════════════════════════════════════════
//  4. calculateETA
// ══════════════════════════════════════════════

export async function calculateETA(
  entryId: string
): Promise<{ estimatedMinutes: number; estimatedTime: string }> {
  const entry = await kv.get(`queue_entry:${entryId}`);
  if (!entry) throw new Error(`Entry ${entryId} not found`);

  if (entry.status === "next" || entry.status === "serving") {
    return { estimatedMinutes: 0, estimatedTime: new Date().toISOString() };
  }

  const queueType = await kv.get(`queue_type:${entry.queue_type_id}`);
  const serviceTime = queueType?.estimated_service_time || 10;

  const { position } = await calculatePosition(entryId);
  const estimatedMinutes = Math.max(0, position * serviceTime);
  const eta = new Date(Date.now() + estimatedMinutes * 60 * 1000);

  return { estimatedMinutes, estimatedTime: eta.toISOString() };
}

// ══════════════════════════════════════════════
//  5. callNext  — ATOMIC, ONE "next" per queue_type per session
//
//     Transaction steps:
//       1. Lock the queue_type within the session
//       2. Validate session is active
//       3. Validate staff is authorised for this queue_type
//       4. Demote current NEXT → WAITING  (unless served/completed)
//       5. Promote highest-priority WAITING → NEXT
//       6. Write the NEXT constraint key
//       7. Commit batch atomically
// ══════════════════════════════════════════════

export async function callNext(params: {
  queueTypeId: string;
  sessionId: string;
  staffAuthUid: string;
}): Promise<QueueEntry | null> {
  const { queueTypeId, sessionId, staffAuthUid } = params;

  // Pre-flight checks (outside lock to fail fast)
  await validateStaffForQueueType(staffAuthUid, queueTypeId);

  const lockKey = `queue_lock:${sessionId}:${queueTypeId}`;
  const nextKey = `next_entry:${sessionId}:${queueTypeId}`;

  return await withTransaction<QueueEntry | null>(lockKey, async (batch) => {
    // 1. Validate session is active
    const session = await validateSessionActive(sessionId);

    // 2. Read all entries for this queue type in this session
    const sessionEntryIds: string[] =
      (await kv.get(`session_entries:${sessionId}`)) || [];

    const allEntries: QueueEntry[] = [];
    for (const eid of sessionEntryIds) {
      const e = await kv.get(`queue_entry:${eid}`);
      if (e && e.queue_type_id === queueTypeId) allEntries.push(e);
    }

    // 3. Check for currently-serving entry (block if someone is actively being served)
    const currentlyServing = allEntries.find((e) => e.status === "serving");
    if (currentlyServing) {
      throw new Error(
        `Customer ${currentlyServing.ticket_number} is actively being served. ` +
        `Mark them as served or no-show before calling the next.`
      );
    }

    // 4. Demote current NEXT → WAITING (unless already transitioned)
    const currentNextId = await kv.get(nextKey);
    if (currentNextId) {
      const currentNext = allEntries.find((e) => e.id === currentNextId);
      if (currentNext && currentNext.status === "next") {
        // Demote back to waiting
        currentNext.status = "waiting";
        currentNext.called_at = null;
        currentNext.served_by = null;
        batch.set(`queue_entry:${currentNext.id}`, currentNext);
      }
    }

    // 5. Find candidates: WAITING entries, sorted by priority DESC → position ASC → joined_at ASC
    const candidates = allEntries
      .filter((e) => e.status === "waiting")
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        if ((a.position || 0) !== (b.position || 0))
          return (a.position || 0) - (b.position || 0);
        return (
          new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()
        );
      });

    if (candidates.length === 0) {
      // No waiting entries — clear the NEXT pointer
      batch.del(nextKey);
      return null;
    }

    // 6. Promote first candidate → NEXT
    const next = candidates[0];
    next.status = "next";
    next.called_at = now();
    next.served_by = staffAuthUid;

    // 7. Update session last_called_number
    const num = parseInt(next.ticket_number.replace(/[^0-9]/g, ""), 10);
    session.last_called_number = num || session.last_called_number + 1;
    session.updated_at = now();

    // 8. Batch writes
    batch.set(`queue_entry:${next.id}`, next);
    batch.set(`queue_session:${sessionId}`, session);
    batch.set(nextKey, next.id); // NEXT constraint pointer

    return next;
  }).then(async (entry) => {
    if (entry) {
      await broadcastChange(
        entry.business_id,
        entry.location_id,
        "entry_called",
        entry
      ).catch(() => { });
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
//  6. startServing — Transition NEXT → SERVING
// ══════════════════════════════════════════════

export async function startServing(
  entryId: string,
  staffAuthUid: string
): Promise<QueueEntry> {
  const entry = await kv.get(`queue_entry:${entryId}`);
  if (!entry) throw new Error(`Entry ${entryId} not found`);

  await validateStaffForQueueType(staffAuthUid, entry.queue_type_id);

  if (entry.status !== "next") {
    throw new Error(
      `Can only start serving entries with status "next" (current: ${entry.status})`
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
      entry
    ).catch(() => { });
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
//  7. markServed — NEXT|SERVING → SERVED
// ══════════════════════════════════════════════

export async function markServed(entryId: string): Promise<QueueEntry> {
  const entry = await kv.get(`queue_entry:${entryId}`);
  if (!entry) throw new Error(`Entry ${entryId} not found`);
  if (entry.status !== "serving" && entry.status !== "next") {
    throw new Error(
      `Entry ${entry.ticket_number} must be in "next" or "serving" status to mark served (current: ${entry.status})`
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
      entry
    ).catch(() => { });
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
//  8. markNoShow — WAITING|NEXT|SERVING → NO_SHOW
// ══════════════════════════════════════════════

export async function markNoShow(entryId: string): Promise<QueueEntry> {
  const entry = await kv.get(`queue_entry:${entryId}`);
  if (!entry) throw new Error(`Entry ${entryId} not found`);

  const validStatuses: QueueEntryStatus[] = ["waiting", "next", "serving"];
  if (!validStatuses.includes(entry.status)) {
    throw new Error(
      `Cannot mark ${entry.ticket_number} as no-show (status: ${entry.status})`
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
    await recalcPositions(fresh.queue_session_id, fresh.queue_type_id, batch, entryId);

    return fresh;
  }).then(async (entry) => {
    await broadcastChange(
      entry.business_id,
      entry.location_id,
      "entry_noshow",
      entry
    ).catch(() => { });
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
    return entry;
  });
}

// ══════════════════════════════════════════════
//  9. cancelEntry — WAITING → CANCELLED  (customer self-cancel)
// ══════════════════════════════════════════════

export async function cancelEntry(entryId: string): Promise<QueueEntry> {
  const entry = await kv.get(`queue_entry:${entryId}`);
  if (!entry) throw new Error(`Entry ${entryId} not found`);
  if (entry.status !== "waiting") {
    throw new Error(`Can only cancel entries with status "waiting" (current: ${entry.status})`);
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
    await recalcPositions(fresh.queue_session_id, fresh.queue_type_id, batch, entryId);

    return fresh;
  }).then(async (entry) => {
    await broadcastChange(
      entry.business_id,
      entry.location_id,
      "entry_cancelled",
      entry
    ).catch(() => { });
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
    return entry;
  });
}

// ══════════════════════════════════════════════
// 10. moveEntry — ATOMIC reorder within the queue
//
//     Reads all WAITING entries, removes the target,
//     inserts at the new position, recalculates ALL
//     position values, and batch-writes everything.
// ══════════════════════════════════════════════

export async function moveEntry(
  entryId: string,
  newPosition: number
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

    // Reassign positions 1..N and reset priority so position is the sole ordering
    for (let i = 0; i < filtered.length; i++) {
      const e = filtered[i];
      e.position = i + 1;
      // The moved entry gets a boosted priority if moved up, or zero if moved down
      // Actually, we use position as the canonical order now, so set priority = 0
      // for the moved entry to avoid conflicts
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
      entry
    ).catch(() => { });
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
// 11. reassignStaff — ATOMIC staff reassignment
//
//     Validates:
//       - Entry is NEXT or SERVING
//       - New staff has access to the location
//       - Session is still active
// ══════════════════════════════════════════════

export async function reassignStaff(
  entryId: string,
  newStaffAuthUid: string
): Promise<QueueEntry> {
  const entry = await kv.get(`queue_entry:${entryId}`);
  if (!entry) throw new Error(`Entry ${entryId} not found`);

  const validStatuses: QueueEntryStatus[] = ["next", "serving"];
  if (!validStatuses.includes(entry.status)) {
    throw new Error(
      `Can only reassign entries that are "next" or "serving" (current: ${entry.status})`
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
      entry
    ).catch(() => { });
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
// POSITION RECALCULATION HELPER
// ══════════════════════════════════════════════

/**
 * Recalculates position values for all WAITING entries in a session/queueType,
 * excluding `excludeEntryId` (which is being removed from the queue).
 */
async function recalcPositions(
  sessionId: string,
  queueTypeId: string,
  batch: TransactionBatch,
  excludeEntryId?: string
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

// ══════════════════════════════════════════════
// READ HELPERS (unchanged, no locks needed)
// ══════════════════════════════════════════════

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

async function countActiveEntries(entryIds: string[]): Promise<number> {
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

// ══════════════════════════════════════════════
// NOTIFICATION LOG
// ══════════════════════════════════════════════

export async function logNotification(params: {
  entryId: string;
  customerId: string | null;
  businessId: string;
  channel: string;
  recipient: string;
  message: string;
}): Promise<void> {
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

// ══════════════════════════════════════════════
// BROADCAST HELPER
// ══════════════════════════════════════════════

async function broadcastChange(
  businessId: string,
  locationId: string,
  eventType: string,
  entry: QueueEntry
): Promise<void> {
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

  // Supabase Realtime Broadcast (instant delivery, non-critical)
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );
    const channelName = `queue-events:${locationId}`;
    const channel = supabase.channel(channelName);
    await channel.send({
      type: "broadcast",
      event: "queue_change",
      payload: event,
    });
    await supabase.removeChannel(channel);
  } catch (err: any) {
    console.log(`[Realtime broadcast] Warning: ${err.message || err}`);
  }
}

// ══════════════════════════════════════════════
// TIMEZONE HELPERS
// ══════════════════════════════════════════════

/**
 * Get current date string (YYYY-MM-DD) in a specific timezone.
 */
function todayInTimezone(timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date()); // returns YYYY-MM-DD in en-CA locale
  } catch {
    return today(); // fallback to UTC
  }
}

/**
 * Get current time parts (hours, minutes) in a specific timezone.
 */
function nowInTimezone(timezone: string): { hours: number; minutes: number; dayName: string } {
  try {
    const nowDate = new Date();
    const hourFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const minuteFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      minute: "numeric",
    });
    const dayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
    });

    const hours = parseInt(hourFormatter.format(nowDate), 10);
    const minutes = parseInt(minuteFormatter.format(nowDate), 10);
    const dayName = dayFormatter.format(nowDate).toLowerCase();

    return { hours, minutes, dayName };
  } catch {
    const nowDate = new Date();
    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    return {
      hours: nowDate.getUTCHours(),
      minutes: nowDate.getUTCMinutes(),
      dayName: dayNames[nowDate.getUTCDay()],
    };
  }
}

// ══════════════════════════════════════════════
// BUSINESS HOURS VALIDATION
// ══════════════════════════════════════════════

export interface BusinessHoursCheck {
  isOpen: boolean;
  reason?: string;
  opensAt?: string;
  closesAt?: string;
  daySchedule?: any;
}

/**
 * Check if a location is currently within business hours.
 * Uses the location's timezone for time calculations.
 */
export async function checkBusinessHours(locationId: string): Promise<BusinessHoursCheck> {
  const location = await kv.get(`location:${locationId}`);
  if (!location) {
    return { isOpen: true }; // default: open if no location found
  }

  const timezone = location.timezone || "UTC";
  const hoursRecord = await kv.get(`business_hours:${locationId}`);

  if (!hoursRecord || !hoursRecord.hours) {
    return { isOpen: true }; // default: always open if no hours configured
  }

  const { hours, minutes, dayName } = nowInTimezone(timezone);
  const todaySchedule = hoursRecord.hours[dayName];

  if (!todaySchedule) {
    return { isOpen: true }; // no schedule for today = open
  }

  if (!todaySchedule.open) {
    return {
      isOpen: false,
      reason: `Closed on ${dayName.charAt(0).toUpperCase() + dayName.slice(1)}`,
      daySchedule: todaySchedule,
    };
  }

  const currentMinutes = hours * 60 + minutes;
  const [openH, openM] = (todaySchedule.openTime || "09:00").split(":").map(Number);
  const [closeH, closeM] = (todaySchedule.closeTime || "18:00").split(":").map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  if (currentMinutes < openMinutes) {
    return {
      isOpen: false,
      reason: `Not yet open — opens at ${todaySchedule.openTime}`,
      opensAt: todaySchedule.openTime,
      closesAt: todaySchedule.closeTime,
      daySchedule: todaySchedule,
    };
  }

  if (currentMinutes > closeMinutes) {
    return {
      isOpen: false,
      reason: `Closed for the day — closed at ${todaySchedule.closeTime}`,
      opensAt: todaySchedule.openTime,
      closesAt: todaySchedule.closeTime,
      daySchedule: todaySchedule,
    };
  }

  return {
    isOpen: true,
    opensAt: todaySchedule.openTime,
    closesAt: todaySchedule.closeTime,
    daySchedule: todaySchedule,
  };
}

// ══════════════════════════════════════════════
// SMART SESSION LIFECYCLE
// ══════════════════════════════════════════════

/**
 * Get or create today's session with timezone awareness.
 * The session date is computed using the location's timezone.
 * If no session exists and the location is within business hours, one is auto-created with status "open".
 * Returns null if outside business hours and no session exists.
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
  const cacheKey = `queue_session_today:${queueTypeId}:${dateStr}`;
  const existingId = await kv.get(cacheKey);

  if (existingId) {
    const session = await kv.get(`queue_session:${existingId}`);
    if (session && session.session_date === dateStr) {
      // If session is closed or archived, don't allow new entries
      return { session, businessHours };
    }
  }

  // No existing session — check if we should create one
  if (!options?.skipBusinessHoursCheck && !businessHours.isOpen) {
    // Outside business hours — create a closed session placeholder
    // so we can return a meaningful response
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

    // Track session in location sessions index
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

  // Track session in location sessions index
  await indexSessionForLocation(locationId, sessionId);

  return { session, businessHours };
}

/**
 * Index a session under its location for later retrieval.
 * KV key: location_sessions:{locationId} → string[] of session IDs
 */
async function indexSessionForLocation(locationId: string, sessionId: string): Promise<void> {
  const existing: string[] = (await kv.get(`location_sessions:${locationId}`)) || [];
  if (!existing.includes(sessionId)) {
    existing.push(sessionId);
    await kv.set(`location_sessions:${locationId}`, existing);
  }
}

/**
 * Get the currently active (open) session for a location.
 * Returns all open sessions across all queue types for this location today.
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

  // Get all queue types for this location
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
 * Called at business closing time or manually by staff.
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
      // Re-read session inside lock
      const freshSession = await kv.get(`queue_session:${sessionId}`);
      if (!freshSession || freshSession.status === "closed" || freshSession.status === "archived") {
        return { session: freshSession || session, cancelledCount: 0 };
      }

      // Get all entries for this session
      const entryIds: string[] = (await kv.get(`session_entries:${sessionId}`)) || [];
      let cancelledCount = 0;
      const timestamp = now();

      for (const eid of entryIds) {
        const entry = await kv.get(`queue_entry:${eid}`);
        if (!entry) continue;

        // Cancel WAITING and NEXT entries
        if (entry.status === "waiting" || entry.status === "next") {
          entry.status = "cancelled";
          entry.cancelled_at = timestamp;
          entry.notes = (entry.notes || "") +
            ` [Auto-cancelled: session closed${reason ? ` — ${reason}` : ""}]`;
          batch.set(`queue_entry:${eid}`, entry);
          cancelledCount++;

          // Clear NEXT pointer if applicable
          if (entry.status === "next") {
            const nextKey = `next_entry:${sessionId}:${entry.queue_type_id}`;
            batch.del(nextKey);
          }
        }
      }

      // Update session status
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
 * Typically called at business closing time.
 */
export async function closeAllSessionsForLocation(
  locationId: string,
  reason?: string
): Promise<{ closedCount: number; cancelledEntries: number }> {
  const location = await kv.get(`location:${locationId}`);
  if (!location) throw new Error(`Location ${locationId} not found`);

  const timezone = location.timezone || "UTC";
  const dateStr = todayInTimezone(timezone);

  // Find all queue types for this location
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
 * Sets status to "archived" for old closed sessions.
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

    // Only archive closed sessions older than cutoff
    if (session.status === "archived") continue;
    if (session.session_date > cutoffStr) continue;

    // If session is still "open" or "active", close it first
    if (session.status === "open" || session.status === "active") {
      await closeSession(sid, "Auto-closed for archival");
    }

    // Archive
    session.status = "archived";
    session.archived_at = now();
    session.updated_at = now();
    await kv.set(`queue_session:${sid}`, session);
    archivedCount++;
  }

  return { archivedCount };
}

/**
 * Auto-close sessions check — called periodically (e.g., every minute via cron).
 * For each location, checks if current time is past business closing time
 * and auto-closes any open sessions.
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

    // If location is closed, close any open sessions
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
 * Midnight session rotation — called at 00:00 in each location's timezone.
 * Closes any still-open sessions from the previous day and
 * optionally pre-creates sessions for the new day.
 */
export async function midnightRotation(
  locationId: string
): Promise<{ closedPrevious: number; cancelledEntries: number }> {
  const result = await closeAllSessionsForLocation(
    locationId,
    "Midnight auto-close: day ended"
  );

  // Archive old sessions while we're at it
  await archiveOldSessions(locationId, 30).catch((err) => {
    console.log(`[midnightRotation] Archive warning for ${locationId}: ${err.message}`);
  });

  return {
    closedPrevious: result.closedCount,
    cancelledEntries: result.cancelledEntries,
  };
}

// ══════════════════════════════════════════════
// 12. DUPLICATE PREVENTION
// ══════════════════════════════════════════════

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

// ══════════════════════════════════════════════
// 13. CANCEL WHILE NEXT — with auto-promote
// ══════════════════════════════════════════════

/**
 * Cancel an entry that may be in WAITING or NEXT status.
 * If the entry is NEXT, the next WAITING entry is auto-promoted.
 * Prevents cancellation of SERVED/NO_SHOW/CANCELLED entries.
 */
export async function cancelEntryEnhanced(
  entryId: string,
  staffAuthUid?: string
): Promise<{ cancelled: QueueEntry; promoted: QueueEntry | null }> {
  const entry = await kv.get(`queue_entry:${entryId}`);
  if (!entry) throw new Error(`Entry ${entryId} not found`);

  if (entry.status === "served") throw new Error("Cannot cancel — entry has already been served");
  if (entry.status === "cancelled") throw new Error("Entry is already cancelled");
  if (entry.status === "no_show") throw new Error("Cannot cancel — entry is marked as no-show");
  if (entry.status === "serving") throw new Error("Cannot cancel while being served — mark as served or no-show instead");

  const wasNext = entry.status === "next";
  const lockKey = `queue_lock:${entry.queue_session_id}:${entry.queue_type_id}`;
  const nextKey = `next_entry:${entry.queue_session_id}:${entry.queue_type_id}`;

  return await withTransaction<{ cancelled: QueueEntry; promoted: QueueEntry | null }>(
    lockKey,
    async (batch) => {
      const fresh = await kv.get(`queue_entry:${entryId}`);
      if (!fresh) throw new Error("Entry not found");
      if (fresh.status !== "waiting" && fresh.status !== "next") {
        throw new Error(`Entry can no longer be cancelled (status: ${fresh.status})`);
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
          if (e && e.queue_type_id === fresh.queue_type_id && e.status === "waiting") {
            candidates.push(e);
          }
        }

        candidates.sort((a, b) => {
          if (b.priority !== a.priority) return b.priority - a.priority;
          if ((a.position || 0) !== (b.position || 0)) return (a.position || 0) - (b.position || 0);
          return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
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

      await recalcPositions(fresh.queue_session_id, fresh.queue_type_id, batch, entryId);
      return { cancelled: fresh, promoted };
    }
  ).then(async (result) => {
    await broadcastChange(entry.business_id, entry.location_id, "entry_cancelled", result.cancelled).catch(() => { });
    const actorName = staffAuthUid ? await getStaffName(staffAuthUid) : "Customer";
    await writeAuditLog({
      locationId: entry.location_id, businessId: entry.business_id, eventType: "CANCELLED",
      actorName, actorId: staffAuthUid || null, customerName: entry.customer_name,
      ticketNumber: entry.ticket_number, queueTypeName: entry.queue_type_name,
      queueTypeId: entry.queue_type_id, entryId: entry.id, sessionId: entry.queue_session_id,
      details: wasNext ? "Cancelled while in NEXT status" : undefined,
    });
    if (result.promoted) {
      await broadcastChange(result.promoted.business_id, result.promoted.location_id, "entry_called", result.promoted).catch(() => { });
      await writeAuditLog({
        locationId: result.promoted.location_id, businessId: result.promoted.business_id,
        eventType: "CALLED_NEXT", actorName: "System", actorId: null,
        customerName: result.promoted.customer_name, ticketNumber: result.promoted.ticket_number,
        queueTypeName: result.promoted.queue_type_name, queueTypeId: result.promoted.queue_type_id,
        entryId: result.promoted.id, sessionId: result.promoted.queue_session_id,
        details: "Auto-promoted after NEXT entry was cancelled",
      });
    }
    return result;
  });
}

// ══════════════════════════════════════════════
// 14. AUTO NO-SHOW — Check stale NEXT entries
// ══════════════════════════════════════════════

/**
 * Scan a location for NEXT entries older than `timeoutMinutes`.
 * Marks them NO_SHOW and auto-promotes the next waiting entry.
 */
export async function processAutoNoShows(
  locationId: string,
  timeoutMinutes: number = DEFAULT_AUTO_NOSHOW_TIMEOUT_MINUTES
): Promise<{ noShowCount: number; promotedCount: number }> {
  const entryIds: string[] = (await kv.get(`location_entries:${locationId}`)) || [];
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
      const result = await withTransaction<{ promoted: boolean }>(lockKey, async (batch) => {
        const fresh = await kv.get(`queue_entry:${staleEntry.id}`);
        if (!fresh || fresh.status !== "next") throw new Error("skip");

        fresh.status = "no_show";
        fresh.cancelled_at = now();
        fresh.notes = (fresh.notes || "") + ` [Auto no-show: ${timeoutMinutes}min timeout]`;
        batch.set(`queue_entry:${staleEntry.id}`, fresh);
        batch.del(nextKey);

        const sessionEntryIds: string[] = (await kv.get(`session_entries:${fresh.queue_session_id}`)) || [];
        const candidates: QueueEntry[] = [];
        for (const eid of sessionEntryIds) {
          if (eid === staleEntry.id) continue;
          const e = await kv.get(`queue_entry:${eid}`);
          if (e && e.queue_type_id === fresh.queue_type_id && e.status === "waiting") candidates.push(e);
        }
        candidates.sort((a, b) => {
          if (b.priority !== a.priority) return b.priority - a.priority;
          if ((a.position || 0) !== (b.position || 0)) return (a.position || 0) - (b.position || 0);
          return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
        });

        let promoted = false;
        if (candidates.length > 0) {
          const next = candidates[0];
          next.status = "next"; next.called_at = now(); next.served_by = fresh.served_by;
          batch.set(`queue_entry:${next.id}`, next);
          batch.set(nextKey, next.id);
          promoted = true;
        }
        await recalcPositions(fresh.queue_session_id, fresh.queue_type_id, batch, staleEntry.id);
        return { promoted };
      });

      noShowCount++;
      if (result.promoted) promotedCount++;

      await writeAuditLog({
        locationId: staleEntry.location_id, businessId: staleEntry.business_id,
        eventType: "AUTO_NO_SHOW", actorName: "System", actorId: null,
        customerName: staleEntry.customer_name, ticketNumber: staleEntry.ticket_number,
        queueTypeName: staleEntry.queue_type_name, queueTypeId: staleEntry.queue_type_id,
        entryId: staleEntry.id, sessionId: staleEntry.queue_session_id,
        details: `Auto no-show after ${timeoutMinutes} min in NEXT status`,
      });
      await broadcastChange(staleEntry.business_id, staleEntry.location_id, "entry_noshow", staleEntry).catch(() => { });
    } catch {
      // skip
    }
  }
  return { noShowCount, promotedCount };
}

// ══════════════════════════════════════════════
// 15. MARK PREVIOUS AS SERVED
// ══════════════════════════════════════════════

/**
 * Find the most recent SERVING or NEXT entry for a queue type in a session
 * and mark it as SERVED. Useful when staff forgets to mark served.
 */
export async function markPreviousAsServed(params: {
  queueTypeId: string;
  sessionId: string;
  staffAuthUid: string;
}): Promise<QueueEntry | null> {
  const { queueTypeId, sessionId, staffAuthUid } = params;
  await validateStaffForQueueType(staffAuthUid, queueTypeId);

  const sessionEntryIds: string[] = (await kv.get(`session_entries:${sessionId}`)) || [];
  const servingEntries: QueueEntry[] = [];
  for (const eid of sessionEntryIds) {
    const e = await kv.get(`queue_entry:${eid}`);
    if (e && e.queue_type_id === queueTypeId && (e.status === "serving" || e.status === "next")) {
      servingEntries.push(e);
    }
  }

  if (servingEntries.length === 0) return null;

  servingEntries.sort((a, b) =>
    new Date(b.called_at || b.joined_at).getTime() - new Date(a.called_at || a.joined_at).getTime()
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
    await broadcastChange(entry.business_id, entry.location_id, "entry_served", entry).catch(() => { });
    const staffName = await getStaffName(staffAuthUid);
    await writeAuditLog({
      locationId: entry.location_id, businessId: entry.business_id,
      eventType: "MARK_PREVIOUS_SERVED", actorName: staffName, actorId: staffAuthUid,
      customerName: entry.customer_name, ticketNumber: entry.ticket_number,
      queueTypeName: entry.queue_type_name, queueTypeId: entry.queue_type_id,
      entryId: entry.id, sessionId: entry.queue_session_id,
      details: "Staff manually marked previous entry as served (forgot earlier)",
    });
    return entry;
  });
}
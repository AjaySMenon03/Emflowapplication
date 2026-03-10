/**
 * Quecumber — Queue Logic Barrel Re-export
 *
 * This file re-exports everything from the queue submodules so that
 * consumers can simply do:
 *   import * as queueLogic from "./queue/index.ts";
 */

// Types
export type {
  QueueEntryStatus,
  SessionStatus,
  QueueSession,
  QueueEntry,
  LockRecord,
  AuditEventType,
  AuditLogEntry,
  BusinessHoursCheck,
} from "./types.ts";

export { DEFAULT_AUTO_NOSHOW_TIMEOUT_MINUTES } from "./types.ts";

// Helpers
export { uuid, now, today, sleep } from "./helpers.ts";

// Audit
export { writeAuditLog, readAuditLog, getStaffName } from "./audit.ts";

// Lock / Transaction
export { acquireLock, releaseLock } from "./lock.ts";
export { TransactionBatch, withTransaction } from "./transaction.ts";

// Validation
export {
  validateSessionActive,
  validateStaffForQueueType,
} from "./validation.ts";

// Broadcast
export { broadcastChange } from "./broadcast.ts";

// Timezone / Business Hours
export { todayInTimezone, nowInTimezone } from "./timezone.ts";
export { checkBusinessHours } from "./business-hours.ts";

// Entry
export {
  createQueueEntry,
  calculatePosition,
  calculateETA,
  recalcPositions,
} from "./entry.ts";

// Operations
export {
  callNext,
  startServing,
  markServed,
  markNoShow,
  cancelEntry,
  moveEntry,
  reassignStaff,
  cancelEntryEnhanced,
  markPreviousAsServed,
} from "./operations.ts";

// Session
export {
  getOrCreateTodaySession,
  getOrCreateTodaySessionSmart,
  getActiveSession,
  closeSession,
  closeAllSessionsForLocation,
  archiveOldSessions,
  autoCloseExpiredSessions,
  midnightRotation,
} from "./session.ts";

// Read Helpers
export {
  getLocationEntries,
  getSessionEntries,
  getQueueTypesForLocation,
  countActiveEntries,
  calculateTotalBacklogTime,
  isServiceExhausted,
  isCounterAtDailyCapacity,
} from "./read-helpers.ts";

// Duplicate
export { checkDuplicateEntry } from "./duplicate.ts";

// Waitlist
export { promoteFromWaitlist } from "./waitlist.ts";

// Auto No-Show
export { processAutoNoShows } from "./auto-noshow.ts";

// Notification
export { logNotification } from "./notification.ts";

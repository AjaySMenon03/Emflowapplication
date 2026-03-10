/**
 * Quecumber — Queue Logic Types
 */

export type QueueEntryStatus =
  | "waiting"
  | "next"
  | "serving"
  | "served"
  | "cancelled"
  | "no_show"
  | "waitlisted";

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
  // Service info
  service_id: string | null;
  service_name: string | null;
  waitlist_number?: number;
}

export interface LockRecord {
  id: string;
  acquired_at: number;
}

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
  | "EMERGENCY_BROADCAST_CLEAR"
  | "PROMOTED_FROM_WAITLIST";

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

export interface BusinessHoursCheck {
  isOpen: boolean;
  reason?: string;
  opensAt?: string;
  closesAt?: string;
  daySchedule?: any;
}

/** Default timeout (minutes) before NEXT entries are auto-marked NO_SHOW */
export const DEFAULT_AUTO_NOSHOW_TIMEOUT_MINUTES = 10;

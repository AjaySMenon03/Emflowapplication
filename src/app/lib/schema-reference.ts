/**
 * EM Flow - SQL Schema Reference
 *
 * This file documents the intended relational database schema.
 * In this prototype, data is stored in a KV store with structured keys.
 * When deploying to production, create these tables in Supabase SQL Editor.
 *
 * KV Key Patterns (current implementation):
 *   staff_user:{auth_uid}        → StaffUser record
 *   customer:{auth_uid}          → Customer record
 *   business:{uuid}              → Business record
 *   location:{uuid}              → Location record
 *   queue_type:{uuid}            → QueueType record
 *   business_locations:{biz_id}  → string[] of location IDs
 *   business_queue_types:{biz_id}→ string[] of queue type IDs
 *   business_staff:{biz_id}      → string[] of staff auth UIDs
 *   business_hours:{loc_id}      → BusinessHours record
 *   business_owner:{biz_id}      → owner auth UID
 *   whatsapp_settings:{biz_id}   → WhatsApp config
 *   location_sessions:{loc_id}  → string[] of session IDs (for lifecycle tracking)
 *   queue_session_today:{qt_id}:{date} → session ID for today's session
 *   session_entries:{session_id}→ string[] of entry IDs
 *   location_entries:{loc_id}   → string[] of entry IDs
 *   queue_lock:{sid}:{qtid}     → Lock record (distributed mutex)
 *   next_entry:{sid}:{qtid}     → entry ID of current NEXT
 *   customer_entries:{auth_uid} → string[] of entry IDs (retention analytics)
 *
 * ─── Analytics Computed Metrics ───
 *   The advanced analytics endpoint (/analytics/advanced/:locationId)
 *   computes all metrics from location_entries and queue_entry records:
 *   - KPIs with % change vs previous period
 *   - Queue Health Score (0-100): wait factor (40%), no-show factor (30%), load factor (30%)
 *   - Staff Performance Leaderboard with efficiency scores
 *   - Hourly Heatmap (Day of Week x Hour matrix)
 *   - Service Type Analysis (avg wait/service per queue_type)
 *   - 30-Day Trend with 7-Day Simple Moving Average
 *   - Predictive Trend Direction (up/stable/down)
 *
 * ─── Session Status Lifecycle ───
 *   OPEN → CLOSED → ARCHIVED
 *   - Auto-created as OPEN on first join (if within business hours)
 *   - Auto-closed at business closing time (WAITING→CANCELLED)
 *   - Archived after 30 days
 *
 * ─── Production SQL Schema ───
 *
 * -- Enum types
 * CREATE TYPE user_role AS ENUM ('owner', 'admin', 'staff');
 * CREATE TYPE entity_status AS ENUM ('active', 'inactive', 'archived');
 * CREATE TYPE queue_entry_status AS ENUM ('waiting', 'next', 'serving', 'served', 'cancelled', 'no_show');
 * CREATE TYPE session_status AS ENUM ('open', 'closed', 'archived');
 * CREATE TYPE notification_channel AS ENUM ('sms', 'whatsapp', 'email', 'push');
 *
 * -- Business (multi-tenant root)
 * CREATE TABLE business (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   name TEXT NOT NULL,
 *   industry TEXT,
 *   phone TEXT,
 *   email TEXT,
 *   address TEXT,
 *   owner_id UUID REFERENCES auth.users(id),
 *   status entity_status DEFAULT 'active',
 *   created_at TIMESTAMPTZ DEFAULT now(),
 *   updated_at TIMESTAMPTZ DEFAULT now()
 * );
 *
 * -- Location (belongs to business)
 * CREATE TABLE location (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   business_id UUID NOT NULL REFERENCES business(id) ON DELETE CASCADE,
 *   name TEXT NOT NULL,
 *   address TEXT,
 *   city TEXT,
 *   phone TEXT,
 *   timezone TEXT DEFAULT 'Europe/Istanbul',
 *   status entity_status DEFAULT 'active',
 *   created_at TIMESTAMPTZ DEFAULT now(),
 *   updated_at TIMESTAMPTZ DEFAULT now()
 * );
 * CREATE INDEX idx_location_business ON location(business_id);
 *
 * -- Queue Type (service categories per location)
 * CREATE TABLE queue_type (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   business_id UUID NOT NULL REFERENCES business(id) ON DELETE CASCADE,
 *   location_id UUID NOT NULL REFERENCES location(id) ON DELETE CASCADE,
 *   name TEXT NOT NULL,
 *   prefix VARCHAR(3) NOT NULL,
 *   description TEXT,
 *   estimated_service_time INT DEFAULT 10,
 *   max_capacity INT DEFAULT 100,
 *   status entity_status DEFAULT 'active',
 *   sort_order INT DEFAULT 0,
 *   created_at TIMESTAMPTZ DEFAULT now(),
 *   updated_at TIMESTAMPTZ DEFAULT now()
 * );
 * CREATE INDEX idx_queue_type_location ON queue_type(location_id);
 * CREATE INDEX idx_queue_type_business ON queue_type(business_id);
 *
 * -- Staff User (linked to Supabase auth)
 * CREATE TABLE staff_user (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 *   business_id UUID NOT NULL REFERENCES business(id) ON DELETE CASCADE,
 *   email TEXT NOT NULL,
 *   name TEXT NOT NULL,
 *   role user_role DEFAULT 'staff',
 *   status entity_status DEFAULT 'active',
 *   created_at TIMESTAMPTZ DEFAULT now(),
 *   updated_at TIMESTAMPTZ DEFAULT now(),
 *   UNIQUE(auth_user_id, business_id)
 * );
 * CREATE INDEX idx_staff_auth ON staff_user(auth_user_id);
 * CREATE INDEX idx_staff_business ON staff_user(business_id);
 *
 * -- Staff-Location junction (allowed locations)
 * CREATE TABLE staff_location (
 *   staff_user_id UUID REFERENCES staff_user(id) ON DELETE CASCADE,
 *   location_id UUID REFERENCES location(id) ON DELETE CASCADE,
 *   PRIMARY KEY (staff_user_id, location_id)
 * );
 *
 * -- Customer (linked to Supabase auth)
 * CREATE TABLE customer (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   auth_user_id UUID REFERENCES auth.users(id),
 *   name TEXT,
 *   phone TEXT,
 *   email TEXT,
 *   created_at TIMESTAMPTZ DEFAULT now(),
 *   updated_at TIMESTAMPTZ DEFAULT now()
 * );
 * CREATE INDEX idx_customer_auth ON customer(auth_user_id);
 *
 * -- Queue Session (daily session per queue type)
 * CREATE TABLE queue_session (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   queue_type_id UUID NOT NULL REFERENCES queue_type(id),
 *   location_id UUID NOT NULL REFERENCES location(id),
 *   business_id UUID NOT NULL REFERENCES business(id),
 *   session_date DATE NOT NULL DEFAULT CURRENT_DATE,
 *   status session_status DEFAULT 'open',
 *   current_number INT DEFAULT 0,
 *   last_called_number INT DEFAULT 0,
 *   closed_at TIMESTAMPTZ,
 *   archived_at TIMESTAMPTZ,
 *   created_at TIMESTAMPTZ DEFAULT now(),
 *   updated_at TIMESTAMPTZ DEFAULT now(),
 *   UNIQUE(queue_type_id, session_date)
 * );
 * CREATE INDEX idx_session_date ON queue_session(session_date);
 * CREATE INDEX idx_session_location ON queue_session(location_id);
 *
 * -- Queue Entry (individual ticket)
 * CREATE TABLE queue_entry (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   queue_session_id UUID NOT NULL REFERENCES queue_session(id),
 *   queue_type_id UUID NOT NULL REFERENCES queue_type(id),
 *   customer_id UUID REFERENCES customer(id),
 *   business_id UUID NOT NULL REFERENCES business(id),
 *   ticket_number TEXT NOT NULL,
 *   status queue_entry_status DEFAULT 'waiting',
 *   priority INT DEFAULT 0,
 *   served_by UUID REFERENCES staff_user(id),
 *   joined_at TIMESTAMPTZ DEFAULT now(),
 *   called_at TIMESTAMPTZ,
 *   served_at TIMESTAMPTZ,
 *   completed_at TIMESTAMPTZ,
 *   cancelled_at TIMESTAMPTZ,
 *   estimated_wait_minutes INT,
 *   notes TEXT,
 *   created_at TIMESTAMPTZ DEFAULT now()
 * );
 * CREATE INDEX idx_entry_session ON queue_entry(queue_session_id);
 * CREATE INDEX idx_entry_customer ON queue_entry(customer_id);
 * CREATE INDEX idx_entry_status ON queue_entry(status);
 * CREATE INDEX idx_entry_business ON queue_entry(business_id);
 *
 * -- Notification Log
 * CREATE TABLE notification_log (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   queue_entry_id UUID REFERENCES queue_entry(id),
 *   customer_id UUID REFERENCES customer(id),
 *   business_id UUID NOT NULL REFERENCES business(id),
 *   channel notification_channel NOT NULL,
 *   recipient TEXT NOT NULL,
 *   message TEXT NOT NULL,
 *   status TEXT DEFAULT 'pending',
 *   sent_at TIMESTAMPTZ,
 *   created_at TIMESTAMPTZ DEFAULT now()
 * );
 * CREATE INDEX idx_notification_entry ON notification_log(queue_entry_id);
 *
 * ─── Row Level Security Policies ───
 *
 * -- Enable RLS on all tables
 * ALTER TABLE business ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE location ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE queue_type ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE staff_user ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE customer ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE queue_session ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE queue_entry ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
 *
 * -- Business isolation: staff can only see their business
 * CREATE POLICY "Staff sees own business" ON business
 *   FOR SELECT USING (
 *     id IN (SELECT business_id FROM staff_user WHERE auth_user_id = auth.uid())
 *   );
 *
 * -- Location: staff only sees locations in their business
 * CREATE POLICY "Staff sees business locations" ON location
 *   FOR SELECT USING (
 *     business_id IN (SELECT business_id FROM staff_user WHERE auth_user_id = auth.uid())
 *   );
 *
 * -- Queue Type: scoped to business
 * CREATE POLICY "Staff sees business queue types" ON queue_type
 *   FOR SELECT USING (
 *     business_id IN (SELECT business_id FROM staff_user WHERE auth_user_id = auth.uid())
 *   );
 *
 * -- Staff: scoped to own business, can see colleagues
 * CREATE POLICY "Staff sees own business staff" ON staff_user
 *   FOR SELECT USING (
 *     business_id IN (SELECT business_id FROM staff_user WHERE auth_user_id = auth.uid())
 *   );
 *
 * -- Customer: can only see own record
 * CREATE POLICY "Customer sees own record" ON customer
 *   FOR SELECT USING (auth_user_id = auth.uid());
 *
 * -- Queue Entry: staff sees business entries, customer sees own
 * CREATE POLICY "Staff sees business entries" ON queue_entry
 *   FOR SELECT USING (
 *     business_id IN (SELECT business_id FROM staff_user WHERE auth_user_id = auth.uid())
 *   );
 * CREATE POLICY "Customer sees own entries" ON queue_entry
 *   FOR SELECT USING (
 *     customer_id IN (SELECT id FROM customer WHERE auth_user_id = auth.uid())
 *   );
 *
 * -- Notification: staff sees business notifications
 * CREATE POLICY "Staff sees business notifications" ON notification_log
 *   FOR SELECT USING (
 *     business_id IN (SELECT business_id FROM staff_user WHERE auth_user_id = auth.uid())
 *   );
 */

export type EntityStatus = "active" | "inactive" | "archived";
export type UserRole = "owner" | "admin" | "staff";
export type QueueEntryStatus = "waiting" | "next" | "serving" | "served" | "cancelled" | "no_show";
export type SessionStatus = "open" | "closed" | "archived";
export type NotificationChannel = "sms" | "whatsapp" | "email" | "push";

export interface Business {
  id: string;
  name: string;
  industry: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  owner_id: string;
  status: EntityStatus;
  created_at: string;
  updated_at: string;
}

export interface Location {
  id: string;
  business_id: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  timezone: string;
  status: EntityStatus;
  created_at: string;
  updated_at: string;
}

export interface QueueType {
  id: string;
  business_id: string;
  location_id: string;
  name: string;
  prefix: string;
  description: string | null;
  estimated_service_time: number;
  max_capacity: number;
  status: EntityStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface StaffUser {
  id: string;
  auth_user_id: string;
  business_id: string;
  email: string;
  name: string;
  role: UserRole;
  status: EntityStatus;
  locations: string[];
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  auth_user_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
}

export interface QueueSession {
  id: string;
  queue_type_id: string;
  location_id: string;
  business_id: string;
  session_date: string;
  status: SessionStatus;
  current_number: number;
  last_called_number: number;
  closed_at?: string;
  archived_at?: string;
  created_at: string;
  updated_at: string;
}

export interface BusinessHoursCheck {
  isOpen: boolean;
  reason?: string;
  opensAt?: string;
  closesAt?: string;
  daySchedule?: any;
}

export interface QueueEntry {
  id: string;
  queue_session_id: string;
  queue_type_id: string;
  customer_id: string | null;
  business_id: string;
  ticket_number: string;
  status: QueueEntryStatus;
  priority: number;
  served_by: string | null;
  joined_at: string;
  called_at: string | null;
  served_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  estimated_wait_minutes: number | null;
  notes: string | null;
  created_at: string;
}

export interface NotificationLog {
  id: string;
  queue_entry_id: string | null;
  customer_id: string | null;
  business_id: string;
  channel: NotificationChannel;
  recipient: string;
  message: string;
  status: string;
  sent_at: string | null;
  created_at: string;
}
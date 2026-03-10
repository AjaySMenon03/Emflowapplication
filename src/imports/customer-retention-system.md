Enhance Quecumber by building a complete Customer Retention System.
Stack:

- Next.js 14 (App Router)
- Supabase (Auth + PostgreSQL)
- Supabase Realtime
- TailwindCSS
- next-intl (multilingual)
  Goal: Turn customer accounts into a lightweight retention dashboard that increases repeat visits and engagement.

1️⃣ CUSTOMER DASHBOARD ROUTE
Create: /customer/dashboard
Only accessible to authenticated customers.
Show:

- Welcome message (localized)
- Total visits
- Average wait time
- Last visit date
- Most used service (queue_type)
- No-show count (if any)
  Use aggregated SQL queries for performance.

2️⃣ VISIT HISTORY PAGE
Route: /customer/history
Show paginated table or cards:

- Location name
- Queue type (service)
- Date
- Wait time (called_at - created_at)
- Service time (served_at - called_at)
- Final status (SERVED / CANCELLED / NO_SHOW)
  Sort by most recent first.
  Add filter:
- By location
- By service
- By date range

3️⃣ CUSTOMER PROFILE MANAGEMENT
Route: /customer/profile
Editable fields:

- Name
- Phone
- Preferred language
  Email should be read-only (from Supabase auth).
  On update:
- Sync to customer table
- Update preferred_language

4️⃣ RETURNING CUSTOMER AUTO-FILL
On /join/[locationSlug]:
If logged in:

- Auto-fill name, phone, email
- Highlight “Welcome back”
  If not logged in:
- Allow join as guest
- After join success → show: “Save your visit history? Continue with login”

5️⃣ CUSTOMER ANALYTICS LOGIC
Create SQL views:
View: customer_summary

- total_visits
- avg_wait_time
- avg_service_time
- no_show_rate
  View: customer_most_used_service
- queue_type_id
- count
  Optimize queries using indexes on:
- customer_id
- created_at
- location_id

6️⃣ PREMIUM UI EXPERIENCE
Design direction:

- Clean modern SaaS
- Soft gradients
- Card-based layout
- Animated counters
- Subtle micro-interactions
  Add:
- Empty state illustration if no history
- CTA: “Book Again” (redirect to join page of last location)

7️⃣ MULTILINGUAL SUPPORT
All labels must use next-intl. Languages:

- English
- Hindi
- Tamil
- Malayalam
  Extract all static text to translation JSON files.

8️⃣ SECURITY
Enforce RLS:

- Customer can only view their own queue_entry records.
  Prevent access via URL manipulation.

9️⃣ OPTIONAL RETENTION BOOSTER
If last visit > 30 days: Show: “We miss you 👋 Visit again soon.”
If no-show rate > 30%: Show friendly reminder about arrival timing.

10️⃣ PERFORMANCE

- Use server components where possible.
- Avoid N+1 queries.
- Use aggregated SQL instead of client-side calculations.

Deliver:

- Complete routes
- SQL view definitions
- RLS policies if required
- Clean reusable components
  Keep architecture modular and scalable for future loyalty integration.

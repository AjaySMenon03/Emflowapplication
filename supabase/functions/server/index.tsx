import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import * as kv from "./kv_store.tsx";
import * as queueLogic from "./queue-logic.tsx";
import * as whatsapp from "./whatsapp.tsx";

const app = new Hono();

app.use("*", logger(console.log));

app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  })
);

// ── Helpers ──

function supabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  );
}

async function getAuthUser(c: any) {
  const token = c.req.header("Authorization")?.split(" ")[1];
  if (!token) return null;
  const supabase = supabaseAdmin();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user?.id) return null;
  return user;
}

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

// ══════════════════════════════════════════════
// HEALTH
// ══════════════════════════════════════════════

app.get("/make-server-5252bcc1/health", (c) => {
  return c.json({ status: "ok" });
});

// ══════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════

app.post("/make-server-5252bcc1/auth/signup", async (c) => {
  try {
    const { email, password, name } = await c.req.json();
    if (!email || !password) {
      return c.json({ error: "Email and password are required" }, 400);
    }
    const supabase = supabaseAdmin();
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name: name || "" },
      email_confirm: true,
    });
    if (error) return c.json({ error: `Signup error: ${error.message}` }, 400);
    return c.json({ user: data.user });
  } catch (err) {
    return c.json({ error: `Signup failed: ${err.message}` }, 500);
  }
});

app.get("/make-server-5252bcc1/auth/role", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user)
      return c.json(
        { error: "Unauthorized - invalid token while checking role" },
        401
      );

    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (staffRecord) {
      return c.json({
        role: staffRecord.role || "staff",
        businessId: staffRecord.business_id,
        hasOnboarded: true,
        record: staffRecord,
      });
    }
    const customerRecord = await kv.get(`customer:${user.id}`);
    if (customerRecord) {
      return c.json({
        role: "customer",
        hasOnboarded: true,
        record: customerRecord,
      });
    }
    return c.json({ role: null, hasOnboarded: false, record: null });
  } catch (err) {
    return c.json({ error: `Role check failed: ${err.message}` }, 500);
  }
});

// ══════════════════════════════════════════════
// ONBOARDING (unchanged)
// ══════════════════════════════════════════════

app.post("/make-server-5252bcc1/onboarding/business", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user)
      return c.json({ error: "Unauthorized while creating business" }, 401);

    const body = await c.req.json();
    const businessId = uuid();
    const timestamp = now();

    const business = {
      id: businessId,
      name: body.name,
      slug: (body.name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
      industry: body.industry || null,
      phone: body.phone || null,
      email: body.email || user.email,
      address: body.address || null,
      owner_id: user.id,
      status: "active",
      created_at: timestamp,
      updated_at: timestamp,
    };

    await kv.set(`business:${businessId}`, business);

    const staffUser = {
      id: uuid(),
      auth_user_id: user.id,
      business_id: businessId,
      email: user.email,
      name: user.user_metadata?.name || body.ownerName || "",
      role: "owner",
      status: "active",
      locations: [],
      created_at: timestamp,
      updated_at: timestamp,
    };

    await kv.set(`staff_user:${user.id}`, staffUser);
    await kv.set(`business_owner:${businessId}`, user.id);

    return c.json({ business, staffUser });
  } catch (err) {
    return c.json(
      { error: `Business creation failed: ${err.message}` },
      500
    );
  }
});

app.post("/make-server-5252bcc1/onboarding/location", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user)
      return c.json({ error: "Unauthorized while creating location" }, 401);

    const body = await c.req.json();
    const locationId = uuid();
    const timestamp = now();

    const slug = (body.name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const location = {
      id: locationId,
      business_id: body.businessId,
      name: body.name,
      slug,
      address: body.address || null,
      city: body.city || null,
      phone: body.phone || null,
      status: "active",
      timezone: body.timezone || "Europe/Istanbul",
      created_at: timestamp,
      updated_at: timestamp,
    };

    await kv.set(`location:${locationId}`, location);
    // Slug lookup
    await kv.set(`location_slug:${slug}`, locationId);

    const existingLocations =
      (await kv.get(`business_locations:${body.businessId}`)) || [];
    existingLocations.push(locationId);
    await kv.set(
      `business_locations:${body.businessId}`,
      existingLocations
    );

    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (staffRecord) {
      staffRecord.locations = [
        ...(staffRecord.locations || []),
        locationId,
      ];
      staffRecord.updated_at = timestamp;
      await kv.set(`staff_user:${user.id}`, staffRecord);
    }

    return c.json({ location });
  } catch (err) {
    return c.json(
      { error: `Location creation failed: ${err.message}` },
      500
    );
  }
});

app.post("/make-server-5252bcc1/onboarding/queue-types", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user)
      return c.json(
        { error: "Unauthorized while creating queue types" },
        401
      );

    const body = await c.req.json();
    const { businessId, locationId, queueTypes } = body;
    const timestamp = now();
    const created: any[] = [];

    for (const qt of queueTypes) {
      const queueTypeId = uuid();
      const queueType = {
        id: queueTypeId,
        business_id: businessId,
        location_id: locationId,
        name: qt.name,
        prefix: qt.prefix || qt.name.charAt(0).toUpperCase(),
        description: qt.description || null,
        estimated_service_time: qt.estimatedServiceTime || 10,
        max_capacity: qt.maxCapacity || 100,
        status: "active",
        sort_order: qt.sortOrder || created.length,
        created_at: timestamp,
        updated_at: timestamp,
      };
      await kv.set(`queue_type:${queueTypeId}`, queueType);
      created.push(queueType);
    }

    const existing =
      (await kv.get(`business_queue_types:${businessId}`)) || [];
    const newIds = created.map((q: any) => q.id);
    await kv.set(`business_queue_types:${businessId}`, [
      ...existing,
      ...newIds,
    ]);

    return c.json({ queueTypes: created });
  } catch (err) {
    return c.json(
      { error: `Queue type creation failed: ${err.message}` },
      500
    );
  }
});

app.post("/make-server-5252bcc1/onboarding/business-hours", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user)
      return c.json(
        { error: "Unauthorized while saving business hours" },
        401
      );
    const body = await c.req.json();
    await kv.set(`business_hours:${body.locationId}`, {
      business_id: body.businessId,
      location_id: body.locationId,
      hours: body.hours,
      updated_at: now(),
    });
    return c.json({ success: true });
  } catch (err) {
    return c.json(
      { error: `Business hours save failed: ${err.message}` },
      500
    );
  }
});

app.post("/make-server-5252bcc1/onboarding/whatsapp", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user)
      return c.json(
        { error: "Unauthorized while saving WhatsApp settings" },
        401
      );
    const body = await c.req.json();
    await kv.set(`whatsapp_settings:${body.businessId}`, {
      business_id: body.businessId,
      enabled: !!body.enabled,
      phone_number: body.phoneNumber || null,
      updated_at: now(),
    });
    return c.json({ success: true });
  } catch (err) {
    return c.json(
      { error: `WhatsApp settings save failed: ${err.message}` },
      500
    );
  }
});

app.post("/make-server-5252bcc1/onboarding/staff", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user)
      return c.json({ error: "Unauthorized while adding staff" }, 401);

    const body = await c.req.json();
    const { businessId, locationId, staffMembers } = body;
    const timestamp = now();
    const created: any[] = [];
    const supabase = supabaseAdmin();

    for (const member of staffMembers) {
      const { data: authData, error: authError } =
        await supabase.auth.admin.createUser({
          email: member.email,
          password: member.password || "EMFlow2026!",
          user_metadata: { name: member.name },
          email_confirm: true,
        });

      if (authError) {
        console.log(
          `Staff creation warning for ${member.email}: ${authError.message}`
        );
        continue;
      }

      const staffUser = {
        id: uuid(),
        auth_user_id: authData.user.id,
        business_id: businessId,
        email: member.email,
        name: member.name,
        role: member.role || "staff",
        status: "active",
        locations: [locationId],
        created_at: timestamp,
        updated_at: timestamp,
      };

      await kv.set(`staff_user:${authData.user.id}`, staffUser);
      created.push(staffUser);
    }

    const existing =
      (await kv.get(`business_staff:${businessId}`)) || [];
    const newIds = created.map((s: any) => s.auth_user_id);
    await kv.set(`business_staff:${businessId}`, [
      ...existing,
      ...newIds,
    ]);

    return c.json({ staff: created });
  } catch (err) {
    return c.json(
      { error: `Staff creation failed: ${err.message}` },
      500
    );
  }
});

app.post("/make-server-5252bcc1/onboarding/complete", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user)
      return c.json(
        { error: "Unauthorized while completing onboarding" },
        401
      );

    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (staffRecord) {
      staffRecord.onboarding_completed = true;
      staffRecord.updated_at = now();
      await kv.set(`staff_user:${user.id}`, staffRecord);
    }

    return c.json({ success: true, redirectTo: "/admin" });
  } catch (err) {
    return c.json(
      { error: `Onboarding completion failed: ${err.message}` },
      500
    );
  }
});

// ══════════════════════════════════════════════
// DATA: Business / Location
// ══════════════════════════════════════════════

app.get("/make-server-5252bcc1/business/:id", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const businessId = c.req.param("id");
    const business = await kv.get(`business:${businessId}`);
    if (!business) return c.json({ error: "Business not found" }, 404);
    return c.json({ business });
  } catch (err) {
    return c.json(
      { error: `Business fetch failed: ${err.message}` },
      500
    );
  }
});

// Get locations for a business (staff)
app.get("/make-server-5252bcc1/business/:id/locations", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const businessId = c.req.param("id");
    const locationIds: string[] =
      (await kv.get(`business_locations:${businessId}`)) || [];
    const locations: any[] = [];
    for (const lid of locationIds) {
      const loc = await kv.get(`location:${lid}`);
      if (loc) locations.push(loc);
    }
    return c.json({ locations });
  } catch (err) {
    return c.json(
      { error: `Locations fetch failed: ${err.message}` },
      500
    );
  }
});

// ══════════════════════════════════════════════
// PUBLIC: Location by slug (no auth)
// ══════════════════════════════════════════════

app.get("/make-server-5252bcc1/public/location/:slug", async (c) => {
  try {
    const slug = c.req.param("slug");
    const locationId = await kv.get(`location_slug:${slug}`);
    if (!locationId)
      return c.json({ error: "Location not found" }, 404);

    const location = await kv.get(`location:${locationId}`);
    if (!location)
      return c.json({ error: "Location not found" }, 404);

    const business = await kv.get(`business:${location.business_id}`);
    const queueTypes = await queueLogic.getQueueTypesForLocation(
      locationId,
      location.business_id
    );

    return c.json({ location, business, queueTypes });
  } catch (err) {
    return c.json(
      { error: `Public location fetch failed: ${err.message}` },
      500
    );
  }
});

// Also support fetching location by ID (for kiosk)
app.get("/make-server-5252bcc1/public/location-by-id/:id", async (c) => {
  try {
    const locationId = c.req.param("id");
    const location = await kv.get(`location:${locationId}`);
    if (!location)
      return c.json({ error: "Location not found" }, 404);

    const business = await kv.get(`business:${location.business_id}`);
    const queueTypes = await queueLogic.getQueueTypesForLocation(
      locationId,
      location.business_id
    );

    return c.json({ location, business, queueTypes });
  } catch (err) {
    return c.json(
      { error: `Location by ID fetch failed: ${err.message}` },
      500
    );
  }
});

// ══════════════════════════════════════════════
// QUEUE: Customer Join (public — no auth)
// ══════════════════════════════════════════════

app.post("/make-server-5252bcc1/public/queue/join", async (c) => {
  try {
    const body = await c.req.json();
    const { queueTypeId, locationId, businessId, name, phone, email, locale } =
      body;

    if (!queueTypeId || !locationId || !businessId) {
      return c.json(
        { error: "queueTypeId, locationId, and businessId are required" },
        400
      );
    }
    if (!name?.trim()) {
      return c.json({ error: "Name is required" }, 400);
    }

    // Create or find customer
    let customerId: string | null = null;
    if (phone || email) {
      customerId = uuid();
      await kv.set(`customer:${customerId}`, {
        id: customerId,
        auth_user_id: null,
        name: name.trim(),
        phone: phone || null,
        email: email || null,
        preferred_locale: locale || "en",
        created_at: now(),
        updated_at: now(),
      });
    }

    const entry = await queueLogic.createQueueEntry({
      queueTypeId,
      locationId,
      businessId,
      customerId,
      customerName: name.trim(),
      customerPhone: phone || null,
    });

    const position = await queueLogic.calculatePosition(entry.id);
    const eta = await queueLogic.calculateETA(entry.id);

    // Send WhatsApp confirmation (async, non-blocking)
    if (phone) {
      const location = await kv.get(`location:${locationId}`);
      const business = await kv.get(`business:${businessId}`);
      whatsapp.sendJoinConfirmation({
        businessId,
        entryId: entry.id,
        customerId,
        phone,
        locale: locale || "en",
        customerName: name.trim(),
        ticketNumber: entry.ticket_number,
        queueName: entry.queue_type_name || "Queue",
        position: position.position,
        estimatedMinutes: eta.estimatedMinutes,
        businessName: business?.name,
        locationName: location?.name,
      }).catch((err: any) => console.log(`[WhatsApp join] Error: ${err.message}`));

      // Also log via legacy notification log
      await queueLogic.logNotification({
        entryId: entry.id,
        customerId,
        businessId,
        channel: "whatsapp",
        recipient: phone,
        message: `Confirmation: ${entry.ticket_number} — Position #${position.position}, ~${eta.estimatedMinutes} min`,
      });
    }

    return c.json({
      entry,
      position: position.position,
      totalWaiting: position.total,
      estimatedMinutes: eta.estimatedMinutes,
    });
  } catch (err) {
    return c.json(
      { error: `Queue join failed: ${err.message}` },
      500
    );
  }
});

// ══════════════════════════════════════════════
// QUEUE: Customer Status (public — no auth)
// ══════════════════════════════════════════════

app.get("/make-server-5252bcc1/public/queue/status/:entryId", async (c) => {
  try {
    const entryId = c.req.param("entryId");
    const entry = await kv.get(`queue_entry:${entryId}`);
    if (!entry) return c.json({ error: "Entry not found" }, 404);

    let position = { position: 0, total: 0 };
    let eta = { estimatedMinutes: 0, estimatedTime: "" };

    if (entry.status === "waiting") {
      position = await queueLogic.calculatePosition(entryId);
      eta = await queueLogic.calculateETA(entryId);
    }

    const location = await kv.get(`location:${entry.location_id}`);
    const business = await kv.get(`business:${entry.business_id}`);

    return c.json({
      entry,
      position: position.position,
      totalWaiting: position.total,
      estimatedMinutes: eta.estimatedMinutes,
      location: location
        ? { name: location.name, address: location.address }
        : null,
      businessName: business?.name || null,
    });
  } catch (err) {
    return c.json(
      { error: `Status fetch failed: ${err.message}` },
      500
    );
  }
});

// ══════════════════════════════════════════════
// QUEUE: Customer Cancel (public)
// ══════════════════════════════════════════════

app.post(
  "/make-server-5252bcc1/public/queue/cancel/:entryId",
  async (c) => {
    try {
      const entryId = c.req.param("entryId");
      const entry = await queueLogic.cancelEntry(entryId);
      return c.json({ entry });
    } catch (err) {
      return c.json(
        { error: `Cancel failed: ${err.message}` },
        500
      );
    }
  }
);

// ══════════════════════════════════════════════
// QUEUE: Staff Operations (auth required)
// ══════════════════════════════════════════════

// Get all entries for a location
app.get(
  "/make-server-5252bcc1/queue/entries/:locationId",
  async (c) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const locationId = c.req.param("locationId");
      const entries = await queueLogic.getLocationEntries(locationId);

      // Separate by status
      const waiting = entries
        .filter((e) => e.status === "waiting")
        .sort((a, b) => {
          if (b.priority !== a.priority) return b.priority - a.priority;
          return (
            new Date(a.joined_at).getTime() -
            new Date(b.joined_at).getTime()
          );
        });
      const serving = entries.filter((e) => e.status === "serving");
      const completed = entries
        .filter(
          (e) =>
            e.status === "served" ||
            e.status === "no_show" ||
            e.status === "cancelled"
        )
        .sort(
          (a, b) =>
            new Date(b.completed_at || b.cancelled_at || b.created_at).getTime() -
            new Date(a.completed_at || a.cancelled_at || a.created_at).getTime()
        )
        .slice(0, 50);

      return c.json({ waiting, serving, completed });
    } catch (err) {
      return c.json(
        { error: `Entries fetch failed: ${err.message}` },
        500
      );
    }
  }
);

// Call next
app.post("/make-server-5252bcc1/queue/call-next", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const { queueTypeId, sessionId } = await c.req.json();
    const entry = await queueLogic.callNext({
      queueTypeId,
      sessionId,
      staffAuthUid: user.id,
    });

    if (!entry) {
      return c.json({ entry: null, message: "No customers waiting" });
    }

    // Send WhatsApp "your turn" notification (async, non-blocking)
    if (entry.customer_phone) {
      const business = await kv.get(`business:${entry.business_id}`);
      whatsapp.sendYourTurnNotification({
        businessId: entry.business_id,
        entryId: entry.id,
        customerId: entry.customer_id,
        phone: entry.customer_phone,
        locale: "en",
        customerName: entry.customer_name || "Customer",
        ticketNumber: entry.ticket_number,
        queueName: entry.queue_type_name || "Queue",
        businessName: business?.name,
      }).catch((err: any) => console.log(`[WhatsApp call-next] Error: ${err.message}`));
    }

    return c.json({ entry });
  } catch (err) {
    return c.json(
      { error: `Call next failed: ${err.message}` },
      500
    );
  }
});

// Mark served
app.post(
  "/make-server-5252bcc1/queue/mark-served/:entryId",
  async (c) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const entry = await queueLogic.markServed(c.req.param("entryId"));
      return c.json({ entry });
    } catch (err) {
      return c.json(
        { error: `Mark served failed: ${err.message}` },
        500
      );
    }
  }
);

// Mark no-show
app.post(
  "/make-server-5252bcc1/queue/mark-noshow/:entryId",
  async (c) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const entry = await queueLogic.markNoShow(c.req.param("entryId"));
      return c.json({ entry });
    } catch (err) {
      return c.json(
        { error: `Mark no-show failed: ${err.message}` },
        500
      );
    }
  }
);

// Move entry
app.post("/make-server-5252bcc1/queue/move/:entryId", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const { newPosition } = await c.req.json();
    await queueLogic.moveEntry(c.req.param("entryId"), newPosition);
    return c.json({ success: true });
  } catch (err) {
    return c.json(
      { error: `Move entry failed: ${err.message}` },
      500
    );
  }
});

// Reassign staff
app.post(
  "/make-server-5252bcc1/queue/reassign/:entryId",
  async (c) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const { newStaffAuthUid } = await c.req.json();
      const entry = await queueLogic.reassignStaff(
        c.req.param("entryId"),
        newStaffAuthUid
      );
      return c.json({ entry });
    } catch (err) {
      return c.json(
        { error: `Reassign failed: ${err.message}` },
        500
      );
    }
  }
);

// Get queue types for location (staff)
app.get(
  "/make-server-5252bcc1/queue/types/:locationId",
  async (c) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const locationId = c.req.param("locationId");
      const staffRecord = await kv.get(`staff_user:${user.id}`);
      if (!staffRecord)
        return c.json({ error: "Staff record not found" }, 403);

      const queueTypes = await queueLogic.getQueueTypesForLocation(
        locationId,
        staffRecord.business_id
      );
      return c.json({ queueTypes });
    } catch (err) {
      return c.json(
        { error: `Queue types fetch failed: ${err.message}` },
        500
      );
    }
  }
);

// Get/create today's session for a queue type
app.post("/make-server-5252bcc1/queue/session", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const { queueTypeId, locationId, businessId } = await c.req.json();
    const session = await queueLogic.getOrCreateTodaySession(
      queueTypeId,
      locationId,
      businessId
    );
    return c.json({ session });
  } catch (err) {
    return c.json(
      { error: `Session fetch failed: ${err.message}` },
      500
    );
  }
});

// ══════════════════════════════════════════════
// REALTIME POLLING (lightweight polling endpoint)
// ══════════════════════════════════════════════

app.get(
  "/make-server-5252bcc1/realtime/poll/:locationId",
  async (c) => {
    try {
      const locationId = c.req.param("locationId");
      const sinceParam = c.req.query("since");
      const since = sinceParam ? parseInt(sinceParam, 10) : 0;

      const currentCounter =
        (await kv.get(`realtime_counter:${locationId}`)) || 0;

      if (currentCounter > since) {
        const latestEvent = await kv.get(
          `realtime_event:${locationId}`
        );
        return c.json({
          hasChanges: true,
          counter: currentCounter,
          event: latestEvent,
        });
      }

      return c.json({ hasChanges: false, counter: currentCounter });
    } catch (err) {
      return c.json(
        { error: `Polling failed: ${err.message}` },
        500
      );
    }
  }
);

// Get staff list for a business (for reassignment)
app.get(
  "/make-server-5252bcc1/business/:id/staff",
  async (c) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const businessId = c.req.param("id");
      const staffIds: string[] =
        (await kv.get(`business_staff:${businessId}`)) || [];
      // Also include the owner
      const ownerId = await kv.get(`business_owner:${businessId}`);
      const allIds = ownerId ? [ownerId, ...staffIds.filter((s: string) => s !== ownerId)] : staffIds;
      const staff: any[] = [];
      for (const sid of allIds) {
        const record = await kv.get(`staff_user:${sid}`);
        if (record && record.status === "active") {
          staff.push({
            auth_user_id: record.auth_user_id,
            name: record.name,
            email: record.email,
            role: record.role,
            locations: record.locations || [],
          });
        }
      }
      return c.json({ staff });
    } catch (err) {
      return c.json(
        { error: `Staff list fetch failed: ${err.message}` },
        500
      );
    }
  }
);

// Public entries for a location (used by kiosk slug route, no auth)
app.get(
  "/make-server-5252bcc1/public/queue/entries/:locationId",
  async (c) => {
    try {
      const locationId = c.req.param("locationId");
      const entries = await queueLogic.getLocationEntries(locationId);

      const waiting = entries
        .filter((e) => e.status === "waiting")
        .sort((a, b) => {
          if (b.priority !== a.priority) return b.priority - a.priority;
          return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
        });
      const serving = entries.filter((e) => e.status === "serving");

      return c.json({ waiting, serving });
    } catch (err) {
      return c.json(
        { error: `Public entries fetch failed: ${err.message}` },
        500
      );
    }
  }
);

// ══════════════════════════════════════════════
// ANALYTICS — Precomputed metrics for reports
// ══════════════════════════════════════════════

app.get("/make-server-5252bcc1/analytics/:locationId", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const locationId = c.req.param("locationId");
    const entries = await queueLogic.getLocationEntries(locationId);

    // ── Basic counters ──
    const served = entries.filter((e) => e.status === "served");
    const noShows = entries.filter((e) => e.status === "no_show");
    const cancelled = entries.filter((e) => e.status === "cancelled");
    const waiting = entries.filter((e) => e.status === "waiting");
    const serving = entries.filter((e) => e.status === "serving");
    const total = entries.length;

    // ── Avg wait time (joined → called, in minutes) ──
    let avgWaitMinutes = 0;
    const withWait = served.filter((e) => e.joined_at && e.called_at);
    if (withWait.length > 0) {
      const totalWait = withWait.reduce((acc, e) => {
        return acc + (new Date(e.called_at!).getTime() - new Date(e.joined_at).getTime()) / 60000;
      }, 0);
      avgWaitMinutes = Math.round((totalWait / withWait.length) * 10) / 10;
    }

    // ── Avg service time (called → completed, in minutes) ──
    let avgServiceMinutes = 0;
    const withService = served.filter((e) => e.called_at && e.completed_at);
    if (withService.length > 0) {
      const totalService = withService.reduce((acc, e) => {
        return acc + (new Date(e.completed_at!).getTime() - new Date(e.called_at!).getTime()) / 60000;
      }, 0);
      avgServiceMinutes = Math.round((totalService / withService.length) * 10) / 10;
    }

    // ── No-show rate ──
    const totalProcessed = served.length + noShows.length + cancelled.length;
    const noShowRate = totalProcessed > 0
      ? Math.round((noShows.length / totalProcessed) * 1000) / 10
      : 0;

    // ── Hourly distribution (heatmap data) ──
    const hourlyData: { hour: number; served: number; noShow: number; joined: number }[] = [];
    for (let h = 0; h < 24; h++) {
      hourlyData.push({ hour: h, served: 0, noShow: 0, joined: 0 });
    }
    for (const e of entries) {
      const h = new Date(e.joined_at).getHours();
      if (hourlyData[h]) {
        hourlyData[h].joined++;
        if (e.status === "served") hourlyData[h].served++;
        if (e.status === "no_show") hourlyData[h].noShow++;
      }
    }

    // ── Peak hour ──
    let peakHour = 0;
    let peakCount = 0;
    for (const h of hourlyData) {
      if (h.joined > peakCount) {
        peakCount = h.joined;
        peakHour = h.hour;
      }
    }

    // ── Staff performance ──
    const staffMap: Record<string, { name: string; served: number; totalWait: number; totalService: number; count: number }> = {};
    for (const e of served) {
      if (!e.served_by) continue;
      if (!staffMap[e.served_by]) {
        const staff = await kv.get(`staff_user:${e.served_by}`);
        staffMap[e.served_by] = {
          name: staff?.name || "Unknown",
          served: 0,
          totalWait: 0,
          totalService: 0,
          count: 0,
        };
      }
      staffMap[e.served_by].served++;
      if (e.joined_at && e.called_at) {
        staffMap[e.served_by].totalWait += (new Date(e.called_at).getTime() - new Date(e.joined_at).getTime()) / 60000;
        staffMap[e.served_by].count++;
      }
      if (e.called_at && e.completed_at) {
        staffMap[e.served_by].totalService += (new Date(e.completed_at).getTime() - new Date(e.called_at).getTime()) / 60000;
      }
    }
    const staffPerformance = Object.entries(staffMap).map(([id, s]) => ({
      id,
      name: s.name,
      served: s.served,
      avgWait: s.count > 0 ? Math.round((s.totalWait / s.count) * 10) / 10 : 0,
      avgService: s.count > 0 ? Math.round((s.totalService / s.count) * 10) / 10 : 0,
    })).sort((a, b) => b.served - a.served);

    // ── Queue type breakdown ──
    const queueTypeMap: Record<string, { name: string; prefix: string; served: number; noShow: number; cancelled: number; waiting: number }> = {};
    for (const e of entries) {
      const qtId = e.queue_type_id;
      if (!queueTypeMap[qtId]) {
        queueTypeMap[qtId] = {
          name: e.queue_type_name || "Unknown",
          prefix: e.queue_type_prefix || "?",
          served: 0,
          noShow: 0,
          cancelled: 0,
          waiting: 0,
        };
      }
      if (e.status === "served") queueTypeMap[qtId].served++;
      else if (e.status === "no_show") queueTypeMap[qtId].noShow++;
      else if (e.status === "cancelled") queueTypeMap[qtId].cancelled++;
      else if (e.status === "waiting") queueTypeMap[qtId].waiting++;
    }
    const queueBreakdown = Object.entries(queueTypeMap).map(([id, q]) => ({
      id,
      ...q,
    }));

    return c.json({
      summary: {
        servedCount: served.length,
        noShowCount: noShows.length,
        cancelledCount: cancelled.length,
        waitingCount: waiting.length,
        servingCount: serving.length,
        totalEntries: total,
        avgWaitMinutes,
        avgServiceMinutes,
        noShowRate,
        peakHour,
        peakHourFormatted: `${peakHour.toString().padStart(2, "0")}:00`,
      },
      hourlyData,
      staffPerformance,
      queueBreakdown,
    });
  } catch (err) {
    return c.json(
      { error: `Analytics fetch failed: ${err.message}` },
      500
    );
  }
});

// ══════════════════════════════════════════════
// REALTIME POLLING (continued)
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
// SETTINGS — Queue Types CRUD
// ══════════════════════════════════════════════

// Create a new queue type
app.post("/make-server-5252bcc1/settings/queue-type", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || (staffRecord.role !== "owner" && staffRecord.role !== "admin"))
      return c.json({ error: "Only owners/admins can manage queue types" }, 403);

    const body = await c.req.json();
    const queueTypeId = uuid();
    const timestamp = now();

    const queueType = {
      id: queueTypeId,
      business_id: staffRecord.business_id,
      location_id: body.locationId,
      name: body.name,
      prefix: body.prefix || body.name.charAt(0).toUpperCase(),
      description: body.description || null,
      estimated_service_time: body.estimatedServiceTime || 10,
      max_capacity: body.maxCapacity || 100,
      status: "active",
      sort_order: body.sortOrder || 0,
      created_at: timestamp,
      updated_at: timestamp,
    };

    await kv.set(`queue_type:${queueTypeId}`, queueType);

    // Add to business queue types index
    const existing = (await kv.get(`business_queue_types:${staffRecord.business_id}`)) || [];
    existing.push(queueTypeId);
    await kv.set(`business_queue_types:${staffRecord.business_id}`, existing);

    return c.json({ queueType });
  } catch (err) {
    return c.json({ error: `Create queue type failed: ${err.message}` }, 500);
  }
});

// Update a queue type
app.put("/make-server-5252bcc1/settings/queue-type/:id", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || (staffRecord.role !== "owner" && staffRecord.role !== "admin"))
      return c.json({ error: "Only owners/admins can manage queue types" }, 403);

    const id = c.req.param("id");
    const existing = await kv.get(`queue_type:${id}`);
    if (!existing) return c.json({ error: "Queue type not found" }, 404);

    const body = await c.req.json();
    const updated = {
      ...existing,
      name: body.name ?? existing.name,
      prefix: body.prefix ?? existing.prefix,
      description: body.description ?? existing.description,
      estimated_service_time: body.estimatedServiceTime ?? existing.estimated_service_time,
      max_capacity: body.maxCapacity ?? existing.max_capacity,
      status: body.status ?? existing.status,
      sort_order: body.sortOrder ?? existing.sort_order,
      updated_at: now(),
    };

    await kv.set(`queue_type:${id}`, updated);
    return c.json({ queueType: updated });
  } catch (err) {
    return c.json({ error: `Update queue type failed: ${err.message}` }, 500);
  }
});

// Delete (deactivate) a queue type
app.delete("/make-server-5252bcc1/settings/queue-type/:id", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || staffRecord.role !== "owner")
      return c.json({ error: "Only owners can delete queue types" }, 403);

    const id = c.req.param("id");
    const existing = await kv.get(`queue_type:${id}`);
    if (!existing) return c.json({ error: "Queue type not found" }, 404);

    existing.status = "inactive";
    existing.updated_at = now();
    await kv.set(`queue_type:${id}`, existing);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: `Delete queue type failed: ${err.message}` }, 500);
  }
});

// ══════════════════════════════════════════════
// SETTINGS — Staff Management
// ══════════════════════════════════════════════

// Update staff role / status
app.put("/make-server-5252bcc1/settings/staff/:authUid", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || staffRecord.role !== "owner")
      return c.json({ error: "Only owners can manage staff" }, 403);

    const targetUid = c.req.param("authUid");
    const target = await kv.get(`staff_user:${targetUid}`);
    if (!target) return c.json({ error: "Staff not found" }, 404);

    const body = await c.req.json();
    const updated = {
      ...target,
      role: body.role ?? target.role,
      status: body.status ?? target.status,
      name: body.name ?? target.name,
      locations: body.locations ?? target.locations,
      updated_at: now(),
    };

    await kv.set(`staff_user:${targetUid}`, updated);
    return c.json({ staff: updated });
  } catch (err) {
    return c.json({ error: `Update staff failed: ${err.message}` }, 500);
  }
});

// Deactivate staff
app.delete("/make-server-5252bcc1/settings/staff/:authUid", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || staffRecord.role !== "owner")
      return c.json({ error: "Only owners can deactivate staff" }, 403);

    const targetUid = c.req.param("authUid");
    if (targetUid === user.id)
      return c.json({ error: "Cannot deactivate yourself" }, 400);

    const target = await kv.get(`staff_user:${targetUid}`);
    if (!target) return c.json({ error: "Staff not found" }, 404);

    target.status = "inactive";
    target.updated_at = now();
    await kv.set(`staff_user:${targetUid}`, target);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: `Deactivate staff failed: ${err.message}` }, 500);
  }
});

// ══════════════════════════════════════════════
// SETTINGS — Business Profile
// ══════════════════════════════════════════════

app.put("/make-server-5252bcc1/settings/business/:id", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || (staffRecord.role !== "owner" && staffRecord.role !== "admin"))
      return c.json({ error: "Only owners/admins can edit business" }, 403);

    const id = c.req.param("id");
    const business = await kv.get(`business:${id}`);
    if (!business) return c.json({ error: "Business not found" }, 404);

    const body = await c.req.json();
    const updated = {
      ...business,
      name: body.name ?? business.name,
      phone: body.phone ?? business.phone,
      email: body.email ?? business.email,
      address: body.address ?? business.address,
      industry: body.industry ?? business.industry,
      updated_at: now(),
    };
    await kv.set(`business:${id}`, updated);
    return c.json({ business: updated });
  } catch (err) {
    return c.json({ error: `Update business failed: ${err.message}` }, 500);
  }
});

// ══════════════════════════════════════════════
// SETTINGS — Location Management
// ══════════════════════════════════════════════

app.put("/make-server-5252bcc1/settings/location/:id", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || (staffRecord.role !== "owner" && staffRecord.role !== "admin"))
      return c.json({ error: "Only owners/admins can edit locations" }, 403);

    const id = c.req.param("id");
    const location = await kv.get(`location:${id}`);
    if (!location) return c.json({ error: "Location not found" }, 404);

    const body = await c.req.json();
    const updated = {
      ...location,
      name: body.name ?? location.name,
      address: body.address ?? location.address,
      city: body.city ?? location.city,
      phone: body.phone ?? location.phone,
      timezone: body.timezone ?? location.timezone,
      updated_at: now(),
    };
    await kv.set(`location:${id}`, updated);
    return c.json({ location: updated });
  } catch (err) {
    return c.json({ error: `Update location failed: ${err.message}` }, 500);
  }
});

// ══════════════════════════════════════════════
// SETTINGS — WhatsApp Config
// ══════════════════════════════════════════════

app.get("/make-server-5252bcc1/settings/whatsapp/:businessId", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const businessId = c.req.param("businessId");
    const settings = await kv.get(`whatsapp_settings:${businessId}`);
    return c.json({ settings: settings || { enabled: false, phone_number: null } });
  } catch (err) {
    return c.json({ error: `WhatsApp settings fetch failed: ${err.message}` }, 500);
  }
});

app.put("/make-server-5252bcc1/settings/whatsapp/:businessId", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || (staffRecord.role !== "owner" && staffRecord.role !== "admin"))
      return c.json({ error: "Only owners/admins can update WhatsApp settings" }, 403);

    const businessId = c.req.param("businessId");
    const body = await c.req.json();
    const settings = {
      business_id: businessId,
      enabled: !!body.enabled,
      phone_number: body.phoneNumber || null,
      provider: body.provider || "twilio",
      updated_at: now(),
    };
    await kv.set(`whatsapp_settings:${businessId}`, settings);
    return c.json({ settings });
  } catch (err) {
    return c.json({ error: `WhatsApp settings update failed: ${err.message}` }, 500);
  }
});

// ══════════════════════════════════════════════
// BUSINESS HOURS
// ══════════════════════════════════════════════

// GET business hours for a location
app.get(
  "/make-server-5252bcc1/settings/business-hours/:locationId",
  async (c) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const locationId = c.req.param("locationId");
      const hours = await kv.get(`business_hours:${locationId}`);

      return c.json({ hours: hours || null });
    } catch (err) {
      return c.json(
        { error: `Failed to fetch business hours: ${err.message}` },
        500
      );
    }
  }
);

// PUT update business hours for a location
app.put(
  "/make-server-5252bcc1/settings/business-hours/:locationId",
  async (c) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const locationId = c.req.param("locationId");
      const { businessId, hours } = await c.req.json();

      // Verify the user belongs to this business
      const staffRecord = await kv.get(`staff_user:${user.id}`);
      if (!staffRecord || staffRecord.business_id !== businessId) {
        return c.json({ error: "Forbidden: not authorized for this business" }, 403);
      }

      // Only owner/admin can update hours
      if (staffRecord.role !== "owner" && staffRecord.role !== "admin") {
        return c.json({ error: "Forbidden: owner or admin role required" }, 403);
      }

      const data = {
        location_id: locationId,
        business_id: businessId,
        hours,
        updated_at: now(),
      };

      await kv.set(`business_hours:${locationId}`, data);

      return c.json({ hours: data });
    } catch (err) {
      return c.json(
        { error: `Failed to update business hours: ${err.message}` },
        500
      );
    }
  }
);

// GET business hours for public display (customer-facing)
app.get(
  "/make-server-5252bcc1/public/business-hours/:locationId",
  async (c) => {
    try {
      const locationId = c.req.param("locationId");
      const hours = await kv.get(`business_hours:${locationId}`);

      if (!hours) {
        return c.json({ hours: null, isOpen: true }); // Default: always open
      }

      // Determine if currently open
      const nowDate = new Date();
      const dayNames = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ];
      const todayKey = dayNames[nowDate.getDay()];
      const todaySchedule = hours.hours?.[todayKey];

      let isOpen = true;
      if (todaySchedule) {
        if (!todaySchedule.open) {
          isOpen = false;
        } else {
          const currentMinutes =
            nowDate.getHours() * 60 + nowDate.getMinutes();
          const [openH, openM] = (todaySchedule.openTime || "09:00")
            .split(":")
            .map(Number);
          const [closeH, closeM] = (todaySchedule.closeTime || "18:00")
            .split(":")
            .map(Number);
          const openMinutes = openH * 60 + openM;
          const closeMinutes = closeH * 60 + closeM;
          isOpen =
            currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
        }
      }

      return c.json({ hours: hours.hours, isOpen, today: todayKey });
    } catch (err) {
      return c.json(
        { error: `Failed to fetch public business hours: ${err.message}` },
        500
      );
    }
  }
);

// ══════════════════════════════════════════════
// SETTINGS — Invite new staff member
// ══════════════════════════════════════════════

app.post("/make-server-5252bcc1/settings/staff/invite", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || staffRecord.role !== "owner")
      return c.json({ error: "Only owners can invite staff" }, 403);

    const body = await c.req.json();
    const { email, name, role, locationIds, password } = body;
    if (!email || !name) return c.json({ error: "Email and name are required" }, 400);

    const supabase = supabaseAdmin();
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: password || "EMFlow2026!",
      user_metadata: { name },
      email_confirm: true,
    });

    if (authError) return c.json({ error: `Auth error: ${authError.message}` }, 400);

    const timestamp = now();
    const newStaff = {
      id: uuid(),
      auth_user_id: authData.user.id,
      business_id: staffRecord.business_id,
      email,
      name,
      role: role || "staff",
      status: "active",
      locations: locationIds || staffRecord.locations || [],
      created_at: timestamp,
      updated_at: timestamp,
    };

    await kv.set(`staff_user:${authData.user.id}`, newStaff);

    const existing = (await kv.get(`business_staff:${staffRecord.business_id}`)) || [];
    existing.push(authData.user.id);
    await kv.set(`business_staff:${staffRecord.business_id}`, existing);

    return c.json({ staff: newStaff });
  } catch (err) {
    return c.json({ error: `Staff invite failed: ${err.message}` }, 500);
  }
});

// ══════════════════════════════════════════════
Deno.serve(app.fetch);
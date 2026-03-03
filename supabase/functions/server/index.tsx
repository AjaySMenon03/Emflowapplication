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
    allowHeaders: ["Content-Type", "Authorization", "apikey"],
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

  // Early rejection: decode JWT payload to filter out anon/service-role keys
  // (these are not user JWTs and will fail getUser() with "Invalid JWT")
  try {
    const payloadB64 = token.split(".")[1];
    if (payloadB64) {
      const payload = JSON.parse(atob(payloadB64));
      // Supabase anon key has role "anon", service role key has role "service_role"
      // Real user JWTs have role "authenticated"
      if (payload.role === "anon" || payload.role === "service_role") {
        console.log(`[getAuthUser] Rejected non-user JWT with role: ${payload.role}`);
        return null;
      }
    }
  } catch {
    // If we can't decode, let getUser() handle the validation
  }

  try {
    const supabase = supabaseAdmin();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.id) {
      console.log(`[getAuthUser] getUser failed: ${error?.message || "no user"}`);
      return null;
    }
    return data.user;
  } catch (err: any) {
    console.log(`[getAuthUser] getUser threw: ${err?.message || err}`);
    return null;
  }
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

    // ── Emergency pause check ──
    const emergencyState = await kv.get(`emergency:${locationId}`);
    if (emergencyState?.paused) {
      return c.json(
        {
          error: "We're temporarily not accepting new walk-ins. Please check back shortly.",
          code: "QUEUE_PAUSED",
        },
        403
      );
    }

    // ── Smart Session: check business hours & session status ──
    const { session: smartSession, businessHours } =
      await queueLogic.getOrCreateTodaySessionSmart(
        queueTypeId,
        locationId,
        businessId
      );

    if (!businessHours.isOpen) {
      return c.json(
        {
          error: `Queue is currently closed. ${businessHours.reason || ""}`.trim(),
          code: "OUTSIDE_BUSINESS_HOURS",
          businessHours,
        },
        403
      );
    }

    // ── Duplicate prevention ──
    if (phone) {
      const duplicate = await queueLogic.checkDuplicateEntry({
        locationId,
        customerPhone: phone,
        customerId: null,
      });
      if (duplicate) {
        return c.json(
          {
            error: `You already have an active entry (${duplicate.ticket_number}) in this queue.`,
            code: "DUPLICATE_ENTRY",
            existingEntry: duplicate,
          },
          409
        );
      }
    }

    if (smartSession.status === "closed" || smartSession.status === "archived") {
      return c.json(
        {
          error: "Queue session is closed. No new entries can be added.",
          code: "SESSION_CLOSED",
          sessionStatus: smartSession.status,
        },
        403
      );
    }

    // Check if user is authenticated (for retention tracking)
    const authUser = await getAuthUser(c);
    const authUserId: string | null = authUser?.id || null;

    // Create or find customer
    let customerId: string | null = null;
    if (authUserId) {
      let existingCustomer = await kv.get(`customer:${authUserId}`);
      if (!existingCustomer) {
        existingCustomer = {
          id: authUserId,
          auth_user_id: authUserId,
          name: name.trim(),
          phone: phone || authUser?.phone || null,
          email: email || authUser?.email || null,
          preferred_language: locale || "en",
          created_at: now(),
          updated_at: now(),
        };
        await kv.set(`customer:${authUserId}`, existingCustomer);
      }
      customerId = authUserId;
    } else if (phone || email) {
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

    // Track entry in customer_entries index for retention analytics
    if (authUserId) {
      const existingEntries: string[] = (await kv.get(`customer_entries:${authUserId}`)) || [];
      existingEntries.push(entry.id);
      await kv.set(`customer_entries:${authUserId}`, existingEntries);
    }

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
      businessHours,
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
    } else if (entry.status === "next") {
      position = { position: 0, total: 0 };
      eta = { estimatedMinutes: 0, estimatedTime: new Date().toISOString() };
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
      const result = await queueLogic.cancelEntryEnhanced(entryId);
      return c.json({ entry: result.cancelled, promoted: result.promoted });
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
          if ((a.position || 0) !== (b.position || 0))
            return (a.position || 0) - (b.position || 0);
          return (
            new Date(a.joined_at).getTime() -
            new Date(b.joined_at).getTime()
          );
        });
      const next = entries.filter((e) => e.status === "next");
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

      return c.json({ waiting, next, serving, completed });
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

// Start serving (transition NEXT → SERVING)
app.post(
  "/make-server-5252bcc1/queue/start-serving/:entryId",
  async (c) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const entry = await queueLogic.startServing(
        c.req.param("entryId"),
        user.id
      );
      return c.json({ entry });
    } catch (err) {
      return c.json(
        { error: `Start serving failed: ${err.message}` },
        500
      );
    }
  }
);

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
          if ((a.position || 0) !== (b.position || 0))
            return (a.position || 0) - (b.position || 0);
          return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
        });
      const next = entries.filter((e) => e.status === "next");
      const serving = entries.filter((e) => e.status === "serving");

      return c.json({ waiting, next, serving });
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

// Update staff role / status — owners can edit anyone, admins can edit staff-role only
app.put("/make-server-5252bcc1/settings/staff/:authUid", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || !["owner", "admin"].includes(staffRecord.role))
      return c.json({ error: "Only owners and admins can manage staff" }, 403);

    const targetUid = c.req.param("authUid");
    const target = await kv.get(`staff_user:${targetUid}`);
    if (!target) return c.json({ error: "Staff not found" }, 404);

    // Admins can only edit staff-role members (not owners or other admins)
    if (staffRecord.role === "admin" && target.role !== "staff") {
      return c.json({ error: "Admins can only edit staff-role members" }, 403);
    }

    const body = await c.req.json();

    // Only owners can change roles
    const newRole = (staffRecord.role === "owner" && body.role) ? body.role : target.role;

    const updated = {
      ...target,
      role: newRole,
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

// Reset staff password — owners & admins (admins only for staff-role)
app.post("/make-server-5252bcc1/settings/staff/:authUid/reset-password", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || !["owner", "admin"].includes(staffRecord.role))
      return c.json({ error: "Only owners and admins can reset passwords" }, 403);

    const targetUid = c.req.param("authUid");
    const target = await kv.get(`staff_user:${targetUid}`);
    if (!target) return c.json({ error: "Staff not found" }, 404);

    // Admins can only reset passwords for staff-role members
    if (staffRecord.role === "admin" && target.role !== "staff") {
      return c.json({ error: "Admins can only reset passwords for staff-role members" }, 403);
    }

    // Cannot reset own password via this endpoint
    if (targetUid === user.id) {
      return c.json({ error: "Cannot reset your own password via admin panel" }, 400);
    }

    const body = await c.req.json();
    const newPassword = body.password;
    if (!newPassword || newPassword.length < 6) {
      return c.json({ error: "Password must be at least 6 characters" }, 400);
    }

    const supabase = supabaseAdmin();
    const { error: updateError } = await supabase.auth.admin.updateUserById(targetUid, {
      password: newPassword,
    });

    if (updateError) {
      return c.json({ error: `Password reset failed: ${updateError.message}` }, 500);
    }

    return c.json({ success: true, message: `Password reset for ${target.name}` });
  } catch (err) {
    return c.json({ error: `Password reset failed: ${err.message}` }, 500);
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
      kiosk_pin: body.kiosk_pin !== undefined ? body.kiosk_pin : (location.kiosk_pin || null),
      updated_at: now(),
    };
    await kv.set(`location:${id}`, updated);
    return c.json({ location: updated });
  } catch (err) {
    return c.json({ error: `Update location failed: ${err.message}` }, 500);
  }
});

// ══════════════════════════════════════════════
// KIOSK — PIN Verification & Staff Auth
// ══════════════════════════════════════════════

// Verify kiosk PIN for a location (public — no auth, but rate-limited by PIN check)
app.post("/make-server-5252bcc1/kiosk/verify-pin", async (c) => {
  try {
    const { locationId, pin } = await c.req.json();
    if (!locationId || !pin) {
      return c.json({ error: "locationId and pin are required" }, 400);
    }
    const location = await kv.get(`location:${locationId}`);
    if (!location) return c.json({ error: "Location not found" }, 404);

    if (!location.kiosk_pin) {
      return c.json({ error: "No kiosk PIN configured for this location", code: "NO_PIN_SET" }, 400);
    }

    if (location.kiosk_pin !== pin) {
      console.log(`[kiosk/verify-pin] Invalid PIN attempt for location ${locationId}`);
      return c.json({ error: "Invalid PIN", valid: false }, 403);
    }

    return c.json({ valid: true });
  } catch (err) {
    return c.json({ error: `PIN verification failed: ${err.message}` }, 500);
  }
});

// Kiosk staff authenticate — validates credentials + role, returns token
app.post("/make-server-5252bcc1/kiosk/authenticate", async (c) => {
  try {
    const { email, password, locationId } = await c.req.json();
    if (!email || !password || !locationId) {
      return c.json({ error: "email, password, and locationId are required" }, 400);
    }

    const supabase = supabaseAdmin();
    // Sign in using the admin client to get the session
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !signInData?.user) {
      return c.json({ error: `Authentication failed: ${signInError?.message || "Invalid credentials"}` }, 401);
    }

    // Verify staff role
    const staffRecord = await kv.get(`staff_user:${signInData.user.id}`);
    if (!staffRecord) {
      return c.json({ error: "Not authorized: no staff record found" }, 403);
    }

    // Verify role is staff, admin, or owner
    const allowedRoles = ["owner", "admin", "staff"];
    if (!allowedRoles.includes(staffRecord.role)) {
      return c.json({ error: `Role '${staffRecord.role}' is not authorized for kiosk operations` }, 403);
    }

    // Verify staff has access to this location
    const location = await kv.get(`location:${locationId}`);
    if (!location) {
      return c.json({ error: "Location not found" }, 404);
    }
    if (location.business_id !== staffRecord.business_id) {
      return c.json({ error: "Staff not authorized for this location's business" }, 403);
    }

    return c.json({
      accessToken: signInData.session?.access_token,
      staff: {
        name: staffRecord.name,
        role: staffRecord.role,
        email: staffRecord.email,
      },
    });
  } catch (err) {
    return c.json({ error: `Kiosk authentication failed: ${err.message}` }, 500);
  }
});

// Kiosk call-next — role-validated server-side
app.post("/make-server-5252bcc1/kiosk/call-next", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized — staff login required for kiosk operations" }, 401);

    // Verify staff role server-side
    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord) {
      return c.json({ error: "No staff record found — kiosk operations require staff authorization" }, 403);
    }

    const allowedRoles = ["owner", "admin", "staff"];
    if (!allowedRoles.includes(staffRecord.role)) {
      return c.json({ error: `Role '${staffRecord.role}' is not authorized for kiosk call-next` }, 403);
    }

    const { locationId } = await c.req.json();
    if (!locationId) {
      return c.json({ error: "locationId is required" }, 400);
    }

    // Verify staff belongs to same business as location
    const location = await kv.get(`location:${locationId}`);
    if (!location || location.business_id !== staffRecord.business_id) {
      return c.json({ error: "Staff not authorized for this location" }, 403);
    }

    // Get all queue types for the location and find the first waiting entry
    const entries = await queueLogic.getLocationEntries(locationId);
    const waitingEntries = entries
      .filter((e) => e.status === "waiting")
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        if ((a.position || 0) !== (b.position || 0)) return (a.position || 0) - (b.position || 0);
        return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
      });

    if (waitingEntries.length === 0) {
      return c.json({ entry: null, message: "No customers waiting" });
    }

    // Call the first waiting entry
    const nextEntry = waitingEntries[0];
    const entry = await queueLogic.callNext({
      queueTypeId: nextEntry.queue_type_id,
      sessionId: nextEntry.session_id,
      staffAuthUid: user.id,
    });

    if (!entry) {
      return c.json({ entry: null, message: "No customers waiting" });
    }

    // Send WhatsApp notification (async, non-blocking)
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
      }).catch((err: any) => console.log(`[WhatsApp kiosk-call-next] Error: ${err.message}`));
    }

    return c.json({ entry });
  } catch (err) {
    return c.json({ error: `Kiosk call-next failed: ${err.message}` }, 500);
  }
});

// Kiosk mark-served — role-validated server-side
app.post("/make-server-5252bcc1/kiosk/mark-served/:entryId", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || !["owner", "admin", "staff"].includes(staffRecord.role)) {
      return c.json({ error: "Not authorized for kiosk operations" }, 403);
    }

    const entryId = c.req.param("entryId");
    const entry = await queueLogic.markServed(entryId);
    return c.json({ entry });
  } catch (err) {
    return c.json({ error: `Kiosk mark-served failed: ${err.message}` }, 500);
  }
});

// Kiosk mark-noshow — role-validated server-side
app.post("/make-server-5252bcc1/kiosk/mark-noshow/:entryId", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || !["owner", "admin", "staff"].includes(staffRecord.role)) {
      return c.json({ error: "Not authorized for kiosk operations" }, 403);
    }

    const entryId = c.req.param("entryId");
    const entry = await queueLogic.markNoShow(entryId);
    return c.json({ entry });
  } catch (err) {
    return c.json({ error: `Kiosk mark-noshow failed: ${err.message}` }, 500);
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
// Now uses timezone-aware checkBusinessHours from queue-logic
app.get(
  "/make-server-5252bcc1/public/business-hours/:locationId",
  async (c) => {
    try {
      const locationId = c.req.param("locationId");
      const hours = await kv.get(`business_hours:${locationId}`);
      const businessHours = await queueLogic.checkBusinessHours(locationId);

      if (!hours) {
        return c.json({ hours: null, isOpen: true, businessHours });
      }

      return c.json({
        hours: hours.hours,
        isOpen: businessHours.isOpen,
        businessHours,
      });
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
// EDGE-CASE: Duplicate check, enhanced cancel, auto-noshow, mark-previous
// ══════════════════════════════════════════════

// Enhanced cancel (supports NEXT cancel with auto-promote, prevents after SERVED)
app.post(
  "/make-server-5252bcc1/queue/cancel-enhanced/:entryId",
  async (c) => {
    try {
      const entryId = c.req.param("entryId");
      // Support both public (no auth) and staff (auth) cancel
      let staffAuthUid: string | undefined;
      const user = await getAuthUser(c);
      if (user) staffAuthUid = user.id;

      const result = await queueLogic.cancelEntryEnhanced(entryId, staffAuthUid);
      return c.json(result);
    } catch (err) {
      return c.json(
        { error: `Cancel failed: ${err.message}` },
        err.message.includes("Cannot cancel") || err.message.includes("already") ? 400 : 500
      );
    }
  }
);

// Auto no-show processing for a location
app.post(
  "/make-server-5252bcc1/queue/auto-noshow/:locationId",
  async (c) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const locationId = c.req.param("locationId");
      const body = await c.req.json().catch(() => ({}));
      const timeoutMinutes = body.timeoutMinutes || 10;

      const result = await queueLogic.processAutoNoShows(locationId, timeoutMinutes);
      return c.json(result);
    } catch (err) {
      return c.json({ error: `Auto no-show failed: ${err.message}` }, 500);
    }
  }
);

// Mark previous as served
app.post("/make-server-5252bcc1/queue/mark-previous-served", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const { queueTypeId, sessionId } = await c.req.json();
    const entry = await queueLogic.markPreviousAsServed({
      queueTypeId,
      sessionId,
      staffAuthUid: user.id,
    });

    if (!entry) {
      return c.json({ entry: null, message: "No previous entry to mark" });
    }
    return c.json({ entry });
  } catch (err) {
    return c.json({ error: `Mark previous served failed: ${err.message}` }, 500);
  }
});

// Check duplicate entry before join
app.post("/make-server-5252bcc1/public/queue/check-duplicate", async (c) => {
  try {
    const { locationId, phone, customerId } = await c.req.json();
    const existing = await queueLogic.checkDuplicateEntry({
      locationId,
      customerPhone: phone || null,
      customerId: customerId || null,
    });
    return c.json({ exists: !!existing, entry: existing });
  } catch (err) {
    return c.json({ error: `Duplicate check failed: ${err.message}` }, 500);
  }
});

// ══════════════════════════════════════════════
// AUDIT LOG
// ══════════════════════════════════════════════

app.get("/make-server-5252bcc1/audit/:locationId", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || staffRecord.role !== "owner") {
      return c.json({ error: "Only owners can view audit logs" }, 403);
    }

    const locationId = c.req.param("locationId");
    const startDate = c.req.query("startDate") || undefined;
    const endDate = c.req.query("endDate") || undefined;
    const eventType = c.req.query("eventType") || undefined;
    const staffId = c.req.query("staffId") || undefined;
    const limit = parseInt(c.req.query("limit") || "50", 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    const result = await queueLogic.readAuditLog({
      locationId,
      startDate,
      endDate,
      eventType: eventType as any,
      staffId,
      limit,
      offset,
    });

    return c.json(result);
  } catch (err) {
    return c.json({ error: `Audit log fetch failed: ${err.message}` }, 500);
  }
});

// ══════════════════════════════════════════════
// SESSION LIFECYCLE — Smart Queue Session Management
// ══════════════════════════════════════════════

// Get active sessions for a location (public, no auth)
app.get("/make-server-5252bcc1/public/session/active/:locationId", async (c) => {
  try {
    const locationId = c.req.param("locationId");
    const result = await queueLogic.getActiveSession(locationId);
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: `Active session fetch failed: ${err.message}` },
      500
    );
  }
});

// Check business hours for a location (public, no auth)
app.get("/make-server-5252bcc1/public/session/hours/:locationId", async (c) => {
  try {
    const locationId = c.req.param("locationId");
    const businessHours = await queueLogic.checkBusinessHours(locationId);
    return c.json({ businessHours });
  } catch (err) {
    return c.json(
      { error: `Business hours check failed: ${err.message}` },
      500
    );
  }
});

// Get/create today's smart session (staff, auth required)
app.post("/make-server-5252bcc1/queue/session-smart", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const { queueTypeId, locationId, businessId, skipBusinessHoursCheck } =
      await c.req.json();
    const result = await queueLogic.getOrCreateTodaySessionSmart(
      queueTypeId,
      locationId,
      businessId,
      { skipBusinessHoursCheck: !!skipBusinessHoursCheck }
    );
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: `Smart session fetch failed: ${err.message}` },
      500
    );
  }
});

// Close a specific session (staff, auth required)
app.post("/make-server-5252bcc1/queue/session/close/:sessionId", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || (staffRecord.role !== "owner" && staffRecord.role !== "admin")) {
      return c.json({ error: "Only owners/admins can close sessions" }, 403);
    }

    const sessionId = c.req.param("sessionId");
    const body = await c.req.json().catch(() => ({}));
    const result = await queueLogic.closeSession(sessionId, body.reason || "Manually closed by staff");
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: `Session close failed: ${err.message}` },
      500
    );
  }
});

// Close all sessions for a location (staff, auth required)
app.post("/make-server-5252bcc1/queue/session/close-all/:locationId", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || (staffRecord.role !== "owner" && staffRecord.role !== "admin")) {
      return c.json({ error: "Only owners/admins can close all sessions" }, 403);
    }

    const locationId = c.req.param("locationId");
    const body = await c.req.json().catch(() => ({}));
    const result = await queueLogic.closeAllSessionsForLocation(
      locationId,
      body.reason || "Manually closed all sessions"
    );
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: `Close all sessions failed: ${err.message}` },
      500
    );
  }
});

// Archive old sessions (staff, auth required)
app.post("/make-server-5252bcc1/queue/session/archive/:locationId", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || staffRecord.role !== "owner") {
      return c.json({ error: "Only owners can archive sessions" }, 403);
    }

    const locationId = c.req.param("locationId");
    const body = await c.req.json().catch(() => ({}));
    const daysOld = body.daysOld || 30;
    const result = await queueLogic.archiveOldSessions(locationId, daysOld);
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: `Archive sessions failed: ${err.message}` },
      500
    );
  }
});

// Auto-close expired sessions for a business (cron endpoint)
// In production, called by Supabase pg_cron or Edge Function schedule.
app.post("/make-server-5252bcc1/cron/auto-close-sessions", async (c) => {
  try {
    const authHeader = c.req.header("Authorization")?.split(" ")[1];
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    let isAuthorized = false;
    if (authHeader === serviceRoleKey) {
      isAuthorized = true;
    } else {
      const user = await getAuthUser(c);
      if (user) {
        const staffRecord = await kv.get(`staff_user:${user.id}`);
        if (staffRecord && (staffRecord.role === "owner" || staffRecord.role === "admin")) {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      return c.json({ error: "Unauthorized for cron operation" }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const { businessId } = body;

    if (!businessId) {
      return c.json({ error: "businessId is required" }, 400);
    }

    const result = await queueLogic.autoCloseExpiredSessions(businessId);
    console.log(
      `[cron/auto-close] Business ${businessId}: processed ${result.locationsProcessed} locations, ` +
      `closed ${result.totalClosed} sessions, cancelled ${result.totalCancelled} entries`
    );
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: `Auto-close cron failed: ${err.message}` },
      500
    );
  }
});

// Midnight rotation for a location (cron endpoint)
app.post("/make-server-5252bcc1/cron/midnight-rotation/:locationId", async (c) => {
  try {
    const authHeader = c.req.header("Authorization")?.split(" ")[1];
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    let isAuthorized = false;
    if (authHeader === serviceRoleKey) {
      isAuthorized = true;
    } else {
      const user = await getAuthUser(c);
      if (user) {
        const staffRecord = await kv.get(`staff_user:${user.id}`);
        if (staffRecord && (staffRecord.role === "owner" || staffRecord.role === "admin")) {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      return c.json({ error: "Unauthorized for midnight rotation" }, 401);
    }

    const locationId = c.req.param("locationId");
    const result = await queueLogic.midnightRotation(locationId);
    console.log(
      `[cron/midnight] Location ${locationId}: closed ${result.closedPrevious} sessions, ` +
      `cancelled ${result.cancelledEntries} entries`
    );
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: `Midnight rotation failed: ${err.message}` },
      500
    );
  }
});

// ══════════════════════════════════════════════
// ADVANCED ANALYTICS — Owner/Admin analytics dashboard
// ══════════════════════════════════════════════

app.get("/make-server-5252bcc1/analytics/advanced/:locationId", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord) return c.json({ error: "Staff record not found" }, 403);
    if (staffRecord.role !== "owner" && staffRecord.role !== "admin") {
      return c.json({ error: "Only owners and admins can access advanced analytics" }, 403);
    }

    const locationId = c.req.param("locationId");
    const range = c.req.query("range") || "today";
    const customFrom = c.req.query("from");
    const customTo = c.req.query("to");

    const nowMs = Date.now();
    let fromMs: number;
    let toMs: number = nowMs;
    let prevFromMs: number;
    let prevToMs: number;

    if (range === "7d") {
      fromMs = nowMs - 7 * 86400000;
      prevFromMs = fromMs - 7 * 86400000;
      prevToMs = fromMs;
    } else if (range === "30d") {
      fromMs = nowMs - 30 * 86400000;
      prevFromMs = fromMs - 30 * 86400000;
      prevToMs = fromMs;
    } else if (range === "custom" && customFrom && customTo) {
      fromMs = new Date(customFrom).getTime();
      toMs = new Date(customTo).getTime() + 86400000;
      const span = toMs - fromMs;
      prevFromMs = fromMs - span;
      prevToMs = fromMs;
    } else {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      fromMs = todayStart.getTime();
      prevFromMs = fromMs - 86400000;
      prevToMs = fromMs;
    }

    const allEntries = await queueLogic.getLocationEntries(locationId);

    const entries = allEntries.filter((e: any) => {
      const t = new Date(e.joined_at).getTime();
      return t >= fromMs && t <= toMs;
    });

    const prevEntries = allEntries.filter((e: any) => {
      const t = new Date(e.joined_at).getTime();
      return t >= prevFromMs && t < prevToMs;
    });

    function computeMetrics(entrySet: any[]) {
      const served = entrySet.filter((e: any) => e.status === "served");
      const noShows = entrySet.filter((e: any) => e.status === "no_show");
      const cancelled = entrySet.filter((e: any) => e.status === "cancelled");
      const waiting = entrySet.filter((e: any) => e.status === "waiting");
      const serving = entrySet.filter((e: any) => e.status === "serving");

      let avgWaitMinutes = 0;
      const withWait = served.filter((e: any) => e.joined_at && e.called_at);
      if (withWait.length > 0) {
        const totalWait = withWait.reduce((acc: number, e: any) =>
          acc + (new Date(e.called_at).getTime() - new Date(e.joined_at).getTime()) / 60000, 0);
        avgWaitMinutes = Math.round((totalWait / withWait.length) * 10) / 10;
      }

      let avgServiceMinutes = 0;
      const withService = served.filter((e: any) => e.called_at && e.completed_at);
      if (withService.length > 0) {
        const totalService = withService.reduce((acc: number, e: any) =>
          acc + (new Date(e.completed_at).getTime() - new Date(e.called_at).getTime()) / 60000, 0);
        avgServiceMinutes = Math.round((totalService / withService.length) * 10) / 10;
      }

      const totalProcessed = served.length + noShows.length + cancelled.length;
      const noShowRate = totalProcessed > 0
        ? Math.round((noShows.length / totalProcessed) * 1000) / 10
        : 0;

      const hourCounts: number[] = new Array(24).fill(0);
      for (const e of entrySet) {
        const h = new Date(e.joined_at).getHours();
        hourCounts[h]++;
      }
      let peakHour = 0;
      let peakCount = 0;
      for (let h = 0; h < 24; h++) {
        if (hourCounts[h] > peakCount) {
          peakCount = hourCounts[h];
          peakHour = h;
        }
      }

      return {
        servedCount: served.length,
        noShowCount: noShows.length,
        cancelledCount: cancelled.length,
        waitingCount: waiting.length,
        servingCount: serving.length,
        totalEntries: entrySet.length,
        avgWaitMinutes,
        avgServiceMinutes,
        noShowRate,
        peakHour,
        peakHourFormatted: `${peakHour.toString().padStart(2, "0")}:00`,
      };
    }

    const currentMetrics = computeMetrics(entries);
    const prevMetrics = computeMetrics(prevEntries);

    function pctChange(curr: number, prev: number): number {
      if (prev === 0 && curr === 0) return 0;
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Math.round(((curr - prev) / prev) * 1000) / 10;
    }

    const kpiChanges = {
      servedChange: pctChange(currentMetrics.servedCount, prevMetrics.servedCount),
      avgWaitChange: pctChange(currentMetrics.avgWaitMinutes, prevMetrics.avgWaitMinutes),
      avgServiceChange: pctChange(currentMetrics.avgServiceMinutes, prevMetrics.avgServiceMinutes),
      noShowRateChange: pctChange(currentMetrics.noShowRate, prevMetrics.noShowRate),
    };

    // Queue Health Score (0-100)
    const targetWait = 10;
    const waitFactor = currentMetrics.avgWaitMinutes <= targetWait
      ? 1 : Math.max(0, 1 - (currentMetrics.avgWaitMinutes - targetWait) / 30);
    const noShowFactor = Math.max(0, 1 - currentMetrics.noShowRate / 50);
    const avgDailyLoad = prevMetrics.totalEntries > 0 ? prevMetrics.totalEntries : currentMetrics.totalEntries || 1;
    const loadRatio = currentMetrics.totalEntries / Math.max(avgDailyLoad, 1);
    const loadFactor = loadRatio <= 1.2 ? 1 : Math.max(0, 1 - (loadRatio - 1.2) / 2);
    const healthScore = Math.round((waitFactor * 0.4 + noShowFactor * 0.3 + loadFactor * 0.3) * 100);
    const healthLabel = healthScore >= 80 ? "smooth" : healthScore >= 50 ? "busy" : "overloaded";

    // Staff Performance with Efficiency Score
    const staffMap: Record<string, { name: string; served: number; totalWait: number; totalService: number; count: number }> = {};
    const servedEntries = entries.filter((e: any) => e.status === "served");
    for (const e of servedEntries) {
      if (!e.served_by) continue;
      if (!staffMap[e.served_by]) {
        const staff = await kv.get(`staff_user:${e.served_by}`);
        staffMap[e.served_by] = { name: staff?.name || "Unknown", served: 0, totalWait: 0, totalService: 0, count: 0 };
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

    const staffPerformance = Object.entries(staffMap).map(([id, s]) => {
      const avgService = s.count > 0 ? Math.round((s.totalService / s.count) * 10) / 10 : 0;
      const avgWait = s.count > 0 ? Math.round((s.totalWait / s.count) * 10) / 10 : 0;
      const efficiency = avgService > 0 ? Math.round((s.served / avgService) * 100) / 10 : 0;
      return { id, name: s.name, served: s.served, avgWait, avgService, efficiency };
    }).sort((a, b) => b.efficiency - a.efficiency);

    const maxEff = Math.max(...staffPerformance.map((s) => s.efficiency), 1);
    for (const s of staffPerformance) {
      (s as any).efficiencyScore = Math.round((s.efficiency / maxEff) * 100);
    }

    // Hourly Heatmap (Day of Week x Hour)
    const heatmapData: { day: number; hour: number; count: number }[] = [];
    const heatmapGrid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const e of entries) {
      const d = new Date(e.joined_at);
      const dow = d.getDay();
      const h = d.getHours();
      heatmapGrid[dow][h]++;
    }
    for (let day = 0; day < 7; day++) {
      for (let hour = 6; hour <= 22; hour++) {
        heatmapData.push({ day, hour, count: heatmapGrid[day][hour] });
      }
    }

    // Service Type Analysis
    const svcMap: Record<string, any> = {};
    for (const e of entries) {
      const qtId = e.queue_type_id || "general";
      if (!svcMap[qtId]) {
        svcMap[qtId] = {
          name: e.queue_type_name || "General", prefix: e.queue_type_prefix || "?",
          count: 0, servedCount: 0, noShowCount: 0, cancelledCount: 0,
          totalWait: 0, waitCount: 0, totalService: 0, serviceCount: 0,
        };
      }
      svcMap[qtId].count++;
      if (e.status === "served") svcMap[qtId].servedCount++;
      if (e.status === "no_show") svcMap[qtId].noShowCount++;
      if (e.status === "cancelled") svcMap[qtId].cancelledCount++;
      if (e.joined_at && e.called_at && e.status === "served") {
        svcMap[qtId].totalWait += (new Date(e.called_at).getTime() - new Date(e.joined_at).getTime()) / 60000;
        svcMap[qtId].waitCount++;
      }
      if (e.called_at && e.completed_at && e.status === "served") {
        svcMap[qtId].totalService += (new Date(e.completed_at).getTime() - new Date(e.called_at).getTime()) / 60000;
        svcMap[qtId].serviceCount++;
      }
    }
    const serviceAnalysis = Object.entries(svcMap).map(([id, s]: [string, any]) => ({
      id, name: s.name, prefix: s.prefix, totalEntries: s.count,
      servedCount: s.servedCount, noShowCount: s.noShowCount, cancelledCount: s.cancelledCount,
      avgWait: s.waitCount > 0 ? Math.round((s.totalWait / s.waitCount) * 10) / 10 : 0,
      avgService: s.serviceCount > 0 ? Math.round((s.totalService / s.serviceCount) * 10) / 10 : 0,
    })).sort((a, b) => b.totalEntries - a.totalEntries);

    // Daily Trend (last 30 days)
    const dailyMap: Record<string, any> = {};
    const thirtyDaysAgo = nowMs - 30 * 86400000;
    const trendEntries = allEntries.filter((e: any) => new Date(e.joined_at).getTime() >= thirtyDaysAgo);
    for (const e of trendEntries) {
      const date = e.joined_at.slice(0, 10);
      if (!dailyMap[date]) {
        dailyMap[date] = { date, served: 0, joined: 0, waitSum: 0, waitCount: 0 };
      }
      dailyMap[date].joined++;
      if (e.status === "served") {
        dailyMap[date].served++;
        if (e.joined_at && e.called_at) {
          dailyMap[date].waitSum += (new Date(e.called_at).getTime() - new Date(e.joined_at).getTime()) / 60000;
          dailyMap[date].waitCount++;
        }
      }
    }
    const dailyTrend = Object.values(dailyMap)
      .map((d: any) => ({
        date: d.date, served: d.served, joined: d.joined,
        avgWait: d.waitCount > 0 ? Math.round((d.waitSum / d.waitCount) * 10) / 10 : 0,
      }))
      .sort((a: any, b: any) => a.date.localeCompare(b.date));

    // 7-Day Simple Moving Average
    const sma7: { date: string; sma: number }[] = [];
    for (let i = 0; i < dailyTrend.length; i++) {
      const window = dailyTrend.slice(Math.max(0, i - 6), i + 1);
      const avg = Math.round((window.reduce((acc: number, d: any) => acc + d.served, 0) / window.length) * 10) / 10;
      sma7.push({ date: dailyTrend[i].date, sma: avg });
    }

    let trendDirection: "up" | "stable" | "down" = "stable";
    if (sma7.length >= 7) {
      const recent = sma7.slice(-3).reduce((a, d) => a + d.sma, 0) / 3;
      const older = sma7.slice(-7, -4).reduce((a, d) => a + d.sma, 0) / Math.max(sma7.slice(-7, -4).length, 1);
      if (recent > older * 1.1) trendDirection = "up";
      else if (recent < older * 0.9) trendDirection = "down";
    }

    return c.json({
      summary: currentMetrics,
      kpiChanges,
      healthScore,
      healthLabel,
      staffPerformance,
      heatmapData,
      serviceAnalysis,
      dailyTrend: dailyTrend.map((d: any, i: number) => ({
        ...d, sma7: sma7[i]?.sma ?? null,
      })),
      trendDirection,
      range,
      periodLabel: range === "today" ? "vs yesterday" : range === "7d" ? "vs prev 7 days" : range === "30d" ? "vs prev 30 days" : "vs prev period",
    });
  } catch (err) {
    return c.json({ error: `Advanced analytics failed: ${err.message}` }, 500);
  }
});

// ══════════════════════════════════════════════
// CUSTOMER RETENTION SYSTEM
// ══════════════════════════════════════════════

// Register / ensure customer record linked to auth user
app.post("/make-server-5252bcc1/customer/register", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const { name, phone, preferredLanguage } = body;

    let customer = await kv.get(`customer:${user.id}`);
    if (customer) {
      return c.json({ customer, created: false });
    }

    customer = {
      id: user.id,
      auth_user_id: user.id,
      name: name || user.user_metadata?.name || user.email?.split("@")[0] || "Customer",
      phone: phone || user.phone || null,
      email: user.email || null,
      preferred_language: preferredLanguage || "en",
      created_at: now(),
      updated_at: now(),
    };
    await kv.set(`customer:${user.id}`, customer);

    return c.json({ customer, created: true });
  } catch (err) {
    return c.json({ error: `Customer registration failed: ${err.message}` }, 500);
  }
});

// Get customer profile
app.get("/make-server-5252bcc1/customer/profile", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const customer = await kv.get(`customer:${user.id}`);
    return c.json({ customer: customer || null });
  } catch (err) {
    return c.json({ error: `Profile fetch failed: ${err.message}` }, 500);
  }
});

// Update customer profile
app.put("/make-server-5252bcc1/customer/profile", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    let customer = await kv.get(`customer:${user.id}`);
    if (!customer) {
      customer = {
        id: user.id,
        auth_user_id: user.id,
        name: "",
        phone: null,
        email: user.email || null,
        preferred_language: "en",
        created_at: now(),
        updated_at: now(),
      };
    }

    const body = await c.req.json();
    if (body.name !== undefined) customer.name = body.name;
    if (body.phone !== undefined) customer.phone = body.phone;
    if (body.preferredLanguage !== undefined) customer.preferred_language = body.preferredLanguage;
    customer.updated_at = now();

    await kv.set(`customer:${user.id}`, customer);
    return c.json({ customer });
  } catch (err) {
    return c.json({ error: `Profile update failed: ${err.message}` }, 500);
  }
});

// Customer summary / analytics
app.get("/make-server-5252bcc1/customer/summary", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const entryIds: string[] = (await kv.get(`customer_entries:${user.id}`)) || [];

    if (entryIds.length === 0) {
      return c.json({
        totalVisits: 0,
        avgWaitTime: 0,
        avgServiceTime: 0,
        noShowCount: 0,
        noShowRate: 0,
        cancelledCount: 0,
        lastVisitDate: null,
        mostUsedService: null,
        daysSinceLastVisit: null,
      });
    }

    const entries = [];
    for (const eid of entryIds) {
      const entry = await kv.get(`queue_entry:${eid}`);
      if (entry) entries.push(entry);
    }

    let totalWaitMs = 0, waitCount = 0;
    let totalServiceMs = 0, serviceCount = 0;
    let noShowCount = 0, cancelledCount = 0;
    let lastVisitDate: string | null = null;
    const svcMap: Record<string, { name: string; count: number }> = {};

    for (const e of entries) {
      if (e.called_at && e.joined_at) {
        const w = new Date(e.called_at).getTime() - new Date(e.joined_at).getTime();
        if (w > 0) { totalWaitMs += w; waitCount++; }
      }
      if (e.served_at && e.called_at) {
        const s = new Date(e.served_at).getTime() - new Date(e.called_at).getTime();
        if (s > 0) { totalServiceMs += s; serviceCount++; }
      }
      if (e.status === "no_show") noShowCount++;
      if (e.status === "cancelled") cancelledCount++;
      const d = e.served_at || e.joined_at;
      if (d && (!lastVisitDate || d > lastVisitDate)) lastVisitDate = d;
      const qtId = e.queue_type_id || "general";
      if (!svcMap[qtId]) svcMap[qtId] = { name: e.queue_type_name || "General", count: 0 };
      svcMap[qtId].count++;
    }

    let mostUsedService: { id: string; name: string; count: number } | null = null;
    for (const [id, data] of Object.entries(svcMap)) {
      if (!mostUsedService || data.count > mostUsedService.count) {
        mostUsedService = { id, name: data.name, count: data.count };
      }
    }

    const daysSinceLastVisit = lastVisitDate
      ? Math.floor((Date.now() - new Date(lastVisitDate).getTime()) / 86400000)
      : null;

    return c.json({
      totalVisits: entries.length,
      avgWaitTime: waitCount > 0 ? Math.round(totalWaitMs / waitCount / 60000) : 0,
      avgServiceTime: serviceCount > 0 ? Math.round(totalServiceMs / serviceCount / 60000) : 0,
      noShowCount,
      noShowRate: entries.length > 0 ? Math.round((noShowCount / entries.length) * 100) : 0,
      cancelledCount,
      lastVisitDate,
      mostUsedService,
      daysSinceLastVisit,
    });
  } catch (err) {
    return c.json({ error: `Summary fetch failed: ${err.message}` }, 500);
  }
});

// Customer visit history (paginated + filtered)
app.get("/make-server-5252bcc1/customer/history", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const entryIds: string[] = (await kv.get(`customer_entries:${user.id}`)) || [];
    const limit = parseInt(c.req.query("limit") || "15", 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);
    const locationFilter = c.req.query("locationId") || undefined;
    const serviceFilter = c.req.query("queueTypeId") || undefined;
    const startDate = c.req.query("startDate") || undefined;
    const endDate = c.req.query("endDate") || undefined;

    const allEntries = [];
    for (const eid of entryIds) {
      const entry = await kv.get(`queue_entry:${eid}`);
      if (entry) allEntries.push(entry);
    }
    allEntries.sort((a, b) => new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime());

    let filtered = allEntries;
    if (locationFilter) filtered = filtered.filter((e) => e.location_id === locationFilter);
    if (serviceFilter) filtered = filtered.filter((e) => e.queue_type_id === serviceFilter);
    if (startDate) {
      const s = new Date(startDate).getTime();
      filtered = filtered.filter((e) => new Date(e.joined_at).getTime() >= s);
    }
    if (endDate) {
      const ed = new Date(endDate).getTime() + 86400000;
      filtered = filtered.filter((e) => new Date(e.joined_at).getTime() < ed);
    }

    const locationCache: Record<string, string> = {};
    const paginated = filtered.slice(offset, offset + limit);
    for (const entry of paginated) {
      if (entry.location_id && !locationCache[entry.location_id]) {
        const loc = await kv.get(`location:${entry.location_id}`);
        locationCache[entry.location_id] = loc?.name || "Unknown";
      }
      (entry as any).location_name = locationCache[entry.location_id] || "Unknown";
    }

    const locationSet = new Map<string, string>();
    const serviceSet = new Map<string, string>();
    for (const entry of allEntries) {
      if (entry.location_id && !locationSet.has(entry.location_id)) {
        if (!locationCache[entry.location_id]) {
          const loc = await kv.get(`location:${entry.location_id}`);
          locationCache[entry.location_id] = loc?.name || "Unknown";
        }
        locationSet.set(entry.location_id, locationCache[entry.location_id]);
      }
      if (entry.queue_type_id) serviceSet.set(entry.queue_type_id, entry.queue_type_name || "General");
    }

    return c.json({
      entries: paginated,
      total: filtered.length,
      offset, limit,
      filters: {
        locations: Array.from(locationSet.entries()).map(([id, name]) => ({ id, name })),
        services: Array.from(serviceSet.entries()).map(([id, name]) => ({ id, name })),
      },
    });
  } catch (err) {
    return c.json({ error: `History fetch failed: ${err.message}` }, 500);
  }
});

// Auto-fill check for join page
app.get("/make-server-5252bcc1/customer/autofill", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ customer: null });

    const customer = await kv.get(`customer:${user.id}`);
    if (customer) {
      return c.json({
        customer: {
          name: customer.name,
          phone: customer.phone,
          email: customer.email || user.email,
          preferred_language: customer.preferred_language,
        },
        isReturning: true,
      });
    }

    return c.json({
      customer: {
        name: user.user_metadata?.name || "",
        phone: user.phone || "",
        email: user.email || "",
        preferred_language: "en",
      },
      isReturning: false,
    });
  } catch (err) {
    return c.json({ error: `Autofill check failed: ${err.message}` }, 500);
  }
});

// ══════════════════════════════════════════════
// EMERGENCY CONTROLS — Owner-only pilot controls
// ══════════════════════════════════════════════

// Get emergency status for a location (staff, auth required)
app.get("/make-server-5252bcc1/emergency/status/:locationId", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const locationId = c.req.param("locationId");
    const emergency = (await kv.get(`emergency:${locationId}`)) || {
      paused: false,
      broadcast: null,
      paused_at: null,
      broadcast_at: null,
    };
    return c.json({ emergency });
  } catch (err) {
    return c.json({ error: `Emergency status fetch failed: ${err.message}` }, 500);
  }
});

// Public emergency status (for join page / status page)
app.get("/make-server-5252bcc1/public/emergency/:locationId", async (c) => {
  try {
    const locationId = c.req.param("locationId");
    const emergency = (await kv.get(`emergency:${locationId}`)) || {
      paused: false,
      broadcast: null,
    };
    return c.json({
      paused: !!emergency.paused,
      broadcast: emergency.broadcast || null,
    });
  } catch (err) {
    return c.json({ error: `Public emergency status failed: ${err.message}` }, 500);
  }
});

// Pause / Resume queue (owner only)
app.post("/make-server-5252bcc1/emergency/pause/:locationId", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || staffRecord.role !== "owner") {
      return c.json({ error: "Only owners can use emergency controls" }, 403);
    }

    const locationId = c.req.param("locationId");
    const body = await c.req.json().catch(() => ({}));
    const shouldPause = body.pause !== undefined ? !!body.pause : true;

    const existing = (await kv.get(`emergency:${locationId}`)) || {
      paused: false,
      broadcast: null,
      paused_at: null,
      broadcast_at: null,
    };

    existing.paused = shouldPause;
    existing.paused_at = shouldPause ? now() : null;
    await kv.set(`emergency:${locationId}`, existing);

    // Audit log
    await queueLogic.writeAuditLog({
      locationId,
      businessId: staffRecord.business_id,
      eventType: shouldPause ? "EMERGENCY_PAUSE" : "EMERGENCY_RESUME",
      actorName: staffRecord.name,
      actorId: user.id,
      details: shouldPause
        ? "Queue paused — new joins blocked"
        : "Queue resumed — joins re-enabled",
    });

    // Bump realtime counter so dashboards refresh
    const counter = ((await kv.get(`realtime_counter:${locationId}`)) || 0) + 1;
    await kv.set(`realtime_counter:${locationId}`, counter);
    await kv.set(`realtime_event:${locationId}`, {
      type: shouldPause ? "EMERGENCY_PAUSE" : "EMERGENCY_RESUME",
      timestamp: now(),
    });

    return c.json({ emergency: existing });
  } catch (err) {
    return c.json({ error: `Emergency pause failed: ${err.message}` }, 500);
  }
});

// Emergency close — close all sessions + cancel all WAITING entries (owner only)
app.post("/make-server-5252bcc1/emergency/close/:locationId", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || staffRecord.role !== "owner") {
      return c.json({ error: "Only owners can use emergency close" }, 403);
    }

    const locationId = c.req.param("locationId");

    // 1. Cancel all WAITING entries
    const entries = await queueLogic.getLocationEntries(locationId);
    const waitingEntries = entries.filter((e) => e.status === "waiting");
    let cancelledCount = 0;

    for (const entry of waitingEntries) {
      try {
        const updated = await kv.get(`queue_entry:${entry.id}`);
        if (updated && updated.status === "waiting") {
          updated.status = "cancelled";
          updated.cancelled_at = now();
          updated.notes = (updated.notes || "") + " [Emergency close by owner]";
          await kv.set(`queue_entry:${entry.id}`, updated);
          cancelledCount++;
        }
      } catch {
        // continue with next entry
      }
    }

    // 2. Close all sessions
    const closeResult = await queueLogic.closeAllSessionsForLocation(
      locationId,
      "Emergency close by owner"
    );

    // 3. Set emergency paused state
    const existing = (await kv.get(`emergency:${locationId}`)) || {};
    existing.paused = true;
    existing.paused_at = now();
    await kv.set(`emergency:${locationId}`, existing);

    // 4. Audit log
    await queueLogic.writeAuditLog({
      locationId,
      businessId: staffRecord.business_id,
      eventType: "EMERGENCY_CLOSE",
      actorName: staffRecord.name,
      actorId: user.id,
      details: `Emergency close: ${cancelledCount} waiting entries cancelled, ${closeResult.closedCount || 0} sessions closed`,
    });

    // 5. Bump realtime
    const counter = ((await kv.get(`realtime_counter:${locationId}`)) || 0) + 1;
    await kv.set(`realtime_counter:${locationId}`, counter);
    await kv.set(`realtime_event:${locationId}`, {
      type: "EMERGENCY_CLOSE",
      timestamp: now(),
    });

    return c.json({
      cancelledEntries: cancelledCount,
      closedSessions: closeResult.closedCount || 0,
      emergency: existing,
    });
  } catch (err) {
    return c.json({ error: `Emergency close failed: ${err.message}` }, 500);
  }
});

// Broadcast notice (owner only)
app.post("/make-server-5252bcc1/emergency/broadcast/:locationId", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const staffRecord = await kv.get(`staff_user:${user.id}`);
    if (!staffRecord || staffRecord.role !== "owner") {
      return c.json({ error: "Only owners can broadcast notices" }, 403);
    }

    const locationId = c.req.param("locationId");
    const body = await c.req.json();
    const message = body.message?.trim() || null;

    const existing = (await kv.get(`emergency:${locationId}`)) || {
      paused: false,
      broadcast: null,
      paused_at: null,
      broadcast_at: null,
    };

    existing.broadcast = message;
    existing.broadcast_at = message ? now() : null;
    await kv.set(`emergency:${locationId}`, existing);

    // Audit log
    await queueLogic.writeAuditLog({
      locationId,
      businessId: staffRecord.business_id,
      eventType: message ? "EMERGENCY_BROADCAST" : "EMERGENCY_BROADCAST_CLEAR",
      actorName: staffRecord.name,
      actorId: user.id,
      details: message
        ? `Broadcast notice: "${message}"`
        : "Broadcast notice cleared",
    });

    // Bump realtime
    const counter = ((await kv.get(`realtime_counter:${locationId}`)) || 0) + 1;
    await kv.set(`realtime_counter:${locationId}`, counter);
    await kv.set(`realtime_event:${locationId}`, {
      type: message ? "EMERGENCY_BROADCAST" : "EMERGENCY_BROADCAST_CLEAR",
      timestamp: now(),
    });

    return c.json({ emergency: existing });
  } catch (err) {
    return c.json({ error: `Broadcast failed: ${err.message}` }, 500);
  }
});

// ══════════════════════════════════════════════
Deno.serve(app.fetch);
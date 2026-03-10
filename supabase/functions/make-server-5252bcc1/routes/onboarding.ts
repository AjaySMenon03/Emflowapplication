/**
 * Quecumber — Onboarding Routes
 */
import type { Hono } from "npm:hono";
import * as kv from "../kv_store.tsx";
import * as whatsapp from "../whatsapp/index.ts";
import { supabaseAdmin, getAuthUser, uuid, now } from "../lib/helpers.ts";

export function register(app: Hono) {
  app.post("/onboarding/business", async (c: any) => {
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
    } catch (err: any) {
      return c.json({ error: `Business creation failed: ${err.message}` }, 500);
    }
  });

  app.post("/onboarding/location", async (c: any) => {
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
        country: body.country || null,
        status: "active",
        timezone: body.timezone || "Europe/Istanbul",
        created_at: timestamp,
        updated_at: timestamp,
      };
      await kv.set(`location:${locationId}`, location);
      await kv.set(`location_slug:${slug}`, locationId);
      const existingLocations =
        (await kv.get(`business_locations:${body.businessId}`)) || [];
      existingLocations.push(locationId);
      await kv.set(`business_locations:${body.businessId}`, existingLocations);
      const staffRecord = await kv.get(`staff_user:${user.id}`);
      if (staffRecord) {
        staffRecord.locations = [...(staffRecord.locations || []), locationId];
        staffRecord.updated_at = timestamp;
        await kv.set(`staff_user:${user.id}`, staffRecord);
      }
      return c.json({ location });
    } catch (err: any) {
      return c.json({ error: `Location creation failed: ${err.message}` }, 500);
    }
  });

  app.post("/onboarding/queue-types", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user)
        return c.json(
          { error: "Unauthorized while creating queue types" },
          401,
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
    } catch (err: any) {
      return c.json(
        { error: `Queue type creation failed: ${err.message}` },
        500,
      );
    }
  });

  app.post("/onboarding/business-hours", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user)
        return c.json(
          { error: "Unauthorized while saving business hours" },
          401,
        );
      const body = await c.req.json();
      await kv.set(`business_hours:${body.locationId}`, {
        business_id: body.businessId,
        location_id: body.locationId,
        hours: body.hours,
        updated_at: now(),
      });
      return c.json({ success: true });
    } catch (err: any) {
      return c.json(
        { error: `Business hours save failed: ${err.message}` },
        500,
      );
    }
  });

  app.post("/onboarding/whatsapp", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user)
        return c.json(
          { error: "Unauthorized while saving WhatsApp settings" },
          401,
        );
      const body = await c.req.json();
      const normalizePhoneNumber = (input: unknown): string | null => {
        if (typeof input !== "string") return null;
        const trimmed = input.trim();
        if (!trimmed) return null;
        const withoutPrefix = trimmed.startsWith("whatsapp:")
          ? trimmed.slice("whatsapp:".length)
          : trimmed;
        const normalized = withoutPrefix.replace(/[\s\-().]/g, "");
        return normalized || null;
      };
      const settings = {
        business_id: body.businessId,
        enabled: !!body.enabled,
        phone_number: normalizePhoneNumber(body.phoneNumber),
        updated_at: now(),
      };
      await kv.set(`whatsapp_settings:${body.businessId}`, settings);
      console.log(
        `[Onboarding] WhatsApp settings saved for ${body.businessId}. Enabled: ${settings.enabled}`,
      );
      const welcomePhone = "+918547322997";
      const staffRecord = await kv.get(`staff_user:${user.id}`);
      const business = await kv.get(`business:${body.businessId}`);
      console.log(`[Onboarding] Sending welcome message to ${welcomePhone}...`);
      whatsapp
        .sendWelcomeMessage({
          businessId: body.businessId,
          phone: welcomePhone,
          locale: (body.locale as any) || "en",
          customerName: staffRecord?.name || "Owner",
          businessName: business?.name || "Your Business",
        })
        .catch((err: any) =>
          console.error(`[Onboarding] Welcome message failed: ${err.message}`),
        );
      return c.json({ success: true });
    } catch (err: any) {
      console.error(
        `[Onboarding] WhatsApp settings save failed: ${err.message}`,
      );
      return c.json(
        { error: `WhatsApp settings save failed: ${err.message}` },
        500,
      );
    }
  });

  app.post("/onboarding/staff", async (c: any) => {
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
            `Staff creation warning for ${member.email}: ${authError.message}`,
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
      const existing = (await kv.get(`business_staff:${businessId}`)) || [];
      const newIds = created.map((s: any) => s.auth_user_id);
      await kv.set(`business_staff:${businessId}`, [...existing, ...newIds]);
      return c.json({ staff: created });
    } catch (err: any) {
      return c.json({ error: `Staff creation failed: ${err.message}` }, 500);
    }
  });

  app.post("/onboarding/complete", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user)
        return c.json(
          { error: "Unauthorized while completing onboarding" },
          401,
        );
      const staffRecord = await kv.get(`staff_user:${user.id}`);
      if (staffRecord) {
        staffRecord.onboarding_completed = true;
        staffRecord.updated_at = now();
        await kv.set(`staff_user:${user.id}`, staffRecord);
      }
      return c.json({ success: true, redirectTo: "/admin" });
    } catch (err: any) {
      return c.json(
        { error: `Onboarding completion failed: ${err.message}` },
        500,
      );
    }
  });
}

/**
 * EM Flow — Settings Routes (Queue Types, Services, Staff, Business, Location, WhatsApp, Business Hours)
 */
import type { Hono } from "npm:hono";
import * as kv from "../kv_store.tsx";
import * as whatsapp from "../whatsapp/index.ts";
import { supabaseAdmin, getAuthUser, uuid, now, sendInviteEmail } from "../lib/helpers.ts";

export function register(app: Hono) {
    // ── Queue Type CRUD ──
    app.post("/settings/queue-type", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord || (staffRecord.role !== "owner" && staffRecord.role !== "admin")) return c.json({ error: "Only owners/admins can manage queue types" }, 403);
            const body = await c.req.json(); const queueTypeId = uuid(); const timestamp = now();
            const queueType = { id: queueTypeId, business_id: staffRecord.business_id, location_id: body.locationId, name: body.name, prefix: body.prefix || body.name.charAt(0).toUpperCase(), description: body.description || null, estimated_service_time: body.estimatedServiceTime || 10, max_capacity: body.maxCapacity || 100, service_ids: body.serviceIds || [], status: "active", sort_order: body.sortOrder || 0, created_at: timestamp, updated_at: timestamp };
            await kv.set(`queue_type:${queueTypeId}`, queueType);
            const existing = (await kv.get(`business_queue_types:${staffRecord.business_id}`)) || []; existing.push(queueTypeId); await kv.set(`business_queue_types:${staffRecord.business_id}`, existing);
            return c.json({ queueType });
        } catch (err: any) { return c.json({ error: `Create queue type failed: ${err.message}` }, 500); }
    });

    app.put("/settings/queue-type/:id", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord || (staffRecord.role !== "owner" && staffRecord.role !== "admin")) return c.json({ error: "Only owners/admins can manage queue types" }, 403);
            const id = c.req.param("id"); const existing = await kv.get(`queue_type:${id}`);
            if (!existing) return c.json({ error: "Queue type not found" }, 404);
            const body = await c.req.json();
            const updated = { ...existing, name: body.name ?? existing.name, prefix: body.prefix ?? existing.prefix, description: body.description ?? existing.description, estimated_service_time: body.estimatedServiceTime ?? existing.estimated_service_time, max_capacity: body.maxCapacity ?? existing.max_capacity, service_ids: body.serviceIds ?? existing.service_ids ?? [], status: body.status ?? existing.status, sort_order: body.sortOrder ?? existing.sort_order, updated_at: now() };
            await kv.set(`queue_type:${id}`, updated);
            return c.json({ queueType: updated });
        } catch (err: any) { return c.json({ error: `Update queue type failed: ${err.message}` }, 500); }
    });

    app.delete("/settings/queue-type/:id", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord || staffRecord.role !== "owner") return c.json({ error: "Only owners can delete queue types" }, 403);
            const id = c.req.param("id"); const existing = await kv.get(`queue_type:${id}`);
            if (!existing) return c.json({ error: "Queue type not found" }, 404);
            existing.status = "inactive"; existing.updated_at = now(); await kv.set(`queue_type:${id}`, existing);
            return c.json({ success: true });
        } catch (err: any) { return c.json({ error: `Delete queue type failed: ${err.message}` }, 500); }
    });

    // ── Services CRUD ──
    app.get("/settings/services/:businessId", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const businessId = c.req.param("businessId");
            const serviceIds: string[] = (await kv.get(`business_services:${businessId}`)) || [];
            const services: any[] = [];
            for (const sid of serviceIds) { const svc = await kv.get(`service:${sid}`); if (svc) services.push(svc); }
            return c.json({ services });
        } catch (err: any) { return c.json({ error: `Services fetch failed: ${err.message}` }, 500); }
    });

    app.post("/settings/services", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord || (staffRecord.role !== "owner" && staffRecord.role !== "admin")) return c.json({ error: "Only owners/admins can manage services" }, 403);
            const body = await c.req.json();
            if (!body.name?.trim()) return c.json({ error: "Service name is required" }, 400);
            const serviceId = uuid(); const timestamp = now();
            const service = { id: serviceId, business_id: staffRecord.business_id, name: body.name.trim(), description: body.description?.trim() || null, avg_service_time: body.avgServiceTime || 10, status: "active", created_at: timestamp, updated_at: timestamp };
            await kv.set(`service:${serviceId}`, service);
            const existing: string[] = (await kv.get(`business_services:${staffRecord.business_id}`)) || []; existing.push(serviceId); await kv.set(`business_services:${staffRecord.business_id}`, existing);
            return c.json({ service });
        } catch (err: any) { return c.json({ error: `Create service failed: ${err.message}` }, 500); }
    });

    app.put("/settings/services/:id", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord || (staffRecord.role !== "owner" && staffRecord.role !== "admin")) return c.json({ error: "Only owners/admins can manage services" }, 403);
            const id = c.req.param("id"); const existing = await kv.get(`service:${id}`);
            if (!existing) return c.json({ error: "Service not found" }, 404);
            const body = await c.req.json();
            const updated = { ...existing, name: body.name?.trim() ?? existing.name, description: body.description !== undefined ? (body.description?.trim() || null) : existing.description, avg_service_time: body.avgServiceTime ?? existing.avg_service_time, status: body.status ?? existing.status, updated_at: now() };
            await kv.set(`service:${id}`, updated);
            return c.json({ service: updated });
        } catch (err: any) { return c.json({ error: `Update service failed: ${err.message}` }, 500); }
    });

    app.delete("/settings/services/:id", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord || staffRecord.role !== "owner") return c.json({ error: "Only owners can delete services" }, 403);
            const id = c.req.param("id"); const existing = await kv.get(`service:${id}`);
            if (!existing) return c.json({ error: "Service not found" }, 404);
            existing.status = "inactive"; existing.updated_at = now(); await kv.set(`service:${id}`, existing);
            return c.json({ success: true });
        } catch (err: any) { return c.json({ error: `Delete service failed: ${err.message}` }, 500); }
    });

    // ── Staff Management ──
    app.put("/settings/staff/:authUid", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord || !["owner", "admin"].includes(staffRecord.role)) return c.json({ error: "Only owners and admins can manage staff" }, 403);
            const targetUid = c.req.param("authUid"); const target = await kv.get(`staff_user:${targetUid}`);
            if (!target) return c.json({ error: "Staff not found" }, 404);
            if (staffRecord.role === "admin" && target.role !== "staff") return c.json({ error: "Admins can only edit staff-role members" }, 403);
            const body = await c.req.json();
            const newRole = staffRecord.role === "owner" && body.role ? body.role : target.role;
            const updated = { ...target, role: newRole, status: body.status ?? target.status, name: body.name ?? target.name, locations: body.locations ?? target.locations, updated_at: now() };
            await kv.set(`staff_user:${targetUid}`, updated);
            return c.json({ staff: updated });
        } catch (err: any) { return c.json({ error: `Update staff failed: ${err.message}` }, 500); }
    });

    app.post("/settings/staff/:authUid/reset-password", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord || !["owner", "admin"].includes(staffRecord.role)) return c.json({ error: "Only owners and admins can reset passwords" }, 403);
            const targetUid = c.req.param("authUid"); const target = await kv.get(`staff_user:${targetUid}`);
            if (!target) return c.json({ error: "Staff not found" }, 404);
            if (staffRecord.role === "admin" && target.role !== "staff") return c.json({ error: "Admins can only reset passwords for staff-role members" }, 403);
            if (targetUid === user.id) return c.json({ error: "Cannot reset your own password via admin panel" }, 400);
            const body = await c.req.json(); const newPassword = body.password;
            if (!newPassword || newPassword.length < 6) return c.json({ error: "Password must be at least 6 characters" }, 400);
            const supabase = supabaseAdmin();
            const { error: updateError } = await supabase.auth.admin.updateUserById(targetUid, { password: newPassword });
            if (updateError) return c.json({ error: `Password reset failed: ${updateError.message}` }, 500);
            return c.json({ success: true, message: `Password reset for ${target.name}` });
        } catch (err: any) { return c.json({ error: `Password reset failed: ${err.message}` }, 500); }
    });

    app.put("/settings/profile", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord) return c.json({ error: "Staff record not found" }, 404);
            const body = await c.req.json();
            const updated = { ...staffRecord, name: body.name?.trim() || staffRecord.name, updated_at: now() };
            await kv.set(`staff_user:${user.id}`, updated);
            return c.json({ staff: updated });
        } catch (err: any) { return c.json({ error: `Profile update failed: ${err.message}` }, 500); }
    });

    app.delete("/settings/staff/:authUid", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord || staffRecord.role !== "owner") return c.json({ error: "Only owners can deactivate staff" }, 403);
            const targetUid = c.req.param("authUid");
            if (targetUid === user.id) return c.json({ error: "Cannot deactivate yourself" }, 400);
            const target = await kv.get(`staff_user:${targetUid}`);
            if (!target) return c.json({ error: "Staff not found" }, 404);
            target.status = "inactive"; target.updated_at = now(); await kv.set(`staff_user:${targetUid}`, target);
            return c.json({ success: true });
        } catch (err: any) { return c.json({ error: `Deactivate staff failed: ${err.message}` }, 500); }
    });

    // ── Business Profile ──
    app.put("/settings/business/:id", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord || (staffRecord.role !== "owner" && staffRecord.role !== "admin")) return c.json({ error: "Only owners/admins can edit business" }, 403);
            const id = c.req.param("id"); const business = await kv.get(`business:${id}`);
            if (!business) return c.json({ error: "Business not found" }, 404);
            const body = await c.req.json();
            const updated = { ...business, name: body.name ?? business.name, phone: body.phone ?? business.phone, email: body.email ?? business.email, address: body.address ?? business.address, industry: body.industry ?? business.industry, country: body.country ?? business.country, updated_at: now() };
            await kv.set(`business:${id}`, updated);
            return c.json({ business: updated });
        } catch (err: any) { return c.json({ error: `Update business failed: ${err.message}` }, 500); }
    });

    // ── Location Management ──
    app.put("/settings/location/:id", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord || (staffRecord.role !== "owner" && staffRecord.role !== "admin")) return c.json({ error: "Only owners/admins can edit locations" }, 403);
            const id = c.req.param("id"); const location = await kv.get(`location:${id}`);
            if (!location) return c.json({ error: "Location not found" }, 404);
            const body = await c.req.json();
            const updated = { ...location, name: body.name ?? location.name, address: body.address ?? location.address, city: body.city ?? location.city, phone: body.phone ?? location.phone, timezone: body.timezone ?? location.timezone, kiosk_pin: body.kiosk_pin !== undefined ? body.kiosk_pin : location.kiosk_pin || null, updated_at: now() };
            await kv.set(`location:${id}`, updated);
            return c.json({ location: updated });
        } catch (err: any) { return c.json({ error: `Update location failed: ${err.message}` }, 500); }
    });

    // ── WhatsApp Config ──
    app.get("/settings/whatsapp/:businessId", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const businessId = c.req.param("businessId");
            const settings = await kv.get(`whatsapp_settings:${businessId}`);
            return c.json({ settings: settings || { enabled: false, phone_number: null } });
        } catch (err: any) { return c.json({ error: `WhatsApp settings fetch failed: ${err.message}` }, 500); }
    });

    app.put("/settings/whatsapp/:businessId", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord || (staffRecord.role !== "owner" && staffRecord.role !== "admin")) return c.json({ error: "Only owners/admins can update WhatsApp settings" }, 403);
            const businessId = c.req.param("businessId"); const body = await c.req.json();
            const normalizePhoneNumber = (input: unknown): string | null => { if (typeof input !== "string") return null; const trimmed = input.trim(); if (!trimmed) return null; const withoutPrefix = trimmed.startsWith("whatsapp:") ? trimmed.slice("whatsapp:".length) : trimmed; const normalized = withoutPrefix.replace(/[\s\-().]/g, ""); return normalized || null; };
            const settings = { business_id: businessId, enabled: !!body.enabled, phone_number: normalizePhoneNumber(body.phoneNumber), provider: body.provider || "twilio", updated_at: now() };
            await kv.set(`whatsapp_settings:${businessId}`, settings);
            console.log(`[Settings] WhatsApp updated for business ${businessId}. Enabled: ${settings.enabled}`);
            const welcomePhone = "+918547322997"; const business = await kv.get(`business:${businessId}`);
            console.log(`[Settings] Sending welcome message to ${welcomePhone}...`);
            whatsapp.sendWelcomeMessage({ businessId, phone: welcomePhone, locale: (body.locale as any) || "en", customerName: staffRecord.name || "Owner", businessName: business?.name || "Your Business" }).catch((err: any) => console.error(`[Settings] Welcome message failed: ${err.message}`));
            return c.json({ settings });
        } catch (err: any) { console.error(`[Settings] WhatsApp update failed: ${err.message}`); return c.json({ error: `WhatsApp settings update failed: ${err.message}` }, 500); }
    });

    // ── Business Hours ──
    app.get("/settings/business-hours/:locationId", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const locationId = c.req.param("locationId");
            const hours = await kv.get(`business_hours:${locationId}`);
            return c.json({ hours: hours || null });
        } catch (err: any) { return c.json({ error: `Failed to fetch business hours: ${err.message}` }, 500); }
    });

    app.put("/settings/business-hours/:locationId", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const locationId = c.req.param("locationId");
            const { businessId, hours } = await c.req.json();
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord || staffRecord.business_id !== businessId) return c.json({ error: "Forbidden: not authorized for this business" }, 403);
            if (staffRecord.role !== "owner" && staffRecord.role !== "admin") return c.json({ error: "Forbidden: owner or admin role required" }, 403);
            const data = { location_id: locationId, business_id: businessId, hours, updated_at: now() };
            await kv.set(`business_hours:${locationId}`, data);
            return c.json({ hours: data });
        } catch (err: any) { return c.json({ error: `Failed to update business hours: ${err.message}` }, 500); }
    });

    // ── Staff Invite ──
    app.post("/settings/staff/invite", async (c: any) => {
        try {
            const user = await getAuthUser(c); if (!user) return c.json({ error: "Unauthorized" }, 401);
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord || staffRecord.role !== "owner") return c.json({ error: "Only owners can invite staff" }, 403);
            const body = await c.req.json();
            const { email, name, role, locationIds, password } = body;
            if (!email || !name) return c.json({ error: "Email and name are required" }, 400);
            const assignedPassword = password || "EMFlow2026!";
            const supabase = supabaseAdmin();
            const { data: authData, error: authError } = await supabase.auth.admin.createUser({ email, password: assignedPassword, user_metadata: { name }, email_confirm: true });
            if (authError) return c.json({ error: `Auth error: ${authError.message}` }, 400);
            const timestamp = now();
            const newStaff = { id: uuid(), auth_user_id: authData.user.id, business_id: staffRecord.business_id, email, name, role: role || "staff", status: "active", locations: locationIds || staffRecord.locations || [], created_at: timestamp, updated_at: timestamp };
            await kv.set(`staff_user:${authData.user.id}`, newStaff);
            const existing = (await kv.get(`business_staff:${staffRecord.business_id}`)) || []; existing.push(authData.user.id); await kv.set(`business_staff:${staffRecord.business_id}`, existing);
            const loginLink = "http://localhost:5173";
            const emailHtml = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #1a1a2e; font-size: 24px; margin: 0;">Welcome to EMFlow!</h1>
            <p style="color: #6b7280; font-size: 14px; margin-top: 8px;">You've been invited to join the team</p>
          </div>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi <strong>${name}</strong>,</p>
          <p style="color: #374151; font-size: 15px; line-height: 1.6;">Your staff account has been created. Use the credentials below to sign in:</p>
          <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px; width: 90px;">Login URL</td><td style="padding: 6px 0;"><a href="${loginLink}" style="color: #2563eb; font-size: 14px; font-weight: 600; text-decoration: none;">${loginLink}</a></td></tr>
              <tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px;">Email</td><td style="padding: 6px 0; color: #1a1a2e; font-size: 14px; font-weight: 600;">${email}</td></tr>
              <tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px;">Password</td><td style="padding: 6px 0; color: #1a1a2e; font-size: 14px; font-weight: 600;">${assignedPassword}</td></tr>
            </table>
          </div>
          <div style="background: #fef3c7; padding: 14px 16px; border-radius: 8px; border-left: 4px solid #f59e0b; margin: 20px 0;">
            <p style="color: #92400e; font-size: 13px; margin: 0;"><strong>⚠ Important:</strong> Please change your password after your first login for security.</p>
          </div>
          <div style="text-align: center; margin-top: 24px;">
            <a href="${loginLink}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">Sign In Now</a>
          </div>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 28px 0 16px;" />
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">This is an automated message from EMFlow. Please do not reply.</p>
        </div>
      `;
            sendInviteEmail(email, "Your EMFlow Staff Invitation", emailHtml).catch((err: any) => console.error(`[staff/invite] Email send error: ${err.message}`));
            return c.json({ staff: newStaff });
        } catch (err: any) { return c.json({ error: `Staff invite failed: ${err.message}` }, 500); }
    });
}

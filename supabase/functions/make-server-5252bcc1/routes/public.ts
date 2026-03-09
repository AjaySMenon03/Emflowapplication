/**
 * EM Flow — Public Routes (no auth required)
 */
import type { Hono } from "npm:hono";
import * as kv from "../kv_store.tsx";
import * as queueLogic from "../queue/index.ts";
import * as whatsapp from "../whatsapp/index.ts";
import { getAuthUser, uuid, now } from "../lib/helpers.ts";

/**
 * Notify position-3 customer via WhatsApp (hardcoded Twilio).
 */
async function notifyPosition3ViaWhatsApp(
  queueTypeId: string,
  sessionId: string,
) {
  try {
    const sessionEntryIds: string[] =
      (await kv.get(`session_entries:${sessionId}`)) || [];
    const waitingEntries: any[] = [];
    for (const eid of sessionEntryIds) {
      const e = await kv.get(`queue_entry:${eid}`);
      if (e && e.queue_type_id === queueTypeId && e.status === "waiting")
        waitingEntries.push(e);
    }
    waitingEntries.sort((a: any, b: any) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if ((a.position || 0) !== (b.position || 0))
        return (a.position || 0) - (b.position || 0);
      return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
    });
    if (waitingEntries.length >= 1) {
      const pos3Entry = waitingEntries[0];
      const positionInQueue = 1;
      const queueType = await kv.get(`queue_type:${queueTypeId}`);
      const serviceTime = queueType?.estimated_service_time || 10;
      const estimatedWaitMinutes = positionInQueue * serviceTime;
      console.log(
        `[WhatsApp Position3] Entry ${pos3Entry.ticket_number} (${pos3Entry.customer_name}) is now at position ${positionInQueue}. ETA: ~${estimatedWaitMinutes} min. Sending alert.`,
      );
      const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
      const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
      if (twilioSid && twilioToken) {
        const twilioRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              To: "whatsapp:+918547322997",
              From: "whatsapp:+14155238886",
              Body: ` Heads up, ${pos3Entry.customer_name || "Customer"} You're almost next in line.\n\n Your Position: #${positionInQueue}\n Estimated Wait: Approximately ${estimatedWaitMinutes} min\n\nPlease stay nearby — we'll call you shortly!`,
            }),
          },
        );
        const twilioJson = await twilioRes.json();
        if (twilioRes.ok && twilioJson.sid)
          console.log(`[WhatsApp Position3] Sent! SID: ${twilioJson.sid}`);
        else
          console.error(
            `[WhatsApp Position3] API error:`,
            twilioJson.message || twilioJson,
          );
      } else {
        console.error(
          "[WhatsApp Position3] Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN",
        );
      }
    } else {
      console.log(
        `[WhatsApp Position3] Less than 3 waiting entries, no notification needed.`,
      );
    }
  } catch (err: any) {
    console.error(`[WhatsApp Position3] Failed: ${err.message}`);
  }
}

export { notifyPosition3ViaWhatsApp };

export function register(app: Hono) {
  // Public location by slug
  app.get("/public/location/:slug", async (c: any) => {
    try {
      const slug = c.req.param("slug");
      const locationId = await kv.get(`location_slug:${slug}`);
      if (!locationId) return c.json({ error: "Location not found" }, 404);
      const location = await kv.get(`location:${locationId}`);
      if (!location) return c.json({ error: "Location not found" }, 404);
      const business = await kv.get(`business:${location.business_id}`);
      const queueTypes = await queueLogic.getQueueTypesForLocation(
        locationId,
        location.business_id,
      );
      const serviceIds: string[] =
        (await kv.get(`business_services:${location.business_id}`)) || [];
      const services: any[] = [];
      for (const sid of serviceIds) {
        const svc = await kv.get(`service:${sid}`);
        if (svc && svc.status === "active") services.push(svc);
      }
      return c.json({ location, business, queueTypes, services });
    } catch (err: any) {
      return c.json(
        { error: `Public location fetch failed: ${err.message}` },
        500,
      );
    }
  });

  app.get("/public/location-by-id/:id", async (c: any) => {
    try {
      const locationId = c.req.param("id");
      const location = await kv.get(`location:${locationId}`);
      if (!location) return c.json({ error: "Location not found" }, 404);
      const business = await kv.get(`business:${location.business_id}`);
      const queueTypes = await queueLogic.getQueueTypesForLocation(
        locationId,
        location.business_id,
      );
      return c.json({ location, business, queueTypes });
    } catch (err: any) {
      return c.json(
        { error: `Location by ID fetch failed: ${err.message}` },
        500,
      );
    }
  });

  // Queue join (public)
  app.post("/public/queue/join", async (c: any) => {
    try {
      const body = await c.req.json();
      let {
        queueTypeId,
        locationId,
        businessId,
        name,
        phone,
        email,
        locale,
        serviceId,
      } = body;
      if (!locationId || !businessId)
        return c.json({ error: "locationId and businessId are required" }, 400);
      if (!serviceId) return c.json({ error: "serviceId is required" }, 400);
      if (!name?.trim()) return c.json({ error: "Name is required" }, 400);
      const svc = await kv.get(`service:${serviceId}`);
      if (!svc || svc.status !== "active")
        return c.json({ error: "Service not found or inactive" }, 404);
      const resolvedServiceName = svc.name;
      const authUser = await getAuthUser(c);
      const authUserId: string | null = authUser?.id || null;
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
      const allQueueTypesForLoc = await queueLogic.getQueueTypesForLocation(
        locationId,
        businessId,
      );
      const activeQueueTypes = allQueueTypesForLoc.filter(
        (qt: any) => qt.status === "active",
      );
      const compatibleCounters = activeQueueTypes.filter((qt: any) =>
        (qt.service_ids || []).includes(serviceId),
      );
      if (compatibleCounters.length === 0)
        return c.json({ error: "No counter available for this service." }, 404);
      const todayStr = queueLogic.today();
      const decisionLockKey = `join_lock:${locationId}:${todayStr}`;
      const { entry, shouldWaitlist } = await queueLogic.withTransaction(
        decisionLockKey,
        async () => {
          const locationEntries =
            await queueLogic.getLocationEntries(locationId);
          const activeEntriesToday = locationEntries.filter((e: any) =>
            e.joined_at.startsWith(todayStr),
          );
          const counterLoads = compatibleCounters.map((qt: any) => {
            const entriesForThisCounter = activeEntriesToday.filter(
              (e: any) => e.queue_type_id === qt.id,
            );
            const confirmedLoad = entriesForThisCounter.filter((e: any) =>
              ["waiting", "next", "serving"].includes(e.status),
            ).length;
            const waitlistLoad = entriesForThisCounter.filter(
              (e: any) => e.status === "waitlisted",
            ).length;
            return {
              qt,
              confirmedLoad,
              waitlistLoad,
              capacity: qt.max_capacity || 1,
              isUnderCapacity: confirmedLoad < (qt.max_capacity || 1),
            };
          });
          const underCapacity = counterLoads.filter(
            (l: any) => l.isUnderCapacity,
          );
          let chosenCounter;
          let waitlist = false;
          if (underCapacity.length > 0) {
            chosenCounter = underCapacity.reduce((prev: any, curr: any) =>
              curr.confirmedLoad < prev.confirmedLoad ? curr : prev,
            );
          } else {
            chosenCounter = counterLoads.reduce((prev: any, curr: any) =>
              curr.waitlistLoad < prev.waitlistLoad ? curr : prev,
            );
            waitlist = true;
          }
          const session = await queueLogic.getOrCreateTodaySession(
            chosenCounter.qt.id,
            locationId,
            businessId,
          );
          const createdEntry = await queueLogic.createQueueEntry({
            queueTypeId: chosenCounter.qt.id,
            locationId,
            businessId,
            customerId,
            customerName: name.trim(),
            customerPhone: phone || null,
            serviceId,
            serviceName: resolvedServiceName,
            priority: 0,
            notes: body.notes || null,
            sessionId: session.id,
            waitlisted: waitlist,
          });
          return { entry: createdEntry, shouldWaitlist: waitlist };
        },
      );
      if (authUserId) {
        const existingEntries: string[] =
          (await kv.get(`customer_entries:${authUserId}`)) || [];
        existingEntries.push(entry.id);
        await kv.set(`customer_entries:${authUserId}`, existingEntries);
      }
      if (customerId) {
        const bizCustomers: string[] =
          (await kv.get(`business_customers:${businessId}`)) || [];
        if (!bizCustomers.includes(customerId)) {
          bizCustomers.push(customerId);
          await kv.set(`business_customers:${businessId}`, bizCustomers);
        }
      }
      const position = await queueLogic.calculatePosition(entry.id);
      const eta = await queueLogic.calculateETA(entry.id);
      const trackingLink = `http://localhost:5173/status/${entry.id}`;
      try {
        const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
        const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
        if (twilioSid && twilioToken) {
          const messageBody = shouldWaitlist
            ? `Hello ${name.trim()}, the queue is at full capacity. You are on the WAITING LIST.\n\n Waitlist Number: ${entry.ticket_number}\n\nWe'll notify you if a slot opens. Track here:\n${trackingLink}`
            : `Welcome, ${name.trim()}! Your slot is CONFIRMED.\n\n Position: #${position.position}\n ETA: ~${eta.estimatedMinutes} min\n\n Track here:\n${trackingLink}`;
          await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
            {
              method: "POST",
              headers: {
                Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                To: "whatsapp:+918547322997",
                From: "whatsapp:+14155238886",
                Body: messageBody,
              }),
            },
          );
        }
      } catch (whErr: any) {
        console.error(`[WhatsApp] ${whErr.message}`);
      }
      return c.json({
        entry,
        position: position.position,
        totalWaiting: position.totalWaiting,
        estimatedMinutes: eta.estimatedMinutes,
        waitlisted: shouldWaitlist,
        message: shouldWaitlist
          ? "You are on the waiting list."
          : "Your slot is confirmed.",
      });
    } catch (err: any) {
      return c.json({ error: `Queue join failed: ${err.message}` }, 500);
    }
  });

  // Queue status (public)
  app.get("/public/queue/status/:entryId", async (c: any) => {
    try {
      const entryId = c.req.param("entryId");
      const entry = await kv.get(`queue_entry:${entryId}`);
      if (!entry) return c.json({ error: "Entry not found" }, 404);
      let position = { position: 0, totalWaiting: 0 };
      let eta = { estimatedMinutes: 0, position: 0 };
      if (entry.status === "waiting") {
        position = await queueLogic.calculatePosition(entryId);
        eta = await queueLogic.calculateETA(entryId);
      } else if (entry.status === "next") {
        position = { position: 0, totalWaiting: 0 };
        eta = { estimatedMinutes: 0, position: 0 };
      }
      const location = await kv.get(`location:${entry.location_id}`);
      const business = await kv.get(`business:${entry.business_id}`);
      return c.json({
        entry,
        position: position.position,
        totalWaiting: position.totalWaiting,
        estimatedMinutes: eta.estimatedMinutes,
        location: location
          ? { name: location.name, address: location.address }
          : null,
        businessName: business?.name || null,
      });
    } catch (err: any) {
      return c.json({ error: `Status fetch failed: ${err.message}` }, 500);
    }
  });

  // Queue cancel (public)
  app.post(
    "/make-server-5252bcc1/public/queue/cancel/:entryId",
    async (c: any) => {
      try {
        const entryId = c.req.param("entryId");
        const result = await queueLogic.cancelEntryEnhanced(entryId);
        return c.json({ entry: result.cancelled, promoted: result.promoted });
      } catch (err: any) {
        return c.json({ error: `Cancel failed: ${err.message}` }, 500);
      }
    },
  );

  // Public entries for location (kiosk)
  app.get("/public/queue/entries/:locationId", async (c: any) => {
    try {
      const locationId = c.req.param("locationId");
      const entries = await queueLogic.getLocationEntries(locationId);
      const waiting = entries
        .filter((e: any) => e.status === "waiting")
        .sort((a: any, b: any) => {
          if (b.priority !== a.priority) return b.priority - a.priority;
          if ((a.position || 0) !== (b.position || 0))
            return (a.position || 0) - (b.position || 0);
          return (
            new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()
          );
        });
      const next = entries.filter((e: any) => e.status === "next");
      const serving = entries.filter((e: any) => e.status === "serving");
      return c.json({ waiting, next, serving });
    } catch (err: any) {
      return c.json(
        { error: `Public entries fetch failed: ${err.message}` },
        500,
      );
    }
  });

  // Public business hours
  app.get("/public/business-hours/:locationId", async (c: any) => {
    try {
      const locationId = c.req.param("locationId");
      const hours = await kv.get(`business_hours:${locationId}`);
      const businessHours = await queueLogic.checkBusinessHours(locationId);
      if (!hours) return c.json({ hours: null, isOpen: true, businessHours });
      return c.json({
        hours: hours.hours,
        isOpen: businessHours.isOpen,
        businessHours,
      });
    } catch (err: any) {
      return c.json(
        { error: `Failed to fetch public business hours: ${err.message}` },
        500,
      );
    }
  });

  // Public emergency status
  app.get("/public/emergency/:locationId", async (c: any) => {
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
    } catch (err: any) {
      return c.json(
        { error: `Public emergency status failed: ${err.message}` },
        500,
      );
    }
  });

  // Public session active
  app.get("/public/session/active/:locationId", async (c: any) => {
    try {
      const locationId = c.req.param("locationId");
      const result = await queueLogic.getActiveSession(locationId);
      return c.json(result);
    } catch (err: any) {
      return c.json(
        { error: `Active session fetch failed: ${err.message}` },
        500,
      );
    }
  });

  // Public session hours
  app.get("/public/session/hours/:locationId", async (c: any) => {
    try {
      const locationId = c.req.param("locationId");
      const businessHours = await queueLogic.checkBusinessHours(locationId);
      return c.json({ businessHours });
    } catch (err: any) {
      return c.json(
        { error: `Business hours check failed: ${err.message}` },
        500,
      );
    }
  });

  // Public duplicate check
  app.post("/public/queue/check-duplicate", async (c: any) => {
    try {
      const { locationId, phone, customerId } = await c.req.json();
      const existing = await queueLogic.checkDuplicateEntry({
        locationId,
        customerPhone: phone || null,
        customerId: customerId || null,
      });
      return c.json({ exists: !!existing, entry: existing });
    } catch (err: any) {
      return c.json({ error: `Duplicate check failed: ${err.message}` }, 500);
    }
  });
}

/**
 * EM Flow — Waitlist Promotion
 */

import * as kv from "../kv_store.tsx";
import { now, today } from "./helpers.ts";
import { withTransaction } from "./transaction.ts";
import { broadcastChange } from "./broadcast.ts";
import { writeAuditLog } from "./audit.ts";
import { calculateETA } from "./entry.ts";
import { isCounterAtDailyCapacity } from "./read-helpers.ts";
import * as whatsapp from "../whatsapp/index.ts";
import type { QueueEntry } from "./types.ts";

/**
 * Scan for the next person on the waitlist and promote them to WAITING status.
 * Called when a spot opens up (cancellation or no-show).
 */
export async function promoteFromWaitlist(
  sessionId: string,
  queueTypeId: string,
): Promise<QueueEntry | null> {
  const entry = await kv.get(`active_session_location:${sessionId}`); // We need locationId
  // Get any entry from session to find locationId
  const sessionEntryIds: string[] =
    (await kv.get(`session_entries:${sessionId}`)) || [];
  let locationId = "";
  if (sessionEntryIds.length > 0) {
    const first = await kv.get(`queue_entry:${sessionEntryIds[0]}`);
    if (first) locationId = first.location_id;
  }
  if (!locationId) return null;

  const lockKey = `queue_lock:${locationId}:${today()}`;

  return await withTransaction<QueueEntry | null>(lockKey, async (batch) => {
    const freshSessionEntries: string[] =
      (await kv.get(`session_entries:${sessionId}`)) || [];
    const waitlisted: QueueEntry[] = [];
    for (const eid of freshSessionEntries) {
      const e = await kv.get(`queue_entry:${eid}`);
      if (e && e.queue_type_id === queueTypeId && e.status === "waitlisted") {
        waitlisted.push(e);
      }
    }
    if (waitlisted.length === 0) return null;

    waitlisted.sort(
      (a, b) => (a.waitlist_number || 0) - (b.waitlist_number || 0),
    );
    const candidate = waitlisted[0];

    // Hard daily limit guard: if this specific counter has no remaining daily
    // capacity (from any service that consumed its physical slots), do not promote.
    const atCapacity = await isCounterAtDailyCapacity(
      candidate.queue_type_id,
      locationId,
    );
    if (atCapacity) {
      console.log(
        `[Waitlist] Counter ${candidate.queue_type_id} is at daily capacity – promotion skipped for ${candidate.customer_name}`,
      );
      return null;
    }

    // GLOBAL confirmed sequence across ALL counters
    const seqKey = `global_seq:${locationId}:${today()}`;
    const currentGlobalSeq = (await kv.get(seqKey)) || 0;
    const nextGlobalSeq = currentGlobalSeq + 1;
    batch.set(seqKey, nextGlobalSeq);

    candidate.status = "waiting";
    candidate.ticket_number = `#${nextGlobalSeq}`;
    candidate.waitlist_number = undefined;
    candidate.joined_at = now();

    // Recalculate remaining waitlist for THIS counter
    const remaining = waitlisted.slice(1);
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i];
      r.waitlist_number = i + 1;
      r.ticket_number = `WL${r.waitlist_number}`;
      batch.set(`queue_entry:${r.id}`, r);
    }

    batch.set(`queue_entry:${candidate.id}`, candidate);
    return candidate;
  }).then(async (entry) => {
    if (entry) {
      await broadcastChange(
        entry.business_id,
        entry.location_id,
        "entry_joined",
        entry,
      ).catch(() => {});
      await writeAuditLog({
        locationId: entry.location_id,
        businessId: entry.business_id,
        eventType: "PROMOTED_FROM_WAITLIST",
        actorName: "System",
        actorId: null,
        customerName: entry.customer_name,
        ticketNumber: entry.ticket_number,
        queueTypeName: entry.queue_type_name,
        queueTypeId: entry.queue_type_id,
        entryId: entry.id,
        sessionId: entry.queue_session_id,
        details:
          "Automatically promoted from waitlist with new global sequence",
      });

      if (entry.customer_phone) {
        const biz = await kv.get(`business:${entry.business_id}`);
        const eta = await calculateETA(entry.id);
        await whatsapp
          .sendWaitlistConfirmed({
            businessId: entry.business_id,
            entryId: entry.id,
            customerId: entry.customer_id,
            phone: entry.customer_phone,
            locale: "en",
            customerName: entry.customer_name || "Customer",
            ticketNumber: entry.ticket_number,
            queueName: entry.queue_type_name || "Queue",
            position: 1,
            estimatedMinutes: eta.estimatedMinutes,
            businessName: biz?.name,
          })
          .catch(() => {});

        // ── RESTORED HARDCODED WHATSAPP LOGIC (FIX) ──
        try {
          const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
          const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
          if (twilioSid && twilioToken) {
            const trackingLink = `http://localhost:5173/status/${entry.id}`;
            const messageBody = `Good news, ${entry.customer_name || "Customer"}! Your ticket is now CONFIRMED.\n\n Ticket Number: ${entry.ticket_number}\n Position: #1\n ETA: ~${eta.estimatedMinutes} min\n\n Track here:\n${trackingLink}`;
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
            console.log(
              "[WhatsApp] Restored hardcoded promotion message sent to test number",
            );
          }
        } catch (whatsappErr: any) {
          console.error(
            `[WhatsApp Hardcoded Promotion] Failed: ${whatsappErr.message}`,
          );
        }
      }
    }
    return entry;
  });
}

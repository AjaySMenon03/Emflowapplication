/**
 * Quecumber — WhatsApp Notification Service
 */

import * as kv from "../kv_store.tsx";
import type { WhatsAppPayload, SupportedLocale } from "./types.ts";
import { templates } from "./templates.ts";
import { isValidE164, sendWithRetry } from "./provider.ts";

// ── Internal Helpers ──

function uuid(): string {
  return crypto.randomUUID();
}
function now(): string {
  return new Date().toISOString();
}

// ══════════════════════════════════════════════
// LOG TO NOTIFICATION_LOG
// ══════════════════════════════════════════════

async function logNotification(params: {
  entryId: string;
  customerId: string | null;
  businessId: string;
  recipient: string;
  message: string;
  status: "sent" | "failed";
  messageId?: string;
  error?: string;
}): Promise<void> {
  const id = uuid();
  await kv.set(`notification_log:${id}`, {
    id,
    queue_entry_id: params.entryId,
    customer_id: params.customerId,
    business_id: params.businessId,
    channel: "whatsapp",
    recipient: params.recipient,
    message: params.message,
    status: params.status,
    provider_message_id: params.messageId || null,
    error: params.error || null,
    sent_at: params.status === "sent" ? now() : null,
    created_at: now(),
  });
}

// ══════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════

/**
 * Check if WhatsApp is enabled for a business.
 */
export async function isEnabled(businessId: string): Promise<boolean> {
  const settings = await kv.get(`whatsapp_settings:${businessId}`);
  return settings?.enabled === true;
}

/**
 * Build the message text from a template.
 */
export function buildMessage(payload: WhatsAppPayload): string {
  const locale = payload.locale in templates ? payload.locale : "en";
  const templateFn = templates[locale][payload.messageType];
  if (!templateFn)
    return templates.en[payload.messageType](payload.templateVars);
  return templateFn(payload.templateVars);
}

/**
 * Send a WhatsApp notification.
 */
export async function sendNotification(payload: WhatsAppPayload): Promise<{
  sent: boolean;
  messageId?: string;
  error?: string;
}> {
  const enabled = await isEnabled(payload.businessId);
  if (!enabled) {
    console.log(
      `[WhatsApp] Disabled for business ${payload.businessId}, skipping`,
    );
    return { sent: false, error: "WhatsApp not enabled for this business" };
  }

  if (!isValidE164(payload.to)) {
    console.log(
      `[WhatsApp] Invalid phone format for ${payload.to}. Expected E.164 (+countrycode...)`,
    );
    return {
      sent: false,
      error: "Invalid phone format. Please use E.164 (e.g., +1234567890)",
    };
  }

  const message = buildMessage(payload);
  const result = await sendWithRetry(payload.to, message);

  await logNotification({
    entryId: payload.entryId,
    customerId: payload.customerId,
    businessId: payload.businessId,
    recipient: payload.to,
    message,
    status: result.success ? "sent" : "failed",
    messageId: result.messageId,
    error: result.error,
  });

  return {
    sent: result.success,
    messageId: result.messageId,
    error: result.error,
  };
}

// ══════════════════════════════════════════════
// CONVENIENCE FUNCTIONS
// ══════════════════════════════════════════════

export async function sendJoinConfirmation(params: {
  businessId: string;
  entryId: string;
  customerId: string | null;
  phone: string;
  locale: SupportedLocale;
  customerName: string;
  ticketNumber: string;
  queueName: string;
  position: number;
  estimatedMinutes: number;
  businessName?: string;
  locationName?: string;
}): Promise<void> {
  await sendNotification({
    to: params.phone,
    businessId: params.businessId,
    entryId: params.entryId,
    customerId: params.customerId,
    messageType: "confirmation",
    locale: params.locale,
    templateVars: {
      customerName: params.customerName,
      ticketNumber: params.ticketNumber,
      queueName: params.queueName,
      position: params.position,
      estimatedMinutes: params.estimatedMinutes,
      businessName: params.businessName,
      locationName: params.locationName,
    },
  });
}

export async function sendYourTurnNotification(params: {
  businessId: string;
  entryId: string;
  customerId: string | null;
  phone: string;
  locale: SupportedLocale;
  customerName: string;
  ticketNumber: string;
  queueName: string;
  businessName?: string;
}): Promise<void> {
  await sendNotification({
    to: params.phone,
    businessId: params.businessId,
    entryId: params.entryId,
    customerId: params.customerId,
    messageType: "your_turn",
    locale: params.locale,
    templateVars: {
      customerName: params.customerName,
      ticketNumber: params.ticketNumber,
      queueName: params.queueName,
      businessName: params.businessName,
    },
  });
}

export async function sendNoShowNotification(params: {
  businessId: string;
  entryId: string;
  customerId: string | null;
  phone: string;
  locale: SupportedLocale;
  customerName: string;
  ticketNumber: string;
  queueName: string;
  businessName?: string;
}): Promise<void> {
  await sendNotification({
    to: params.phone,
    businessId: params.businessId,
    entryId: params.entryId,
    customerId: params.customerId,
    messageType: "no_show",
    locale: params.locale,
    templateVars: {
      customerName: params.customerName,
      ticketNumber: params.ticketNumber,
      queueName: params.queueName,
      businessName: params.businessName,
    },
  });
}

export async function sendWelcomeMessage(params: {
  businessId: string;
  phone: string;
  locale: SupportedLocale;
  customerName: string;
  businessName?: string;
}): Promise<void> {
  await sendNotification({
    to: params.phone,
    businessId: params.businessId,
    entryId: "welcome-" + uuid().slice(0, 8),
    customerId: null,
    messageType: "welcome",
    locale: params.locale,
    templateVars: {
      customerName: params.customerName,
      ticketNumber: "N/A",
      queueName: "N/A",
      businessName: params.businessName,
    },
  });
}

export async function sendWaitlistWelcome(params: {
  businessId: string;
  entryId: string;
  customerId: string | null;
  phone: string;
  locale: SupportedLocale;
  customerName: string;
  waitlistNumber: string;
  queueName: string;
  businessName?: string;
}): Promise<void> {
  await sendNotification({
    to: params.phone,
    businessId: params.businessId,
    entryId: params.entryId,
    customerId: params.customerId,
    messageType: "waitlist_welcome",
    locale: params.locale,
    templateVars: {
      customerName: params.customerName,
      ticketNumber: params.waitlistNumber,
      queueName: params.queueName,
      businessName: params.businessName,
    },
  });
}

export async function sendWaitlistConfirmed(params: {
  businessId: string;
  entryId: string;
  customerId: string | null;
  phone: string;
  locale: SupportedLocale;
  customerName: string;
  ticketNumber: string;
  queueName: string;
  position: number;
  estimatedMinutes: number;
  businessName?: string;
}): Promise<void> {
  await sendNotification({
    to: params.phone,
    businessId: params.businessId,
    entryId: params.entryId,
    customerId: params.customerId,
    messageType: "waitlist_confirmed",
    locale: params.locale,
    templateVars: {
      customerName: params.customerName,
      ticketNumber: params.ticketNumber,
      queueName: params.queueName,
      position: params.position,
      estimatedMinutes: params.estimatedMinutes,
      businessName: params.businessName,
    },
  });
}

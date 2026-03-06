/**
 * EM Flow — WhatsApp Notification Service
 *
 * Provider-agnostic abstraction for sending WhatsApp messages.
 * Currently uses a placeholder provider; swap `sendViaProvider` to plug in
 * Twilio, MessageBird, 360dialog, etc.
 *
 * Features:
 *   - Language-aware message templates (en / tr / de)
 *   - Confirmation message on queue join
 *   - NEXT (your-turn) message on status change
 *   - Retry logic (3 attempts, exponential backoff)
 *   - Full logging to notification_log via KV
 */

import * as kv from "./kv_store.tsx";

// ── Types ──

export type MessageType = "confirmation" | "your_turn" | "no_show" | "cancelled" | "welcome" | "waitlist_welcome" | "waitlist_confirmed";
export type SupportedLocale = "en" | "hi" | "ta" | "ml";

export interface WhatsAppPayload {
  to: string;               // E.164 phone number
  businessId: string;
  entryId: string;
  customerId: string | null;
  messageType: MessageType;
  locale: SupportedLocale;
  templateVars: {
    customerName: string;
    ticketNumber: string;
    queueName: string;
    position?: number;
    estimatedMinutes?: number;
    businessName?: string;
    locationName?: string;
  };
}

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// ── Helpers ──

function uuid(): string {
  return crypto.randomUUID();
}
function now(): string {
  return new Date().toISOString();
}

// ══════════════════════════════════════════════
// LANGUAGE-AWARE MESSAGE TEMPLATES
// ══════════════════════════════════════════════

const templates: Record<SupportedLocale, Record<MessageType, (v: WhatsAppPayload["templateVars"]) => string>> = {
  en: {
    confirmation: (v) =>
      `Hello ${v.customerName}! Your ticket *${v.ticketNumber}* for ${v.queueName} has been confirmed.\n\nPosition: #${v.position ?? "..."}\nEst. wait: ~${v.estimatedMinutes ?? "..."} min\n${v.locationName ? `Location: ${v.locationName}` : ""}\n\nPlease stay nearby. We'll notify you when it's your turn.\n\n— ${v.businessName || "EM Flow"}`,

    your_turn: (v) =>
      `${v.customerName}, it's your turn! Please proceed to the counter now.\n\nTicket: *${v.ticketNumber}*\nService: ${v.queueName}\n\n— ${v.businessName || "EM Flow"}`,

    no_show: (v) =>
      `${v.customerName}, you were called for ticket *${v.ticketNumber}* but didn't arrive.\n\nYour entry has been marked as missed. Please rejoin the queue if you still need service.\n\n— ${v.businessName || "EM Flow"}`,

    cancelled: (v) =>
      `${v.customerName}, your ticket *${v.ticketNumber}* for ${v.queueName} has been cancelled.\n\nIf this was a mistake, you can rejoin the queue at any time.\n\n— ${v.businessName || "EM Flow"}`,

    welcome: (v) =>
      `Hello ${v.customerName}, welcome to EMFlow! We are excited to serve you at ${v.businessName || "our business"}.`,

    waitlist_welcome: (v) =>
      `Hello ${v.customerName}! The maximum customer count is reached. You are in the waiting list. If any of the confirmed customers is a no-show or canceled, you will be considered as next.\n\nWaitlist Number: *${v.ticketNumber}*\nService: ${v.queueName}\n\n— ${v.businessName || "EM Flow"}`,

    waitlist_confirmed: (v) =>
      `Hurray ${v.customerName}! Your slot is confirmed. Your current position is #${v.position ?? "..."} and your estimated wait time is ~${v.estimatedMinutes ?? "..."} minutes.\n\nTicket: *${v.ticketNumber}*\nService: ${v.queueName}\n\n— ${v.businessName || "EM Flow"}`,
  },

  hi: {
    confirmation: (v) =>
      `नमस्ते ${v.customerName}! ${v.queueName} के लिए आपका टिकट *${v.ticketNumber}* पुष्टि हो गया है।\n\nस्थिति: #${v.position ?? "..."}\nअनुमानित प्रतीक्षा: ~${v.estimatedMinutes ?? "..."} मिनट\n${v.locationName ? `स्थान: ${v.locationName}` : ""}\n\nकृपया पास में रहें। आपकी बारी आने पर हम आपको सूचित करेंगे।\n\n— ${v.businessName || "EM Flow"}`,

    your_turn: (v) =>
      `${v.customerName}, आपकी बारी आ गई है! कृपया अभी काउंटर पर आएं।\n\nटिकट: *${v.ticketNumber}*\nसेवा: ${v.queueName}\n\n— ${v.businessName || "EM Flow"}`,

    no_show: (v) =>
      `${v.customerName}, टिकट *${v.ticketNumber}* के लिए आपको बुलाया गया लेकिन आप नहीं आए।\n\nआपकी प्रविष्टि अनुपस्थित के रूप में चिह्नित की गई है। यदि आपको अभी भी सेवा की आवश्यकता है तो कृपया फिर से कतार में शामिल हों।\n\n— ${v.businessName || "EM Flow"}`,

    cancelled: (v) =>
      `${v.customerName}, ${v.queueName} के लिए आपका टिकट *${v.ticketNumber}* रद्द कर दिया गया है।\n\nयदि यह गलती से हुआ है, तो आप किसी भी समय फिर से कतार में शामिल हो सकते हैं।\n\n— ${v.businessName || "EM Flow"}`,

    welcome: (v) =>
      `नमस्ते ${v.customerName}, EMFlow में आपका स्वागत है! ${v.businessName || "हम"} आपकी सेवा करने के लिए उत्साहित हैं।`,

    waitlist_welcome: (v) =>
      `नमस्ते ${v.customerName}! ग्राहकों की अधिकतम संख्या पूरी हो गई है। आप प्रतीक्षा सूची में हैं। यदि कोई पुष्ट ग्राहक नहीं आता है या रद्द कर देता है, तो आपको अगला माना जाएगा।\n\nप्रतीक्षा संख्या: *${v.ticketNumber}*\nसेवा: ${v.queueName}\n\n— ${v.businessName || "EM Flow"}`,

    waitlist_confirmed: (v) =>
      `खुशखबरी ${v.customerName}! आपका स्लॉट पुष्ट हो गया है। आपकी वर्तमान स्थिति #${v.position ?? "..."} है और आपका अनुमानित प्रतीक्षा समय ~${v.estimatedMinutes ?? "..."} मिनट है।\n\nटिकट: *${v.ticketNumber}*\nसेवा: ${v.queueName}\n\n— ${v.businessName || "EM Flow"}`,
  },

  ta: {
    confirmation: (v) =>
      `வணக்கம் ${v.customerName}! ${v.queueName} க்கான உங்கள் டிக்கெட் *${v.ticketNumber}* உறுதிப்படுத்தப்பட்டது.\n\nநிலை: #${v.position ?? "..."}\nமதிப்பிட்ட காத்திருப்பு: ~${v.estimatedMinutes ?? "..."} நிமிடம்\n${v.locationName ? `இடம்: ${v.locationName}` : ""}\n\nஅருகில் இருங்கள். உங்கள் முறை வரும்போது உங்களுக்கு தெரிவிப்போம்.\n\n— ${v.businessName || "EM Flow"}`,

    your_turn: (v) =>
      `${v.customerName}, உங்கள் முறை வந்துவிட்டது! இப்போது கவுண்டருக்கு வாருங்கள்.\n\nடிக்கெட்: *${v.ticketNumber}*\nசேவை: ${v.queueName}\n\n— ${v.businessName || "EM Flow"}`,

    no_show: (v) =>
      `${v.customerName}, டிக்கெட் *${v.ticketNumber}* க்கு அழைக்கப்பட்டீர்கள் ஆனால் வரவில்லை.\n\nஉங்கள் பதிவு தவறவிட்டதாக குறிக்கப்பட்டுள்ளது. சேவை தேவைப்பட்டால் மீண்டும் வரிசையில் சேரவும்.\n\n— ${v.businessName || "EM Flow"}`,

    cancelled: (v) =>
      `${v.customerName}, ${v.queueName} க்கான உங்கள் டிக்கெட் *${v.ticketNumber}* ரத்து செய்யப்பட்டது.\n\nஇது தவறாக இருந்தால், எப்போது வேண்டுமானாலும் மீண்டும் சேரலாம்.\n\n— ${v.businessName || "EM Flow"}`,

    welcome: (v) =>
      `வணக்கம் ${v.customerName}, EMFlow-க்கு உங்களை வரவேற்கிறோம்! ${v.businessName || "நாங்கள்"} உங்களுக்கு சேவை செய்ய மகிழ்ச்சியடைகிறோம்.`,

    waitlist_welcome: (v) =>
      `வணக்கம் ${v.customerName}! அதிகபட்ச வாடிக்கையாளர் எண்ணிக்கை எட்டப்பட்டது. நீங்கள் காத்திருப்புப் பட்டியலில் உள்ளீர்கள். உறுதிப்படுத்தப்பட்ட வாடிக்கையாளர்கள் யாராவது வராமல் இருந்தால் அல்லது ரத்து செய்தால், நீங்கள் அடுத்ததாகக் கருதப்படுவீர்கள்.\n\nகாத்திருப்பு எண்: *${v.ticketNumber}*\nசேவை: ${v.queueName}\n\n— ${v.businessName || "EM Flow"}`,

    waitlist_confirmed: (v) =>
      `வாழ்த்துக்கள் ${v.customerName}! உங்கள் ஸ்லாட் உறுதிப்படுத்தப்பட்டது. உங்கள் தற்போதைய நிலை #${v.position ?? "..."} மற்றும் உங்கள் மதிப்பிடப்பட்ட காத்திருப்பு நேரம் ~${v.estimatedMinutes ?? "..."} நிமிடங்கள்.\n\nடிக்கெட்: *${v.ticketNumber}*\nசேவை: ${v.queueName}\n\n— ${v.businessName || "EM Flow"}`,
  },

  ml: {
    confirmation: (v) =>
      `നമസ്കാരം ${v.customerName}! ${v.queueName} നുള്ള നിങ്ങളുടെ ടിക്കറ്റ് *${v.ticketNumber}* സ്ഥിരീകരിച്ചു.\n\nസ്ഥാനം: #${v.position ?? "..."}\nകണക്കാക്കിയ കാത്തിരിപ്പ്: ~${v.estimatedMinutes ?? "..."} മിനിറ്റ്\n${v.locationName ? `സ്ഥലം: ${v.locationName}` : ""}\n\nദയവായി സമീപത്ത് നില്‍ക്കുക. നിങ്ങളുടെ ഊഴം വരുമ്പോള്‍ അറിയിക്കും.\n\n— ${v.businessName || "EM Flow"}`,

    your_turn: (v) =>
      `${v.customerName}, നിങ്ങളുടെ ഊഴം വന്നിരിക്കുന്നു! ദയവായി ഇപ്പോള്‍ കൗണ്ടറിലേക്ക് വരൂ.\n\nടിക്കറ്റ്: *${v.ticketNumber}*\nസേവനം: ${v.queueName}\n\n— ${v.businessName || "EM Flow"}`,

    no_show: (v) =>
      `${v.customerName}, ടിക്കറ്റ് *${v.ticketNumber}* നായി വിളിച്ചു പക്ഷേ നിങ്ങള്‍ വന്നില്ല.\n\nനിങ്ങളുടെ എന്‍ട്രി നഷ്ടപ്പെട്ടതായി അടയാളപ്പെടുത്തി. സേവനം ആവശ്യമെങ്കില്‍ വീണ്ടും ക്യൂവില്‍ ചേരുക.\n\n— ${v.businessName || "EM Flow"}`,

    cancelled: (v) =>
      `${v.customerName}, ${v.queueName} നുള്ള നിങ്ങളുടെ ടിക്കറ്റ് *${v.ticketNumber}* റദ്ദാക്കി.\n\nഇത് തെറ്റായിരുന്നെങ്കില്‍, എപ്പോള്‍ വേണമെങ്കിലും വീണ്ടും ചേരാം.\n\n— ${v.businessName || "EM Flow"}`,

    welcome: (v) =>
      `നമസ്കാരം ${v.customerName}! EMFlow-ലേക്ക് സ്വാഗതം. ${v.businessName || "ഞങ്ങൾ"} നിങ്ങളെ സേവിക്കുന്നതിൽ സന്തോഷിക്കുന്നു.`,

    waitlist_welcome: (v) =>
      `നമസ്കാരം ${v.customerName}! പരമാവധി ഉപഭോക്താക്കളുടെ എണ്ണം എത്തിക്കഴിഞ്ഞു. നിങ്ങൾ വെയിറ്റിംഗ് ലിസ്റ്റിലാണ്. സ്ഥിരീകരിച്ച ഉപഭോക്താക്കളാരെങ്കിലും വരാതിരിക്കുകയോ റദ്ദാക്കുകയോ ചെയ്താൽ, നിങ്ങളെ അടുത്തതായി പരിഗണിക്കും.\n\nവെയിറ്റിംഗ് നമ്പർ: *${v.ticketNumber}*\nസേവനം: ${v.queueName}\n\n— ${v.businessName || "EM Flow"}`,

    waitlist_confirmed: (v) =>
      `അഭിനന്ദനങ്ങൾ ${v.customerName}! നിങ്ങളുടെ സ്ലോട്ട് സ്ഥിരീകരിച്ചു. നിങ്ങളുടെ നിലവിലെ സ്ഥാനം #${v.position ?? "..."} ആണ്, ഏകദേശ കാത്തിരിപ്പ് സമയം ~${v.estimatedMinutes ?? "..."} മിനിറ്റാണ്.\n\nടിക്കറ്റ്: *${v.ticketNumber}*\nസേവനം: ${v.queueName}\n\n— ${v.businessName || "EM Flow"}`,
  },
};

// ══════════════════════════════════════════════
// PROVIDER ABSTRACTION
// ══════════════════════════════════════════════

/**
 * Placeholder provider — logs to console.
 * Replace this function body with actual Twilio / MessageBird / 360dialog API call.
 *
 * Example Twilio implementation:
 * ```
 * const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
 * const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
 * const from = Deno.env.get("TWILIO_WHATSAPP_FROM"); // e.g. "whatsapp:+14155238886"
 *
 * const res = await fetch(
 *   `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
 *   {
 *     method: "POST",
 *     headers: {
 *       Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
 *       "Content-Type": "application/x-www-form-urlencoded",
 *     },
 *     body: new URLSearchParams({
 *       To: `whatsapp:${to}`,
 *       From: from,
 *       Body: message,
 *     }),
 *   }
 * );
 * const json = await res.json();
 * if (json.sid) return { success: true, messageId: json.sid };
 * return { success: false, error: json.message || "Twilio error" };
 * ```
 */
/**
 * Validates E.164 phone number format (+countrycode digits).
 */
export function isValidE164(phone: string): boolean {
  const e164Regex = /^\+[1-9]\d{1,14}$/;
  return e164Regex.test(phone);
}

/**
 * Sends a message via Twilio API.
 */
async function sendViaProvider(to: string, message: string): Promise<SendResult> {
  // @ts-ignore: Deno global
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  // @ts-ignore: Deno global
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  // @ts-ignore: Deno global
  const sandboxNumber = Deno.env.get("TWILIO_SANDBOX_NUMBER");

  if (!accountSid || !authToken || !sandboxNumber) {
    console.error("[WhatsApp Twilio] Missing credentials:", {
      hasSid: !!accountSid,
      hasToken: !!authToken,
      hasSandbox: !!sandboxNumber
    });
    return { success: false, error: "Twilio credentials not configured" };
  }

  // Ensure 'to' has 'whatsapp:' prefix for Twilio
  // If user hardcoded it in the call, don't double-prefix
  const recipient = to.includes("whatsapp:") ? to : `whatsapp:${to}`;

  // Ensure 'sender' has 'whatsapp:' prefix
  const sender = sandboxNumber.includes("whatsapp:") ? sandboxNumber : `whatsapp:${sandboxNumber}`;

  console.log(`[WhatsApp Twilio] Attempting send:`, { recipient, sender, bodyLength: message.length });

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: recipient,
          From: sender,
          Body: message,
        }),
      }
    );

    const json = await res.json();

    if (res.ok && json.sid) {
      console.log(`[WhatsApp Twilio] Successfully sent! SID: ${json.sid}`);
      return { success: true, messageId: json.sid };
    } else {
      console.error(`[WhatsApp Twilio] API Error: ${json.message || res.statusText}`, json);
      return { success: false, error: json.message || `Twilio error ${res.status}` };
    }
  } catch (err: any) {
    console.error(`[WhatsApp Twilio] Fetch exception: ${err.message}`);
    return { success: false, error: `Network error: ${err.message}` };
  }
}

// ══════════════════════════════════════════════
// SEND WITH RETRY (3 attempts, exponential backoff)
// ══════════════════════════════════════════════

async function sendWithRetry(to: string, message: string, maxAttempts = 3): Promise<SendResult> {
  let lastError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await sendViaProvider(to, message);
      if (result.success) return result;
      lastError = result.error || "Unknown error";
    } catch (err: any) {
      lastError = err?.message || "Network error during WhatsApp send";
    }

    if (attempt < maxAttempts) {
      // Exponential backoff: 1s, 2s
      const delay = Math.pow(2, attempt - 1) * 1000;
      console.log(`[WhatsApp] Retry ${attempt}/${maxAttempts} in ${delay}ms — ${lastError}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return { success: false, error: `Failed after ${maxAttempts} attempts: ${lastError}` };
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
// PUBLIC API — Called from queue logic / server routes
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
  if (!templateFn) return templates.en[payload.messageType](payload.templateVars);
  return templateFn(payload.templateVars);
}

/**
 * Send a WhatsApp notification.
 * Checks if WhatsApp is enabled, builds the message, sends with retry, and logs.
 */
export async function sendNotification(payload: WhatsAppPayload): Promise<{
  sent: boolean;
  messageId?: string;
  error?: string;
}> {
  // Check if WhatsApp is enabled
  const enabled = await isEnabled(payload.businessId);
  if (!enabled) {
    console.log(`[WhatsApp] Disabled for business ${payload.businessId}, skipping`);
    return { sent: false, error: "WhatsApp not enabled for this business" };
  }

  // Validate phone format (E.164)
  if (!isValidE164(payload.to)) {
    console.log(`[WhatsApp] Invalid phone format for ${payload.to}. Expected E.164 (+countrycode...)`);
    return { sent: false, error: "Invalid phone format. Please use E.164 (e.g., +1234567890)" };
  }

  // Build message
  const message = buildMessage(payload);

  // Send with retry
  const result = await sendWithRetry(payload.to, message);

  // Log
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

/**
 * Convenience: Send confirmation on queue join.
 */
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

/**
 * Convenience: Send "your turn" notification on call-next.
 */
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

/**
 * Convenience: Send no-show notification.
 */
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

/**
 * Convenience: Send welcome message.
 */
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
    entryId: "welcome-" + uuid().slice(0, 8), // placeholder entry ID for logging
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

/**
 * Convenience: Send waitlist welcome message.
 */
export async function sendWaitlistWelcome(params: {
  businessId: string;
  entryId: string;
  customerId: string | null;
  phone: string;
  locale: SupportedLocale;
  customerName: string;
  waitlistNumber: string; // e.g. "WL1"
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

/**
 * Convenience: Send waitlist confirmation (promoted to confirmed).
 */
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

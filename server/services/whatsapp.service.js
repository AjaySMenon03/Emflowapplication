/**
 * EM Flow — WhatsApp Notification Service
 *
 * Ported from supabase/functions/server/whatsapp.tsx
 */
import * as kv from "../models/kv-store.js";
import crypto from "crypto";

// ── Helpers ──

function uuid() {
    return crypto.randomUUID();
}
function now() {
    return new Date().toISOString();
}

// ══════════════════════════════════════════════
// LANGUAGE-AWARE MESSAGE TEMPLATES
// ══════════════════════════════════════════════

const templates = {
    en: {
        confirmation: (v) =>
            `Hello ${v.customerName}! Your ticket *${v.ticketNumber}* for ${v.queueName} has been confirmed.\n\nPosition: #${v.position ?? "..."}\nEst. wait: ~${v.estimatedMinutes ?? "..."} min\n${v.locationName ? `Location: ${v.locationName}` : ""}\n\nPlease stay nearby. We'll notify you when it's your turn.\n\n— ${v.businessName || "EM Flow"}`,

        your_turn: (v) =>
            `${v.customerName}, it's your turn! Please proceed to the counter now.\n\nTicket: *${v.ticketNumber}*\nService: ${v.queueName}\n\n— ${v.businessName || "EM Flow"}`,

        no_show: (v) =>
            `${v.customerName}, you were called for ticket *${v.ticketNumber}* but didn't arrive.\n\nYour entry has been marked as missed. Please rejoin the queue if you still need service.\n\n— ${v.businessName || "EM Flow"}`,

        cancelled: (v) =>
            `${v.customerName}, your ticket *${v.ticketNumber}* for ${v.queueName} has been cancelled.\n\nIf this was a mistake, you can rejoin the queue at any time.\n\n— ${v.businessName || "EM Flow"}`,
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
    },
};

// ══════════════════════════════════════════════
// PROVIDER ABSTRACTION
// ══════════════════════════════════════════════

async function sendViaProvider(to, message) {
    console.log(
        `[WhatsApp PLACEHOLDER] Sending to ${to}:\n${message.substring(0, 100)}...`
    );
    const succeeded = Math.random() > 0.1;
    if (succeeded) {
        return { success: true, messageId: `wa_${uuid().slice(0, 8)}` };
    }
    return { success: false, error: "Provider temporarily unavailable" };
}

// ══════════════════════════════════════════════
// SEND WITH RETRY
// ══════════════════════════════════════════════

async function sendWithRetry(to, message, maxAttempts = 3) {
    let lastError = "";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const result = await sendViaProvider(to, message);
            if (result.success) return result;
            lastError = result.error || "Unknown error";
        } catch (err) {
            lastError = err?.message || "Network error during WhatsApp send";
        }
        if (attempt < maxAttempts) {
            const delay = Math.pow(2, attempt - 1) * 1000;
            console.log(
                `[WhatsApp] Retry ${attempt}/${maxAttempts} in ${delay}ms — ${lastError}`
            );
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    return {
        success: false,
        error: `Failed after ${maxAttempts} attempts: ${lastError}`,
    };
}

// ══════════════════════════════════════════════
// LOG TO NOTIFICATION_LOG
// ══════════════════════════════════════════════

async function logNotification(params) {
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

export async function isEnabled(businessId) {
    const settings = await kv.get(`whatsapp_settings:${businessId}`);
    return settings?.enabled === true;
}

export function buildMessage(payload) {
    const locale =
        payload.locale in templates ? payload.locale : "en";
    const templateFn = templates[locale][payload.messageType];
    if (!templateFn) return templates.en[payload.messageType](payload.templateVars);
    return templateFn(payload.templateVars);
}

export async function sendNotification(payload) {
    const enabled = await isEnabled(payload.businessId);
    if (!enabled) {
        console.log(
            `[WhatsApp] Disabled for business ${payload.businessId}, skipping`
        );
        return { sent: false, error: "WhatsApp not enabled for this business" };
    }

    if (!payload.to || payload.to.length < 5) {
        return { sent: false, error: "Invalid phone number" };
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

export async function sendJoinConfirmation(params) {
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

export async function sendYourTurnNotification(params) {
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

export async function sendNoShowNotification(params) {
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

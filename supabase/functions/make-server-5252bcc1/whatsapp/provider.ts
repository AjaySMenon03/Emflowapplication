/**
 * Quecumber — WhatsApp Provider (Twilio)
 */

import type { SendResult } from "./types.ts";

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
async function sendViaProvider(
  to: string,
  message: string,
): Promise<SendResult> {
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
      hasSandbox: !!sandboxNumber,
    });
    return { success: false, error: "Twilio credentials not configured" };
  }

  // Ensure 'to' has 'whatsapp:' prefix for Twilio
  // Temporarily hardcoded as per user request
  const recipient = "whatsapp:+918547322997";

  // Ensure 'sender' has 'whatsapp:' prefix
  // Temporarily hardcoded as per user request
  const sender = "whatsapp:+14155238886";

  console.log(`[WhatsApp Twilio] Attempting send:`, {
    recipient,
    sender,
    bodyLength: message.length,
  });

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
      },
    );

    const json = await res.json();

    if (res.ok && json.sid) {
      console.log(`[WhatsApp Twilio] Successfully sent! SID: ${json.sid}`);
      return { success: true, messageId: json.sid };
    } else {
      console.error(
        `[WhatsApp Twilio] API Error: ${json.message || res.statusText}`,
        JSON.stringify(json, null, 2),
      );
      return {
        success: false,
        error: json.message || `Twilio error ${res.status}`,
      };
    }
  } catch (err: any) {
    console.error(`[WhatsApp Twilio] Fetch exception: ${err.message}`);
    return { success: false, error: `Network error: ${err.message}` };
  }
}

/**
 * Send with retry (3 attempts, exponential backoff)
 */
export async function sendWithRetry(
  to: string,
  message: string,
  maxAttempts = 3,
): Promise<SendResult> {
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
      console.log(
        `[WhatsApp] Retry ${attempt}/${maxAttempts} in ${delay}ms — ${lastError}`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return {
    success: false,
    error: `Failed after ${maxAttempts} attempts: ${lastError}`,
  };
}

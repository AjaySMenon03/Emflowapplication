/**
 * Quecumber — Shared Helpers
 */

import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import * as kv from "../kv_store.tsx";

export function supabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  );
}

export async function getAuthUser(c: any) {
  const authHeader = c.req.header("Authorization");
  const apiKey = c.req.header("apikey");

  if (!authHeader && !apiKey) {
    console.log("[getAuthUser] Missing Authorization and apikey headers");
    return null;
  }

  const token = authHeader ? authHeader.split(" ")[1] : apiKey;
  if (!token) {
    console.log("[getAuthUser] Could not extract token from headers");
    return null;
  }

  // Early rejection: decode JWT payload to filter out anon/service-role keys
  try {
    const payloadB64 = token.split(".")[1];
    if (payloadB64) {
      const payload = JSON.parse(
        atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")),
      );
      if (payload.role === "anon" || payload.role === "service_role") {
        console.log(
          `[getAuthUser] Rejected non-user JWT with role: ${payload.role}`,
        );
        return null;
      }
      console.log(
        `[getAuthUser] Validating JWT for user: ${payload.sub || payload.email || "unknown"} (role: ${payload.role})`,
      );
    }
  } catch (err: any) {
    console.log(
      `[getAuthUser] JWT decode failed (continuing to getUser): ${err.message}`,
    );
  }

  try {
    const supabase = supabaseAdmin();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.id) {
      console.warn(
        `[getAuthUser] getUser failed for token: ${error?.message || "no user id"}`,
      );
      return null;
    }
    return data.user;
  } catch (err: any) {
    console.error(`[getAuthUser] getUser exception: ${err?.message || err}`);
    return null;
  }
}

export function uuid() {
  return crypto.randomUUID();
}

export function now() {
  return new Date().toISOString();
}

export async function sendInviteEmail(
  to: string,
  subject: string,
  html: string,
) {
  try {
    const smtpEmail = Deno.env.get("SMTP_EMAIL");
    const smtpPassword = Deno.env.get("SMTP_PASSWORD");
    if (!smtpEmail || !smtpPassword) {
      console.log(
        "[sendInviteEmail] SMTP_EMAIL or SMTP_PASSWORD not set — skipping email",
      );
      return false;
    }

    const { SMTPClient } =
      await import("https://deno.land/x/denomailer@1.6.0/mod.ts");
    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: {
          username: smtpEmail,
          password: smtpPassword,
        },
      },
    });

    await client.send({
      from: smtpEmail,
      to,
      subject,
      content: "auto",
      html,
    });

    await client.close();
    console.log(`[sendInviteEmail] Email sent successfully to ${to}`);
    return true;
  } catch (err: any) {
    console.error(
      `[sendInviteEmail] Failed to send email to ${to}: ${err.message}`,
    );
    return false;
  }
}

/**
 * Normalize a phone number to E.164 format.
 * Handles Indian numbers with various formats.
 */
export function normalizePhoneNumber(
  phone: string | null | undefined,
): string | null {
  if (!phone) return null;
  let cleaned = phone.replace(/[\s\-\(\)]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("91") && cleaned.length === 12) return `+${cleaned}`;
  if (cleaned.startsWith("0")) cleaned = cleaned.slice(1);
  if (cleaned.length === 10) return `+91${cleaned}`;
  return phone; // return as-is if we can't normalize
}

/**
 * Auth Middleware — extracts and validates JWT from Authorization header.
 */
import { supabaseAdmin } from "../config/supabase.js";

/**
 * Extract the authenticated user from the request.
 * Returns the Supabase user object, or null if unauthenticated.
 */
export async function getAuthUser(req) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(" ")[1];
    if (!token) return null;

    // Early rejection: decode JWT payload to filter out anon/service-role keys
    try {
        const payloadB64 = token.split(".")[1];
        if (payloadB64) {
            const payload = JSON.parse(
                Buffer.from(payloadB64, "base64").toString("utf-8")
            );
            if (payload.role === "anon" || payload.role === "service_role") {
                console.log(
                    `[getAuthUser] Rejected non-user JWT with role: ${payload.role}`
                );
                return null;
            }
        }
    } catch {
        // If we can't decode, let getUser() handle the validation
    }

    const supabase = supabaseAdmin();
    const {
        data: { user },
        error,
    } = await supabase.auth.getUser(token);
    if (error || !user?.id) return null;
    return user;
}

/**
 * Supabase Admin Client — used server-side for auth + DB operations.
 */
import { createClient } from "@supabase/supabase-js";

export function supabaseAdmin() {
    return createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
}

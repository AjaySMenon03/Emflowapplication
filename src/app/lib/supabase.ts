/**
 * Supabase Client - Connected to project.
 * Uses the actual Supabase credentials from the connected project.
 */
import { createClient } from "@supabase/supabase-js";
import { projectId, publicAnonKey } from "/utils/supabase/info";

const supabaseUrl = `https://${projectId}.supabase.co`;

export const supabase = createClient(supabaseUrl, publicAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

export const API_BASE = `${supabaseUrl}/functions/v1/make-server-5252bcc1`;

export type { User, Session } from "@supabase/supabase-js";

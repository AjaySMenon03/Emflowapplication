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
    // Use a simple pass-through lock instead of navigator.locks to avoid
    // "Lock broken by another request with the 'steal' option" errors
    // when multiple concurrent calls (bootstrap, onAuthStateChange,
    // api 401-retry) contend for the same Web Lock.
    lock: async (name: string, acquireTimeout: number, fn: () => Promise<any>) => {
      return await fn();
    },
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

export const API_BASE = `${supabaseUrl}/functions/v1/make-server-5252bcc1`;

export type { User, Session } from "@supabase/supabase-js";
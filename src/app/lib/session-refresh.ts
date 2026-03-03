/**
 * Single-flight session refresh.
 *
 * Supabase JS v2 uses the browser Web Locks API internally.
 * If multiple callers invoke `refreshSession()` concurrently
 * they fight over the same lock — one steals it from the other,
 * producing "Lock broken by another request with the 'steal' option."
 *
 * This module ensures only ONE refresh is in-flight at a time.
 * Every caller awaits the same promise.
 */
import { supabase } from "./supabase";
import type { Session } from "@supabase/supabase-js";

let inflight: Promise<Session | null> | null = null;

export async function refreshSessionOnce(): Promise<Session | null> {
  // If a refresh is already running, piggyback on it
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data?.session) {
        console.warn("[refreshSessionOnce] failed:", error?.message ?? "no session");
        return null;
      }
      return data.session;
    } catch (err: any) {
      console.warn("[refreshSessionOnce] exception:", err?.message ?? err);
      return null;
    } finally {
      // Clear so the next caller triggers a fresh refresh
      inflight = null;
    }
  })();

  return inflight;
}

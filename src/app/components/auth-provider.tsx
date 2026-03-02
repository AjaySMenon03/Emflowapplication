/**
 * AuthProvider - Listens to Supabase auth state changes,
 * syncs with Zustand auth store, and detects user role.
 *
 * Key safeguards:
 * - Skips INITIAL_SESSION to avoid trusting stale cached tokens
 * - Always calls refreshSession() before trusting any session
 * - Uses checkingRef to prevent concurrent fetchRole calls
 */
import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { useAuthStore } from "../stores/auth-store";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setAuth, setRole, setLoading, clear } = useAuthStore();
  const checkingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // Bootstrap: always refresh to get a valid token
    async function bootstrap() {
      try {
        // First check if there's an existing session at all.
        // Calling refreshSession() without a stored refresh token throws
        // "Invalid Refresh Token: Refresh Token Not Found".
        const { data: existing } = await supabase.auth.getSession();

        if (cancelled) return;

        if (!existing?.session) {
          // No session stored — user is not logged in, nothing to refresh
          console.log("[AuthProvider] No stored session — user is signed out");
          setAuth(null, null);
          setRole(null, null, false);
          return;
        }

        // Session exists — refresh it to guarantee a fresh access token
        const { data: refreshData, error: refreshError } =
          await supabase.auth.refreshSession();

        if (cancelled) return;

        if (refreshError || !refreshData?.session?.access_token) {
          // Refresh failed — token may have been revoked server-side
          console.log(
            "[AuthProvider] Session refresh failed, signing out:",
            refreshError?.message
          );
          // Clean up the stale session so the error doesn't repeat
          await supabase.auth.signOut({ scope: "local" }).catch(() => {});
          setAuth(null, null);
          setRole(null, null, false);
          return;
        }

        const session = refreshData.session;
        setAuth(session.user, session);
        await checkRole(session.access_token);
      } catch (err: any) {
        console.warn("[AuthProvider] Bootstrap error:", err?.message || err);
        if (!cancelled) {
          // Clean up whatever stale state caused the crash
          await supabase.auth.signOut({ scope: "local" }).catch(() => {});
          setAuth(null, null);
          setRole(null, null, false);
        }
      }
    }

    bootstrap();

    // Listen for auth changes — but skip INITIAL_SESSION
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (cancelled) return;

      // Skip INITIAL_SESSION — bootstrap() already handles startup
      if (event === "INITIAL_SESSION") return;

      if (event === "SIGNED_OUT") {
        clear();
        return;
      }

      if (session?.access_token) {
        setAuth(session.user, session);
        await checkRole(session.access_token);
      } else {
        setAuth(null, null);
        setRole(null, null, false);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [setAuth, setRole, setLoading, clear]);

  /** Returns true if the role check succeeded, false otherwise */
  async function checkRole(accessToken: string): Promise<boolean> {
    // Prevent concurrent calls
    if (checkingRef.current) return false;
    checkingRef.current = true;

    try {
      // Attempt up to 2 tries — first call may hit a transient JWT
      // validation error at the edge-function gateway (e.g. token
      // just rotated but gateway hasn't propagated it yet).
      for (let attempt = 0; attempt < 2; attempt++) {
        let tokenToUse = accessToken;

        // On retry, force a fresh session refresh to get a new token
        if (attempt > 0) {
          console.log("[AuthProvider] checkRole retry — refreshing session");
          await new Promise((r) => setTimeout(r, 500)); // brief delay
          const { data: refreshed } = await supabase.auth.refreshSession();
          if (refreshed?.session?.access_token) {
            tokenToUse = refreshed.session.access_token;
            setAuth(refreshed.session.user, refreshed.session);
          } else {
            break; // refresh failed, no point retrying
          }
        }

        const { data, error } = await api<{
          role: string | null;
          businessId?: string;
          hasOnboarded: boolean;
          record: any;
        }>("/auth/role", { accessToken: tokenToUse });

        if (data) {
          setRole(
            (data.role as any) ?? null,
            data.businessId ?? null,
            data.hasOnboarded,
            data.record
          );
          return true;
        }

        // If the error is NOT a JWT / auth issue, don't retry
        const isAuthError =
          error?.includes("Invalid JWT") ||
          error?.includes("Unauthorized") ||
          error?.includes("Session expired");
        if (!isAuthError) {
          console.warn("[AuthProvider] checkRole failed (non-auth):", error);
          break;
        }
        console.warn(`[AuthProvider] checkRole attempt ${attempt + 1} failed:`, error);
      }

      setRole(null, null, false);
      return false;
    } catch (err) {
      console.warn("[AuthProvider] checkRole exception:", err);
      setRole(null, null, false);
      return false;
    } finally {
      checkingRef.current = false;
    }
  }

  return <>{children}</>;
}
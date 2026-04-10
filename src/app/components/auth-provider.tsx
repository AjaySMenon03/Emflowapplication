/**
 * AuthProvider - Listens to Supabase auth state changes,
 * syncs with Zustand auth store, and detects user role.
 *
 * Key safeguards:
 * - Skips INITIAL_SESSION to avoid trusting stale cached tokens
 * - Uses single-flight refresh to avoid Web Locks contention
 * - Uses checkingRef to prevent concurrent fetchRole calls
 */
import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { useAuthStore } from "../stores/auth-store";
import { refreshSessionOnce } from "../lib/session-refresh";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setAuth, setRole, setLoading, clear } = useAuthStore();
  const checkingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // Bootstrap: get the stored session and verify the role
    async function bootstrap() {
      try {
        const { data: existing, error: getErr } =
          await supabase.auth.getSession();

        if (cancelled) return;

        if (getErr || !existing?.session) {
          console.log("[AuthProvider] No stored session — user is signed out");
          setAuth(null, null, false);
          setRole(null, null, false);
          return;
        }

        const session = existing.session;
        // Don't flip isLoading to true if we already have a session, 
        // just update the auth state.
        setAuth(session.user, session);

        await checkRole(session.access_token);
      } catch (err: any) {
        console.warn("[AuthProvider] Bootstrap error:", err?.message || err);
        if (!cancelled) {
          setAuth(null, null, false);
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
        // Only show loading if we aren't already authenticated (e.g. initial sign in)
        // Background refreshes shouldn't trigger a full-page loader.
        const store = useAuthStore.getState();
        if (!store.isAuthenticated) {
          setLoading(true);
        }

        setAuth(session.user, session);

        // Skip role re-check if user is mid-onboarding.
        // After Step 1, the server creates a business/staff record which makes
        // /auth/role return hasOnboarded=true. Any re-check (triggered by
        // TOKEN_REFRESHED, SIGNED_IN on tab focus, etc.) would cause
        // OnboardingGuard to redirect to /admin before finishing all 6 steps.
        const isOnboarding = window.location.pathname.startsWith("/onboarding");
        if (isOnboarding) {
          return;
        }

        await checkRole(session.access_token);
      } else {
        setAuth(null, null, false);
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
      // validation error (e.g. token just rotated but gateway hasn't
      // propagated it yet, or the stored token was slightly stale).
      for (let attempt = 0; attempt < 2; attempt++) {
        let tokenToUse = accessToken;

        // On retry, use the single-flight refresh helper to get a
        // fresh token without causing lock contention.
        if (attempt > 0) {
          console.log("[AuthProvider] checkRole retry — refreshing session");
          await new Promise((r) => setTimeout(r, 300)); // brief delay
          const refreshedSession = await refreshSessionOnce();
          if (refreshedSession?.access_token) {
            tokenToUse = refreshedSession.access_token;
            setAuth(refreshedSession.user, refreshedSession);
          } else {
            break; // refresh failed, no point retrying
          }
        }

        const { data, error } = await api<{
          role: string | null;
          businessId?: string;
          hasOnboarded: boolean;
          record: any;
        }>("/auth/role", { accessToken: tokenToUse, _isRetry: attempt > 0 });

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
        console.warn(
          `[AuthProvider] checkRole attempt ${attempt + 1} failed:`,
          error
        );
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

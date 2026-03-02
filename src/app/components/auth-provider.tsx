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
        const { data: refreshData, error: refreshError } =
          await supabase.auth.refreshSession();

        if (cancelled) return;

        if (refreshError || !refreshData?.session?.access_token) {
          // No valid session at all — user is logged out
          console.log("[AuthProvider] No valid session after refresh");
          setAuth(null, null);
          setRole(null, null, false);
          return;
        }

        const session = refreshData.session;
        setAuth(session.user, session);
        await checkRole(session.access_token);
      } catch (err) {
        console.warn("[AuthProvider] Bootstrap error:", err);
        if (!cancelled) {
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
      const { data, error } = await api<{
        role: string | null;
        businessId?: string;
        hasOnboarded: boolean;
        record: any;
      }>("/auth/role", { accessToken });

      if (error || !data) {
        console.warn("[AuthProvider] checkRole failed:", error);
        setRole(null, null, false);
        return false;
      }

      setRole(
        (data.role as any) ?? null,
        data.businessId ?? null,
        data.hasOnboarded,
        data.record
      );
      return true;
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
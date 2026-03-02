/**
 * AuthProvider - Listens to Supabase auth state changes,
 * syncs with Zustand auth store, and detects user role.
 */
import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { useAuthStore } from "../stores/auth-store";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setAuth, setRole, setLoading, clear } = useAuthStore();

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.access_token) {
        // Validate the token is still usable before trusting it
        const roleOk = await checkRole(session.access_token);
        if (roleOk) {
          setAuth(session.user, session);
        } else {
          // Token might be expired — try refreshing
          const { data: refreshData } = await supabase.auth.refreshSession();
          if (refreshData?.session?.access_token) {
            setAuth(refreshData.session.user, refreshData.session);
            await checkRole(refreshData.session.access_token);
          } else {
            // Stale session, clear everything
            await supabase.auth.signOut();
            clear();
          }
        }
      } else {
        setAuth(null, null);
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setAuth(session?.user ?? null, session);
      if (session?.access_token) {
        await checkRole(session.access_token);
      } else {
        setRole(null, null, false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [setAuth, setRole, setLoading, clear]);

  /** Returns true if the role check succeeded, false otherwise */
  async function checkRole(accessToken: string): Promise<boolean> {
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
    }
  }

  return <>{children}</>;
}
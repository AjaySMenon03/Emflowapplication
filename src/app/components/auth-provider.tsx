/**
 * AuthProvider - Listens to Supabase auth state changes,
 * syncs with Zustand auth store, and detects user role.
 */
import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { useAuthStore } from "../stores/auth-store";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setAuth, setRole, setLoading } = useAuthStore();

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setAuth(session?.user ?? null, session);
      if (session?.access_token) {
        await checkRole(session.access_token);
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
  }, [setAuth, setRole, setLoading]);

  async function checkRole(accessToken: string) {
    try {
      const { data, error } = await api<{
        role: string | null;
        businessId?: string;
        hasOnboarded: boolean;
        record: any;
      }>("/auth/role", { accessToken });

      if (error || !data) {
        setRole(null, null, false);
        return;
      }

      setRole(
        (data.role as any) ?? null,
        data.businessId ?? null,
        data.hasOnboarded,
        data.record
      );
    } catch {
      setRole(null, null, false);
    }
  }

  return <>{children}</>;
}

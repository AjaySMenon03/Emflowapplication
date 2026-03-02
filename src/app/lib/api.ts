/**
 * API Helper - Typed fetch wrapper for server calls.
 *
 * Features:
 * - Automatic 401 retry: refreshes the Supabase session once and retries.
 * - Updates the Zustand auth store with the refreshed session.
 */
import { API_BASE, supabase } from "./supabase";
import { publicAnonKey } from "/utils/supabase/info";
import { useAuthStore } from "../stores/auth-store";

interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  accessToken?: string;
  /** Internal flag — prevents infinite retry loops */
  _isRetry?: boolean;
}

export async function api<T = unknown>(
  path: string,
  options: ApiOptions = {}
): Promise<{ data: T | null; error: string | null }> {
  const { method = "GET", body, accessToken, _isRetry = false } = options;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken ?? publicAnonKey}`,
    };

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // ── 401 auto-retry: refresh session and retry once ──
    if (res.status === 401 && !_isRetry && accessToken) {
      console.log(`[API ${method} ${path}] 401 — attempting session refresh & retry`);
      try {
        const { data: refreshData } = await supabase.auth.refreshSession();
        const newToken = refreshData?.session?.access_token;

        if (newToken && newToken !== accessToken) {
          // Update Zustand store with refreshed session
          const store = useAuthStore.getState();
          if (refreshData.session) {
            store.setAuth(refreshData.session.user, refreshData.session);
          }

          // Retry with the new token
          return api<T>(path, {
            method,
            body,
            accessToken: newToken,
            _isRetry: true,
          });
        }
      } catch (refreshErr) {
        console.warn(`[API ${method} ${path}] Session refresh failed:`, refreshErr);
      }
    }

    const json = await res.json();

    if (!res.ok) {
      const errMsg = json?.error || json?.message || `Request failed with status ${res.status}`;
      console.error(`[API ${method} ${path}] Error:`, errMsg);
      return { data: null, error: errMsg };
    }

    return { data: json as T, error: null };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Network error";
    console.error(`[API ${method} ${path}] Network error:`, errMsg);
    return { data: null, error: errMsg };
  }
}

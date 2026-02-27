/**
 * API Helper - Typed fetch wrapper for server calls.
 */
import { API_BASE } from "./supabase";
import { publicAnonKey } from "/utils/supabase/info";

interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  accessToken?: string;
}

export async function api<T = unknown>(
  path: string,
  options: ApiOptions = {}
): Promise<{ data: T | null; error: string | null }> {
  const { method = "GET", body, accessToken } = options;

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

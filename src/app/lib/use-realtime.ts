/**
 * useRealtime — Lightweight polling-based realtime hook.
 *
 * Polls the server for changes to a location's queue entries.
 * When a change is detected, fires the onChange callback.
 * Cleans up on unmount.
 *
 * Usage:
 *   useRealtime(locationId, (event) => { refetchEntries(); });
 */
import { useEffect, useRef, useCallback } from "react";
import { API_BASE } from "./supabase";
import { publicAnonKey } from "/utils/supabase/info";

interface RealtimeEvent {
  type: string;
  entry: any;
  timestamp: string;
  business_id: string;
  location_id: string;
}

interface PollResponse {
  hasChanges: boolean;
  counter: number;
  event?: RealtimeEvent;
}

export function useRealtime(
  locationId: string | null | undefined,
  onChange: (event: RealtimeEvent | null) => void,
  intervalMs = 3000
) {
  const counterRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const poll = useCallback(async () => {
    if (!locationId) return;

    try {
      const res = await fetch(
        `${API_BASE}/realtime/poll/${locationId}?since=${counterRef.current}`,
        {
          headers: { Authorization: `Bearer ${publicAnonKey}` },
        }
      );
      if (!res.ok) return;

      const data: PollResponse = await res.json();
      if (data.hasChanges) {
        counterRef.current = data.counter;
        onChangeRef.current(data.event || null);
      }
    } catch {
      // Silently ignore polling errors
    }
  }, [locationId]);

  useEffect(() => {
    if (!locationId) return;

    // Initial poll
    poll();

    const timer = setInterval(poll, intervalMs);
    return () => clearInterval(timer);
  }, [locationId, intervalMs, poll]);
}

/**
 * useRealtimePublic — Same as useRealtime but designed
 * for unauthenticated customer pages. Identical implementation,
 * exposed separately for clarity.
 */
export const useRealtimePublic = useRealtime;

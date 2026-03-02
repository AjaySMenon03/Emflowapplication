/**
 * useRealtime — Hybrid realtime hook.
 *
 * Primary: Supabase Realtime Broadcast channel (instant, ~50ms latency)
 * Fallback: HTTP polling at reduced interval (15s) for resilience
 *
 * When the Supabase channel connects, the polling interval increases
 * dramatically since the broadcast delivers events instantly. If the
 * channel disconnects, polling resumes at a fast rate.
 *
 * Usage:
 *   const { connectionState } = useRealtime(locationId, (event) => {
 *     refetchEntries();
 *   });
 */
import { useEffect, useRef, useCallback, useState } from "react";
import { supabase } from "./supabase";
import { API_BASE } from "./supabase";
import { publicAnonKey } from "/utils/supabase/info";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface RealtimeEvent {
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

export type ConnectionState = "connecting" | "connected" | "disconnected" | "polling";

const POLL_INTERVAL_FAST = 3000; // When no broadcast available
const POLL_INTERVAL_SLOW = 15000; // When broadcast is connected (safety net)

export function useRealtime(
  locationId: string | null | undefined,
  onChange: (event: RealtimeEvent | null) => void,
  intervalMs?: number
) {
  const counterRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const broadcastConnectedRef = useRef(false);

  // ── Polling (fallback / safety net) ──
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

  // ── Supabase Realtime Broadcast subscription ──
  useEffect(() => {
    if (!locationId) {
      setConnectionState("disconnected");
      return;
    }

    setConnectionState("connecting");

    const channelName = `queue-events:${locationId}`;
    const channel = supabase.channel(channelName);

    channel
      .on("broadcast", { event: "queue_change" }, (payload) => {
        const event = payload.payload as RealtimeEvent;
        if (event) {
          onChangeRef.current(event);
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          broadcastConnectedRef.current = true;
          setConnectionState("connected");
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
          broadcastConnectedRef.current = false;
          setConnectionState("polling");
        }
      });

    channelRef.current = channel;

    return () => {
      broadcastConnectedRef.current = false;
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [locationId]);

  // ── Polling timer (adaptive interval) ──
  useEffect(() => {
    if (!locationId) return;

    // Initial poll to sync counter
    poll();

    const effectiveInterval = intervalMs
      ? intervalMs
      : broadcastConnectedRef.current
        ? POLL_INTERVAL_SLOW
        : POLL_INTERVAL_FAST;

    const timer = setInterval(() => {
      const interval = broadcastConnectedRef.current
        ? POLL_INTERVAL_SLOW
        : POLL_INTERVAL_FAST;
      poll();
    }, effectiveInterval);

    return () => clearInterval(timer);
  }, [locationId, poll, intervalMs, connectionState]);

  return { connectionState };
}

/**
 * useRealtimePublic — Same as useRealtime but designed
 * for unauthenticated customer pages. Identical implementation,
 * exposed separately for clarity.
 */
export const useRealtimePublic = useRealtime;

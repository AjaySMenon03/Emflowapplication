/**
 * useNetworkStatus — Offline resilience hook.
 *
 * Features:
 *   - Detects online/offline via navigator.onLine + event listeners
 *   - Periodic health-check ping to verify real connectivity (not just LAN)
 *   - Tracks reconnect transition for animation
 *   - lastSyncedAt timestamp for "last synced X ago" indicator
 *   - localStorage cache for last-known queue state
 *   - Triggers auto-refresh callback on reconnect
 *
 * Usage:
 *   const { isOnline, isReconnecting, lastSyncedAt, markSynced } = useNetworkStatus({
 *     onReconnect: () => refetch(),
 *     healthCheckUrl: '/health',
 *     healthCheckIntervalMs: 30000,
 *   });
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE } from "./supabase";

const RECONNECT_ANIMATION_MS = 2500;
const DEFAULT_HEALTH_CHECK_INTERVAL = 30_000; // 30 seconds

interface UseNetworkStatusOptions {
  /** Called when the browser transitions from offline → online */
  onReconnect?: () => void;
  /** Server path for health-check ping (default: /health) */
  healthCheckUrl?: string;
  /** How often to ping in ms (default: 30 000). Set 0 to disable. */
  healthCheckIntervalMs?: number;
}

interface NetworkStatus {
  isOnline: boolean;
  /** True for ~2.5 s after reconnecting (for animation) */
  isReconnecting: boolean;
  /** True if the user was offline at any point during this session */
  wasOffline: boolean;
  /** Epoch ms of the last successful data sync (set via markSynced) */
  lastSyncedAt: number | null;
  /** Call after a successful fetch to update the lastSyncedAt timestamp */
  markSynced: () => void;
}

export function useNetworkStatus(
  options: UseNetworkStatusOptions = {}
): NetworkStatus {
  const {
    onReconnect,
    healthCheckUrl = "/health",
    healthCheckIntervalMs = DEFAULT_HEALTH_CHECK_INTERVAL,
  } = options;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasOnlineRef = useRef(isOnline);

  // ── Mark data as freshly synced ──
  const markSynced = useCallback(() => {
    setLastSyncedAt(Date.now());
  }, []);

  // ── Core online/offline transitions ──
  const goOnline = useCallback(() => {
    if (!wasOnlineRef.current) {
      // Transition from offline → online
      setIsOnline(true);
      wasOnlineRef.current = true;
      setIsReconnecting(true);

      onReconnectRef.current?.();

      reconnectTimerRef.current = setTimeout(() => {
        setIsReconnecting(false);
      }, RECONNECT_ANIMATION_MS);
    }
  }, []);

  const goOffline = useCallback(() => {
    if (wasOnlineRef.current) {
      setIsOnline(false);
      wasOnlineRef.current = false;
      setWasOffline(true);
    }
  }, []);

  // ── Browser online/offline events ──
  useEffect(() => {
    const handleOnline = () => goOnline();
    const handleOffline = () => goOffline();

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [goOnline, goOffline]);

  // ── Periodic health-check ping ──
  // navigator.onLine can be unreliable (reports true when behind a captive portal,
  // or when the device has LAN but no internet). This ping verifies real connectivity
  // by hitting our server's /health endpoint.
  useEffect(() => {
    if (!healthCheckIntervalMs || healthCheckIntervalMs <= 0) return;

    const ping = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(`${API_BASE}${healthCheckUrl}`, {
          method: "HEAD",
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.ok) {
          goOnline();
        } else {
          goOffline();
        }
      } catch {
        // Network error or abort → offline
        goOffline();
      }
    };

    const id = setInterval(ping, healthCheckIntervalMs);
    // Run an immediate check on mount
    ping();

    return () => clearInterval(id);
  }, [healthCheckIntervalMs, healthCheckUrl, goOnline, goOffline]);

  return { isOnline, isReconnecting, wasOffline, lastSyncedAt, markSynced };
}

// ══════════════════════════════════════════════
// Cache helpers — localStorage-based
// ══════════════════════════════════════════════

const CACHE_PREFIX = "em-flow-cache:";

/** Save data to localStorage with a cache key */
export function cacheSet<T>(key: string, data: T): void {
  try {
    localStorage.setItem(
      `${CACHE_PREFIX}${key}`,
      JSON.stringify({ data, ts: Date.now() })
    );
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

/** Retrieve cached data from localStorage */
export function cacheGet<T>(key: string): { data: T; ts: number } | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Remove a cache entry */
export function cacheClear(key: string): void {
  try {
    localStorage.removeItem(`${CACHE_PREFIX}${key}`);
  } catch {
    // Ignore
  }
}

// ══════════════════════════════════════════════
// Time-ago formatter
// ══════════════════════════════════════════════

/**
 * Returns a human-readable relative time string like "just now", "2m ago", "1h ago".
 * Updates every call — use with an interval for live display.
 */
export function formatTimeAgo(epochMs: number | null): string {
  if (!epochMs) return "";
  const diff = Math.max(0, Date.now() - epochMs);
  const seconds = Math.floor(diff / 1000);

  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

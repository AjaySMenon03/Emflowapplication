/**
 * Offline Mutation Queue
 *
 * When the user performs a queue action while offline (call next, mark served,
 * etc.), the request is stored in localStorage. On reconnect, all queued
 * mutations are replayed in FIFO order.
 *
 * API:
 *   enqueue(path, options)  — store a pending mutation
 *   replay(accessToken)     — replay all pending mutations (returns results)
 *   getPending()            — retrieve pending items (for UI badge)
 *   clearAll()              — discard all pending mutations
 */
import { api } from "./api";

const STORAGE_KEY = "em-flow-offline-queue";

export interface QueuedMutation {
  id: string;
  path: string;
  method: "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** ISO timestamp when the action was queued */
  queuedAt: string;
  /** Human-readable label for toast/UI ("Call Next", "Mark Served", etc.) */
  label: string;
}

interface ReplayResult {
  total: number;
  succeeded: number;
  failed: number;
  errors: Array<{ label: string; error: string }>;
}

// ── Helpers ──

function load(): QueuedMutation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(items: QueuedMutation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage full — drop oldest items and try again
    try {
      const trimmed = items.slice(Math.max(0, items.length - 20));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // Silently ignore
    }
  }
}

// ── Public API ──

/** Add a mutation to the offline queue */
export function enqueue(
  path: string,
  options: {
    method: "POST" | "PUT" | "DELETE";
    body?: unknown;
    label: string;
  }
): void {
  const items = load();
  items.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    path: options.method === "POST" ? path : path,
    method: options.method,
    body: options.body,
    queuedAt: new Date().toISOString(),
    label: options.label,
  });
  save(items);
}

/** Get all pending mutations (for UI display) */
export function getPending(): QueuedMutation[] {
  return load();
}

/** Get the count of pending mutations */
export function getPendingCount(): number {
  return load().length;
}

/**
 * Replay all queued mutations sequentially (FIFO).
 * Successfully replayed items are removed; failed items are kept for retry.
 */
export async function replay(accessToken: string): Promise<ReplayResult> {
  const items = load();
  if (!items.length) {
    return { total: 0, succeeded: 0, failed: 0, errors: [] };
  }

  const result: ReplayResult = {
    total: items.length,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  const remaining: QueuedMutation[] = [];

  for (const item of items) {
    try {
      const { error } = await api(item.path, {
        method: item.method,
        body: item.body,
        accessToken,
      });

      if (error) {
        // Server returned an error — keep for now but record
        result.failed++;
        result.errors.push({ label: item.label, error });
        remaining.push(item);
      } else {
        result.succeeded++;
      }
    } catch (err) {
      // Network still down or unexpected error — keep item
      result.failed++;
      result.errors.push({
        label: item.label,
        error: err instanceof Error ? err.message : "Unknown error",
      });
      remaining.push(item);
    }
  }

  save(remaining);
  return result;
}

/** Discard all pending mutations */
export function clearAll(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}

/**
 * EM Flow — Distributed Lock (KV-based mutex)
 */

import * as kv from "../kv_store.tsx";
import { uuid, sleep } from "./helpers.ts";
import type { LockRecord } from "./types.ts";

const LOCK_TTL_MS = 15_000; // stale after 15 s
const LOCK_RETRY_INTERVAL_MS = 50;
const LOCK_MAX_WAIT_MS = 8_000;

/**
 * Acquire a lock for a given key.
 * Uses check-set-verify pattern to minimise race windows.
 * Returns lockId on success, null on timeout.
 */
export async function acquireLock(lockKey: string): Promise<string | null> {
    const lockId = uuid();
    const deadline = Date.now() + LOCK_MAX_WAIT_MS;

    while (Date.now() < deadline) {
        const existing: LockRecord | null = await kv.get(lockKey);

        if (existing && Date.now() - existing.acquired_at < LOCK_TTL_MS) {
            // Lock is held and still valid — wait and retry
            await sleep(LOCK_RETRY_INTERVAL_MS);
            continue;
        }

        // Either no lock or stale lock — attempt to acquire
        const record: LockRecord = { id: lockId, acquired_at: Date.now() };
        await kv.set(lockKey, record);

        // Verify we won the race
        await sleep(10); // small delay to let concurrent writers flush
        const verify: LockRecord | null = await kv.get(lockKey);
        if (verify?.id === lockId) {
            return lockId;
        }

        // Lost the race — retry
        await sleep(LOCK_RETRY_INTERVAL_MS);
    }

    return null; // timed out
}

export async function releaseLock(lockKey: string, lockId: string): Promise<void> {
    try {
        const current: LockRecord | null = await kv.get(lockKey);
        if (current?.id === lockId) {
            await kv.del(lockKey);
        }
    } catch {
        // Best-effort release; TTL will clean up
    }
}

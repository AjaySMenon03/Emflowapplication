/**
 * EM Flow — Transaction Batch (atomic multi-key write)
 */

import * as kv from "../kv_store.tsx";
import { acquireLock, releaseLock } from "./lock.ts";

export class TransactionBatch {
    private writes = new Map<string, unknown>();
    private deletes: string[] = [];

    set(key: string, value: unknown): void {
        this.writes.set(key, value);
    }

    del(key: string): void {
        this.deletes.push(key);
        this.writes.delete(key); // avoid writing something we're deleting
    }

    get pendingCount(): number {
        return this.writes.size + this.deletes.length;
    }

    /** Flush all pending writes/deletes in minimal round-trips */
    async commit(): Promise<void> {
        if (this.writes.size > 0) {
            const keys = [...this.writes.keys()];
            const values = [...this.writes.values()];
            await kv.mset(keys, values);
        }
        if (this.deletes.length > 0) {
            await kv.mdel(this.deletes);
        }
    }
}

/**
 * Execute `fn` inside a lock, with a TransactionBatch that is
 * committed only on success. On error the batch is discarded (rollback).
 */
export async function withTransaction<T>(
    lockKey: string,
    fn: (batch: TransactionBatch) => Promise<T>
): Promise<T> {
    const lockId = await acquireLock(lockKey);
    if (!lockId) {
        throw new Error(
            "Queue operation in progress — please try again in a moment (lock timeout)"
        );
    }

    const batch = new TransactionBatch();
    try {
        const result = await fn(batch);
        // Success — commit all writes atomically
        await batch.commit();
        return result;
    } catch (err) {
        // Failure — batch is never committed (automatic rollback)
        throw err;
    } finally {
        await releaseLock(lockKey, lockId);
    }
}

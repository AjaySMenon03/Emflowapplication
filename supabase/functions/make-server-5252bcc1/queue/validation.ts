/**
 * EM Flow — Validation Helpers
 */

import * as kv from "../kv_store.tsx";
import type { QueueSession } from "./types.ts";

export async function validateSessionActive(sessionId: string): Promise<QueueSession> {
    const session = await kv.get(`queue_session:${sessionId}`);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status === "closed" || session.status === "archived") {
        throw new Error(
            `Queue session for ${session.session_date} is ${session.status}. Please start a new session.`
        );
    }
    // Accept both legacy "active" and new "open" as valid statuses
    return session;
}

export async function validateStaffForQueueType(
    staffAuthUid: string,
    queueTypeId: string
): Promise<void> {
    const staffRecord = await kv.get(`staff_user:${staffAuthUid}`);
    if (!staffRecord) {
        throw new Error("Staff record not found — you may not have access");
    }

    const queueType = await kv.get(`queue_type:${queueTypeId}`);
    if (!queueType) {
        throw new Error(`Queue type ${queueTypeId} not found`);
    }

    // Owner/admin bypass location check
    if (staffRecord.role === "owner" || staffRecord.role === "admin") return;

    // Staff must have the queue type's location in their locations array
    if (
        staffRecord.locations &&
        staffRecord.locations.length > 0 &&
        queueType.location_id &&
        !staffRecord.locations.includes(queueType.location_id)
    ) {
        throw new Error(
            `You do not have access to the queue "${queueType.name}" at this location`
        );
    }
}

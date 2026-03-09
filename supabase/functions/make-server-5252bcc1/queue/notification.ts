/**
 * EM Flow — Notification Logging
 */

import * as kv from "../kv_store.tsx";
import { uuid, now } from "./helpers.ts";

export async function logNotification(params: {
    entryId: string;
    customerId: string | null;
    businessId: string;
    channel: string;
    recipient: string;
    message: string;
}): Promise<void> {
    const id = uuid();
    await kv.set(`notification_log:${id}`, {
        id,
        queue_entry_id: params.entryId,
        customer_id: params.customerId,
        business_id: params.businessId,
        channel: params.channel,
        recipient: params.recipient,
        message: params.message,
        status: "sent",
        sent_at: now(),
        created_at: now(),
    });
}

/**
 * Quecumber — Broadcast Helper
 */

import * as kv from "../kv_store.tsx";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import { now } from "./helpers.ts";
import type { QueueEntry } from "./types.ts";

export async function broadcastChange(
  businessId: string,
  locationId: string,
  eventType: string,
  entry: QueueEntry,
): Promise<void> {
  const event = {
    type: eventType,
    entry,
    timestamp: now(),
    business_id: businessId,
    location_id: locationId,
  };

  await kv.set(`realtime_event:${locationId}`, event);
  const counter = (await kv.get(`realtime_counter:${locationId}`)) || 0;
  await kv.set(`realtime_counter:${locationId}`, counter + 1);

  // Supabase Realtime Broadcast (instant delivery, non-critical)
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    );
    const channelName = `queue-events:${locationId}`;
    const channel = supabase.channel(channelName);
    await channel.send({
      type: "broadcast",
      event: "queue_change",
      payload: event,
    });
    await supabase.removeChannel(channel);
  } catch (err: any) {
    console.log(`[Realtime broadcast] Warning: ${err.message || err}`);
  }
}

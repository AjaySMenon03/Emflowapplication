/**
 * Quecumber — Realtime Polling Route
 */
import type { Hono } from "npm:hono";
import * as kv from "../kv_store.tsx";

export function register(app: Hono) {
  app.get("/realtime/poll/:locationId", async (c: any) => {
    try {
      const locationId = c.req.param("locationId");
      const sinceParam = c.req.query("since");
      const since = sinceParam ? parseInt(sinceParam, 10) : 0;
      const currentCounter =
        (await kv.get(`realtime_counter:${locationId}`)) || 0;
      if (currentCounter > since) {
        const latestEvent = await kv.get(`realtime_event:${locationId}`);
        return c.json({
          hasChanges: true,
          counter: currentCounter,
          event: latestEvent,
        });
      }
      return c.json({ hasChanges: false, counter: currentCounter });
    } catch (err: any) {
      return c.json({ error: `Polling failed: ${err.message}` }, 500);
    }
  });
}

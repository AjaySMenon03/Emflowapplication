/**
 * Realtime Polling Controller
 */
import * as kv from "../models/kv-store.js";

// GET /api/realtime/poll/:locationId
export async function poll(req, res) {
    try {
        const locationId = req.params.locationId;
        const sinceParam = req.query.since;
        const since = sinceParam ? parseInt(sinceParam, 10) : 0;

        const currentCounter =
            (await kv.get(`realtime_counter:${locationId}`)) || 0;

        if (currentCounter > since) {
            const latestEvent = await kv.get(`realtime_event:${locationId}`);
            return res.json({
                hasChanges: true,
                counter: currentCounter,
                event: latestEvent,
            });
        }

        return res.json({ hasChanges: false, counter: currentCounter });
    } catch (err) {
        return res.status(500).json({ error: `Polling failed: ${err.message}` });
    }
}

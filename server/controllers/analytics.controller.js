/**
 * Analytics Controller
 */
import { getAuthUser } from "../middleware/auth.js";
import * as kv from "../models/kv-store.js";
import * as queueLogic from "../services/queue.service.js";

// GET /api/analytics/:locationId
export async function getAnalytics(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });

        const locationId = req.params.locationId;
        const entries = await queueLogic.getLocationEntries(locationId);

        const served = entries.filter((e) => e.status === "served");
        const noShows = entries.filter((e) => e.status === "no_show");
        const cancelled = entries.filter((e) => e.status === "cancelled");
        const waiting = entries.filter((e) => e.status === "waiting");
        const serving = entries.filter((e) => e.status === "serving");
        const total = entries.length;

        // Avg wait time
        let avgWaitMinutes = 0;
        const withWait = served.filter((e) => e.joined_at && e.called_at);
        if (withWait.length > 0) {
            const totalWait = withWait.reduce((acc, e) =>
                acc + (new Date(e.called_at).getTime() - new Date(e.joined_at).getTime()) / 60000, 0);
            avgWaitMinutes = Math.round((totalWait / withWait.length) * 10) / 10;
        }

        // Avg service time
        let avgServiceMinutes = 0;
        const withService = served.filter((e) => e.called_at && e.completed_at);
        if (withService.length > 0) {
            const totalService = withService.reduce((acc, e) =>
                acc + (new Date(e.completed_at).getTime() - new Date(e.called_at).getTime()) / 60000, 0);
            avgServiceMinutes = Math.round((totalService / withService.length) * 10) / 10;
        }

        // No-show rate
        const totalProcessed = served.length + noShows.length + cancelled.length;
        const noShowRate = totalProcessed > 0
            ? Math.round((noShows.length / totalProcessed) * 1000) / 10
            : 0;

        // Hourly distribution
        const hourlyData = [];
        for (let h = 0; h < 24; h++) hourlyData.push({ hour: h, served: 0, noShow: 0, joined: 0 });
        for (const e of entries) {
            const h = new Date(e.joined_at).getHours();
            if (hourlyData[h]) {
                hourlyData[h].joined++;
                if (e.status === "served") hourlyData[h].served++;
                if (e.status === "no_show") hourlyData[h].noShow++;
            }
        }

        // Peak hour
        let peakHour = 0, peakCount = 0;
        for (const h of hourlyData) {
            if (h.joined > peakCount) { peakCount = h.joined; peakHour = h.hour; }
        }

        // Staff performance
        const staffMap = {};
        for (const e of served) {
            if (!e.served_by) continue;
            if (!staffMap[e.served_by]) {
                const staff = await kv.get(`staff_user:${e.served_by}`);
                staffMap[e.served_by] = { name: staff?.name || "Unknown", served: 0, totalWait: 0, totalService: 0, count: 0 };
            }
            staffMap[e.served_by].served++;
            if (e.joined_at && e.called_at) {
                staffMap[e.served_by].totalWait += (new Date(e.called_at).getTime() - new Date(e.joined_at).getTime()) / 60000;
                staffMap[e.served_by].count++;
            }
            if (e.called_at && e.completed_at) {
                staffMap[e.served_by].totalService += (new Date(e.completed_at).getTime() - new Date(e.called_at).getTime()) / 60000;
            }
        }
        const staffPerformance = Object.entries(staffMap).map(([id, s]) => ({
            id, name: s.name, served: s.served,
            avgWait: s.count > 0 ? Math.round((s.totalWait / s.count) * 10) / 10 : 0,
            avgService: s.count > 0 ? Math.round((s.totalService / s.count) * 10) / 10 : 0,
        })).sort((a, b) => b.served - a.served);

        // Queue type breakdown
        const queueTypeMap = {};
        for (const e of entries) {
            const qtId = e.queue_type_id;
            if (!queueTypeMap[qtId]) {
                queueTypeMap[qtId] = { name: e.queue_type_name || "Unknown", prefix: e.queue_type_prefix || "?", served: 0, noShow: 0, cancelled: 0, waiting: 0 };
            }
            if (e.status === "served") queueTypeMap[qtId].served++;
            else if (e.status === "no_show") queueTypeMap[qtId].noShow++;
            else if (e.status === "cancelled") queueTypeMap[qtId].cancelled++;
            else if (e.status === "waiting") queueTypeMap[qtId].waiting++;
        }
        const queueBreakdown = Object.entries(queueTypeMap).map(([id, q]) => ({ id, ...q }));

        return res.json({
            summary: {
                servedCount: served.length, noShowCount: noShows.length, cancelledCount: cancelled.length,
                waitingCount: waiting.length, servingCount: serving.length, totalEntries: total,
                avgWaitMinutes, avgServiceMinutes, noShowRate, peakHour,
                peakHourFormatted: `${peakHour.toString().padStart(2, "0")}:00`,
            },
            hourlyData, staffPerformance, queueBreakdown,
        });
    } catch (err) {
        return res.status(500).json({ error: `Analytics fetch failed: ${err.message}` });
    }
}

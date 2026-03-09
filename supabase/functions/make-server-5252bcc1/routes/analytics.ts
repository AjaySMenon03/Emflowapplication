/**
 * EM Flow — Analytics Routes
 */
import type { Hono } from "npm:hono";
import * as kv from "../kv_store.tsx";
import * as queueLogic from "../queue/index.ts";
import { getAuthUser } from "../lib/helpers.ts";

export function register(app: Hono) {
    // Basic analytics
    app.get("/analytics/:locationId", async (c: any) => {
        try {
            const user = await getAuthUser(c);
            if (!user) return c.json({ error: "Unauthorized" }, 401);
            const locationId = c.req.param("locationId");
            const entries = await queueLogic.getLocationEntries(locationId);
            const served = entries.filter((e: any) => e.status === "served");
            const noShows = entries.filter((e: any) => e.status === "no_show");
            const cancelled = entries.filter((e: any) => e.status === "cancelled");
            const waiting = entries.filter((e: any) => e.status === "waiting");
            const serving = entries.filter((e: any) => e.status === "serving");
            const total = entries.length;
            let avgWaitMinutes = 0;
            const withWait = served.filter((e: any) => e.joined_at && e.called_at);
            if (withWait.length > 0) {
                const totalWait = withWait.reduce((acc: number, e: any) => acc + (new Date(e.called_at!).getTime() - new Date(e.joined_at).getTime()) / 60000, 0);
                avgWaitMinutes = Math.round((totalWait / withWait.length) * 10) / 10;
            }
            let avgServiceMinutes = 0;
            const withService = served.filter((e: any) => e.called_at && e.completed_at);
            if (withService.length > 0) {
                const totalService = withService.reduce((acc: number, e: any) => acc + (new Date(e.completed_at!).getTime() - new Date(e.called_at!).getTime()) / 60000, 0);
                avgServiceMinutes = Math.round((totalService / withService.length) * 10) / 10;
            }
            const totalProcessed = served.length + noShows.length + cancelled.length;
            const noShowRate = totalProcessed > 0 ? Math.round((noShows.length / totalProcessed) * 1000) / 10 : 0;
            const hourlyData: { hour: number; served: number; noShow: number; joined: number }[] = [];
            for (let h = 0; h < 24; h++) hourlyData.push({ hour: h, served: 0, noShow: 0, joined: 0 });
            for (const e of entries) {
                const h = new Date(e.joined_at).getHours();
                if (hourlyData[h]) { hourlyData[h].joined++; if (e.status === "served") hourlyData[h].served++; if (e.status === "no_show") hourlyData[h].noShow++; }
            }
            let peakHour = 0; let peakCount = 0;
            for (const h of hourlyData) { if (h.joined > peakCount) { peakCount = h.joined; peakHour = h.hour; } }
            const staffMap: Record<string, { name: string; served: number; totalWait: number; totalService: number; count: number }> = {};
            for (const e of served) {
                if (!e.served_by) continue;
                if (!staffMap[e.served_by]) { const staff = await kv.get(`staff_user:${e.served_by}`); staffMap[e.served_by] = { name: staff?.name || "Unknown", served: 0, totalWait: 0, totalService: 0, count: 0 }; }
                staffMap[e.served_by].served++;
                if (e.joined_at && e.called_at) { staffMap[e.served_by].totalWait += (new Date(e.called_at).getTime() - new Date(e.joined_at).getTime()) / 60000; staffMap[e.served_by].count++; }
                if (e.called_at && e.completed_at) { staffMap[e.served_by].totalService += (new Date(e.completed_at).getTime() - new Date(e.called_at).getTime()) / 60000; }
            }
            const staffPerformance = Object.entries(staffMap).map(([id, s]) => ({ id, name: s.name, served: s.served, avgWait: s.count > 0 ? Math.round((s.totalWait / s.count) * 10) / 10 : 0, avgService: s.count > 0 ? Math.round((s.totalService / s.count) * 10) / 10 : 0 })).sort((a, b) => b.served - a.served);
            const queueTypeMap: Record<string, { name: string; prefix: string; served: number; noShow: number; cancelled: number; waiting: number }> = {};
            for (const e of entries) {
                const qtId = e.queue_type_id;
                if (!queueTypeMap[qtId]) queueTypeMap[qtId] = { name: e.queue_type_name || "Unknown", prefix: e.queue_type_prefix || "?", served: 0, noShow: 0, cancelled: 0, waiting: 0 };
                if (e.status === "served") queueTypeMap[qtId].served++;
                else if (e.status === "no_show") queueTypeMap[qtId].noShow++;
                else if (e.status === "cancelled") queueTypeMap[qtId].cancelled++;
                else if (e.status === "waiting") queueTypeMap[qtId].waiting++;
            }
            const queueBreakdown = Object.entries(queueTypeMap).map(([id, q]) => ({ id, ...q }));
            return c.json({
                summary: { servedCount: served.length, noShowCount: noShows.length, cancelledCount: cancelled.length, waitingCount: waiting.length, servingCount: serving.length, totalEntries: total, avgWaitMinutes, avgServiceMinutes, noShowRate, peakHour, peakHourFormatted: `${peakHour.toString().padStart(2, "0")}:00` },
                hourlyData, staffPerformance, queueBreakdown,
            });
        } catch (err: any) {
            return c.json({ error: `Analytics fetch failed: ${err.message}` }, 500);
        }
    });

    // Advanced analytics
    app.get("/analytics/advanced/:locationId", async (c: any) => {
        try {
            const user = await getAuthUser(c);
            if (!user) return c.json({ error: "Unauthorized" }, 401);
            const staffRecord = await kv.get(`staff_user:${user.id}`);
            if (!staffRecord) return c.json({ error: "Staff record not found" }, 403);
            if (staffRecord.role !== "owner" && staffRecord.role !== "admin") return c.json({ error: "Only owners and admins can access advanced analytics" }, 403);
            const locationId = c.req.param("locationId");
            const range = c.req.query("range") || "today";
            const customFrom = c.req.query("from");
            const customTo = c.req.query("to");
            const nowMs = Date.now();
            let fromMs: number; let toMs: number = nowMs; let prevFromMs: number; let prevToMs: number;
            if (range === "7d") { fromMs = nowMs - 7 * 86400000; prevFromMs = fromMs - 7 * 86400000; prevToMs = fromMs; }
            else if (range === "30d") { fromMs = nowMs - 30 * 86400000; prevFromMs = fromMs - 30 * 86400000; prevToMs = fromMs; }
            else if (range === "custom" && customFrom && customTo) { fromMs = new Date(customFrom).getTime(); toMs = new Date(customTo).getTime() + 86400000; const span = toMs - fromMs; prevFromMs = fromMs - span; prevToMs = fromMs; }
            else { const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0); fromMs = todayStart.getTime(); prevFromMs = fromMs - 86400000; prevToMs = fromMs; }
            const allEntries = await queueLogic.getLocationEntries(locationId);
            const entries = allEntries.filter((e: any) => { const t = new Date(e.joined_at).getTime(); return t >= fromMs && t <= toMs; });
            const prevEntries = allEntries.filter((e: any) => { const t = new Date(e.joined_at).getTime(); return t >= prevFromMs && t < prevToMs; });
            function computeMetrics(entrySet: any[]) {
                const served = entrySet.filter((e: any) => e.status === "served");
                const noShows = entrySet.filter((e: any) => e.status === "no_show");
                const cancelled = entrySet.filter((e: any) => e.status === "cancelled");
                const waiting = entrySet.filter((e: any) => e.status === "waiting");
                const serving = entrySet.filter((e: any) => e.status === "serving");
                let avgWaitMinutes = 0;
                const withWait = served.filter((e: any) => e.joined_at && e.called_at);
                if (withWait.length > 0) { const totalWait = withWait.reduce((acc: number, e: any) => acc + (new Date(e.called_at).getTime() - new Date(e.joined_at).getTime()) / 60000, 0); avgWaitMinutes = Math.round((totalWait / withWait.length) * 10) / 10; }
                let avgServiceMinutes = 0;
                const withService = served.filter((e: any) => e.called_at && e.completed_at);
                if (withService.length > 0) { const totalService = withService.reduce((acc: number, e: any) => acc + (new Date(e.completed_at).getTime() - new Date(e.called_at).getTime()) / 60000, 0); avgServiceMinutes = Math.round((totalService / withService.length) * 10) / 10; }
                const totalProcessed = served.length + noShows.length + cancelled.length;
                const noShowRate = totalProcessed > 0 ? Math.round((noShows.length / totalProcessed) * 1000) / 10 : 0;
                const hourCounts: number[] = new Array(24).fill(0);
                for (const e of entrySet) { const h = new Date(e.joined_at).getHours(); hourCounts[h]++; }
                let peakHour = 0; let peakCount = 0;
                for (let h = 0; h < 24; h++) { if (hourCounts[h] > peakCount) { peakCount = hourCounts[h]; peakHour = h; } }
                return { servedCount: served.length, noShowCount: noShows.length, cancelledCount: cancelled.length, waitingCount: waiting.length, servingCount: serving.length, totalEntries: entrySet.length, avgWaitMinutes, avgServiceMinutes, noShowRate, peakHour, peakHourFormatted: `${peakHour.toString().padStart(2, "0")}:00` };
            }
            const currentMetrics = computeMetrics(entries);
            const prevMetrics = computeMetrics(prevEntries);
            function pctChange(curr: number, prev: number): number { if (prev === 0 && curr === 0) return 0; if (prev === 0) return curr > 0 ? 100 : 0; return Math.round(((curr - prev) / prev) * 1000) / 10; }
            const kpiChanges = { servedChange: pctChange(currentMetrics.servedCount, prevMetrics.servedCount), avgWaitChange: pctChange(currentMetrics.avgWaitMinutes, prevMetrics.avgWaitMinutes), avgServiceChange: pctChange(currentMetrics.avgServiceMinutes, prevMetrics.avgServiceMinutes), noShowRateChange: pctChange(currentMetrics.noShowRate, prevMetrics.noShowRate) };
            const targetWait = 10;
            const waitFactor = currentMetrics.avgWaitMinutes <= targetWait ? 1 : Math.max(0, 1 - (currentMetrics.avgWaitMinutes - targetWait) / 30);
            const noShowFactor = Math.max(0, 1 - currentMetrics.noShowRate / 50);
            const avgDailyLoad = prevMetrics.totalEntries > 0 ? prevMetrics.totalEntries : currentMetrics.totalEntries || 1;
            const loadRatio = currentMetrics.totalEntries / Math.max(avgDailyLoad, 1);
            const loadFactor = loadRatio <= 1.2 ? 1 : Math.max(0, 1 - (loadRatio - 1.2) / 2);
            const healthScore = Math.round((waitFactor * 0.4 + noShowFactor * 0.3 + loadFactor * 0.3) * 100);
            const healthLabel = healthScore >= 80 ? "smooth" : healthScore >= 50 ? "busy" : "overloaded";
            const staffMap: Record<string, { name: string; served: number; totalWait: number; totalService: number; count: number }> = {};
            const servedEntries = entries.filter((e: any) => e.status === "served");
            for (const e of servedEntries) {
                if (!e.served_by) continue;
                if (!staffMap[e.served_by]) { const staff = await kv.get(`staff_user:${e.served_by}`); staffMap[e.served_by] = { name: staff?.name || "Unknown", served: 0, totalWait: 0, totalService: 0, count: 0 }; }
                staffMap[e.served_by].served++;
                if (e.joined_at && e.called_at) { staffMap[e.served_by].totalWait += (new Date(e.called_at).getTime() - new Date(e.joined_at).getTime()) / 60000; staffMap[e.served_by].count++; }
                if (e.called_at && e.completed_at) { staffMap[e.served_by].totalService += (new Date(e.completed_at).getTime() - new Date(e.called_at).getTime()) / 60000; }
            }
            const staffPerformance = Object.entries(staffMap).map(([id, s]) => {
                const avgService = s.count > 0 ? Math.round((s.totalService / s.count) * 10) / 10 : 0;
                const avgWait = s.count > 0 ? Math.round((s.totalWait / s.count) * 10) / 10 : 0;
                const efficiency = avgService > 0 ? Math.round((s.served / avgService) * 100) / 10 : 0;
                return { id, name: s.name, served: s.served, avgWait, avgService, efficiency };
            }).sort((a, b) => b.efficiency - a.efficiency);
            const maxEff = Math.max(...staffPerformance.map((s) => s.efficiency), 1);
            for (const s of staffPerformance) (s as any).efficiencyScore = Math.round((s.efficiency / maxEff) * 100);
            const heatmapData: { day: number; hour: number; count: number }[] = [];
            const heatmapGrid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
            for (const e of entries) { const d = new Date(e.joined_at); const dow = d.getDay(); const h = d.getHours(); heatmapGrid[dow][h]++; }
            for (let day = 0; day < 7; day++) for (let hour = 6; hour <= 22; hour++) heatmapData.push({ day, hour, count: heatmapGrid[day][hour] });
            const svcMap: Record<string, any> = {};
            for (const e of entries) {
                const qtId = e.queue_type_id || "general";
                if (!svcMap[qtId]) svcMap[qtId] = { name: e.queue_type_name || "General", prefix: e.queue_type_prefix || "?", count: 0, servedCount: 0, noShowCount: 0, cancelledCount: 0, totalWait: 0, waitCount: 0, totalService: 0, serviceCount: 0 };
                svcMap[qtId].count++;
                if (e.status === "served") svcMap[qtId].servedCount++;
                if (e.status === "no_show") svcMap[qtId].noShowCount++;
                if (e.status === "cancelled") svcMap[qtId].cancelledCount++;
                if (e.joined_at && e.called_at && e.status === "served") { svcMap[qtId].totalWait += (new Date(e.called_at).getTime() - new Date(e.joined_at).getTime()) / 60000; svcMap[qtId].waitCount++; }
                if (e.called_at && e.completed_at && e.status === "served") { svcMap[qtId].totalService += (new Date(e.completed_at).getTime() - new Date(e.called_at).getTime()) / 60000; svcMap[qtId].serviceCount++; }
            }
            const serviceAnalysis = Object.entries(svcMap).map(([id, s]: [string, any]) => ({ id, name: s.name, prefix: s.prefix, totalEntries: s.count, servedCount: s.servedCount, noShowCount: s.noShowCount, cancelledCount: s.cancelledCount, avgWait: s.waitCount > 0 ? Math.round((s.totalWait / s.waitCount) * 10) / 10 : 0, avgService: s.serviceCount > 0 ? Math.round((s.totalService / s.serviceCount) * 10) / 10 : 0 })).sort((a, b) => b.totalEntries - a.totalEntries);
            const dailyMap: Record<string, any> = {};
            const thirtyDaysAgo = nowMs - 30 * 86400000;
            const trendEntries = allEntries.filter((e: any) => new Date(e.joined_at).getTime() >= thirtyDaysAgo);
            for (const e of trendEntries) {
                const date = e.joined_at.slice(0, 10);
                if (!dailyMap[date]) dailyMap[date] = { date, served: 0, joined: 0, waitSum: 0, waitCount: 0 };
                dailyMap[date].joined++;
                if (e.status === "served") { dailyMap[date].served++; if (e.joined_at && e.called_at) { dailyMap[date].waitSum += (new Date(e.called_at).getTime() - new Date(e.joined_at).getTime()) / 60000; dailyMap[date].waitCount++; } }
            }
            const dailyTrend = Object.values(dailyMap).map((d: any) => ({ date: d.date, served: d.served, joined: d.joined, avgWait: d.waitCount > 0 ? Math.round((d.waitSum / d.waitCount) * 10) / 10 : 0 })).sort((a: any, b: any) => a.date.localeCompare(b.date));
            const sma7: { date: string; sma: number }[] = [];
            for (let i = 0; i < dailyTrend.length; i++) { const window = dailyTrend.slice(Math.max(0, i - 6), i + 1); const avg = Math.round((window.reduce((acc: number, d: any) => acc + d.served, 0) / window.length) * 10) / 10; sma7.push({ date: dailyTrend[i].date, sma: avg }); }
            let trendDirection: "up" | "stable" | "down" = "stable";
            if (sma7.length >= 7) { const recent = sma7.slice(-3).reduce((a, d) => a + d.sma, 0) / 3; const older = sma7.slice(-7, -4).reduce((a, d) => a + d.sma, 0) / Math.max(sma7.slice(-7, -4).length, 1); if (recent > older * 1.1) trendDirection = "up"; else if (recent < older * 0.9) trendDirection = "down"; }
            return c.json({
                summary: currentMetrics, kpiChanges, healthScore, healthLabel, staffPerformance, heatmapData, serviceAnalysis,
                dailyTrend: dailyTrend.map((d: any, i: number) => ({ ...d, sma7: sma7[i]?.sma ?? null })), trendDirection, range,
                periodLabel: range === "today" ? "vs yesterday" : range === "7d" ? "vs prev 7 days" : range === "30d" ? "vs prev 30 days" : "vs prev period",
            });
        } catch (err: any) {
            return c.json({ error: `Advanced analytics failed: ${err.message}` }, 500);
        }
    });
}

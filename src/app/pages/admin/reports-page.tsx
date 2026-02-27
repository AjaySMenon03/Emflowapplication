/**
 * Reports & Analytics Dashboard — /admin/reports
 *
 * Comprehensive analytics with Recharts visualizations:
 *   - KPI summary cards with trend indicators
 *   - Hourly distribution stacked bar chart
 *   - Queue type breakdown donut chart
 *   - Joined vs. Served area chart overlay
 *   - Staff performance leaderboard with bar visualization
 *   - Queue type detail cards
 *   - Responsive, themed for dark/light mode
 */
import { useEffect, useState, useCallback } from "react";
import { useLocaleStore } from "../../stores/locale-store";
import { useAuthStore } from "../../stores/auth-store";
import { api } from "../../lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Separator } from "../../components/ui/separator";
import { ReportsSkeleton } from "../../components/loading-skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  Area,
  ComposedChart,
  Line,
  RadialBarChart,
  RadialBar,
} from "recharts";
import {
  Users,
  Clock,
  Timer,
  UserX,
  TrendingUp,
  MapPin,
  BarChart3,
  Award,
  Activity,
  AlertCircle,
  RefreshCw,
  Target,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

// ── Types ──
interface Summary {
  servedCount: number;
  noShowCount: number;
  cancelledCount: number;
  waitingCount: number;
  servingCount: number;
  totalEntries: number;
  avgWaitMinutes: number;
  avgServiceMinutes: number;
  noShowRate: number;
  peakHour: number;
  peakHourFormatted: string;
}

interface HourlyData {
  hour: number;
  served: number;
  noShow: number;
  joined: number;
}

interface StaffPerf {
  id: string;
  name: string;
  served: number;
  avgWait: number;
  avgService: number;
}

interface QueueBreakdown {
  id: string;
  name: string;
  prefix: string;
  served: number;
  noShow: number;
  cancelled: number;
  waiting: number;
}

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
];

const STATUS_COLORS: Record<string, string> = {
  served: "#10b981",
  noShow: "#ef4444",
  cancelled: "#f59e0b",
  waiting: "#3b82f6",
  serving: "#8b5cf6",
};

// ── Custom Tooltip ──
function ChartTooltip({ active, payload, label, labelFormatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-foreground mb-1">
        {labelFormatter ? labelFormatter(label) : label}
      </p>
      {payload.map((item: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span className="text-muted-foreground">{item.name}:</span>
          <span className="font-medium text-foreground">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ReportsPage() {
  const { t } = useLocaleStore();
  const { session, staffRecord, businessId } = useAuthStore();
  const accessToken = session?.access_token;

  const [locations, setLocations] = useState<any[]>([]);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [error, setError] = useState("");

  const [summary, setSummary] = useState<Summary | null>(null);
  const [hourlyData, setHourlyData] = useState<HourlyData[]>([]);
  const [staffPerformance, setStaffPerformance] = useState<StaffPerf[]>([]);
  const [queueBreakdown, setQueueBreakdown] = useState<QueueBreakdown[]>([]);

  // ── Load locations ──
  useEffect(() => {
    if (!businessId || !accessToken) return;
    (async () => {
      const { data } = await api<{ locations: any[] }>(
        `/business/${businessId}/locations`,
        { accessToken }
      );
      if (data?.locations?.length) {
        setLocations(data.locations);
        const staffLocs = staffRecord?.locations || [];
        const first =
          data.locations.find((l: any) => staffLocs.includes(l.id)) ||
          data.locations[0];
        if (first) setSelectedLocation(first.id);
      }
      setLoading(false);
    })();
  }, [businessId, accessToken, staffRecord]);

  // ── Fetch analytics ──
  const fetchAnalytics = useCallback(async () => {
    if (!selectedLocation || !accessToken) return;
    setAnalyticsLoading(true);
    setError("");

    const { data, error: apiErr } = await api<{
      summary: Summary;
      hourlyData: HourlyData[];
      staffPerformance: StaffPerf[];
      queueBreakdown: QueueBreakdown[];
    }>(`/analytics/${selectedLocation}`, { accessToken });

    if (apiErr) {
      setError(apiErr);
    } else if (data) {
      setSummary(data.summary);
      setHourlyData(data.hourlyData);
      setStaffPerformance(data.staffPerformance);
      setQueueBreakdown(data.queueBreakdown);
    }
    setAnalyticsLoading(false);
  }, [selectedLocation, accessToken]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // ── Loading state ──
  if (loading) return <ReportsSkeleton />;

  // ── Format helpers ──
  const formatHour = (h: number) => `${h.toString().padStart(2, "0")}:00`;

  // Stats cards data
  const statsCards = summary
    ? [
        {
          label: t("reports.servedToday"),
          value: String(summary.servedCount),
          icon: TrendingUp,
          color: "text-emerald-600 dark:text-emerald-400",
          bgColor: "bg-emerald-500/10",
          borderColor: "border-emerald-500/20",
          subtitle: `${summary.totalEntries} total entries`,
          trend: summary.servedCount > 0 ? "up" : "neutral",
        },
        {
          label: t("reports.avgWaitTime"),
          value: `${summary.avgWaitMinutes}m`,
          icon: Clock,
          color: "text-blue-600 dark:text-blue-400",
          bgColor: "bg-blue-500/10",
          borderColor: "border-blue-500/20",
          subtitle: `${t("reports.peakHour")}: ${summary.peakHourFormatted}`,
          trend: summary.avgWaitMinutes > 15 ? "up" : summary.avgWaitMinutes > 0 ? "down" : "neutral",
        },
        {
          label: t("reports.avgServiceTime"),
          value: `${summary.avgServiceMinutes}m`,
          icon: Timer,
          color: "text-purple-600 dark:text-purple-400",
          bgColor: "bg-purple-500/10",
          borderColor: "border-purple-500/20",
          subtitle: `${summary.servingCount} ${t("queue.serving").toLowerCase()}`,
          trend: "neutral",
        },
        {
          label: t("reports.noShowRate"),
          value: `${summary.noShowRate}%`,
          icon: UserX,
          color:
            summary.noShowRate > 15
              ? "text-red-600 dark:text-red-400"
              : "text-amber-600 dark:text-amber-400",
          bgColor:
            summary.noShowRate > 15 ? "bg-red-500/10" : "bg-amber-500/10",
          borderColor:
            summary.noShowRate > 15
              ? "border-red-500/20"
              : "border-amber-500/20",
          subtitle: `${summary.noShowCount} ${t("reports.noShowCount").toLowerCase()}`,
          trend: summary.noShowRate > 10 ? "up" : summary.noShowRate > 0 ? "down" : "neutral",
        },
      ]
    : [];

  // Hourly chart data — filter to active hours (6am-10pm)
  const activeHourly = hourlyData.filter(
    (h) => h.hour >= 6 && h.hour <= 22
  );

  // Queue type pie data
  const pieData = queueBreakdown.map((q) => ({
    name: q.name,
    value: q.served + q.noShow + q.cancelled,
    served: q.served,
  }));

  // Staff leaderboard max for bar sizing
  const maxStaffServed = Math.max(
    ...staffPerformance.map((s) => s.served),
    1
  );

  // Efficiency score (100 = all served, 0 = all no-show)
  const efficiencyScore = summary && summary.totalEntries > 0
    ? Math.round((summary.servedCount / Math.max(summary.servedCount + summary.noShowCount, 1)) * 100)
    : 0;

  const efficiencyData = [
    { name: "Efficiency", value: efficiencyScore, fill: efficiencyScore > 80 ? "#10b981" : efficiencyScore > 50 ? "#f59e0b" : "#ef4444" },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("reports.title")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("reports.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {locations.length > 0 && (
            <Select
              value={selectedLocation}
              onValueChange={setSelectedLocation}
            >
              <SelectTrigger className="w-48">
                <MapPin className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                <SelectValue placeholder={t("queue.selectLocation")} />
              </SelectTrigger>
              <SelectContent>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={fetchAnalytics}
            disabled={analyticsLoading}
            className="h-9 w-9"
          >
            <RefreshCw
              className={`h-4 w-4 ${analyticsLoading ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-destructive text-sm">{error}</p>
        </div>
      )}

      {/* Loading overlay */}
      {analyticsLoading && !summary && <ReportsSkeleton />}

      {/* ── No data empty state ── */}
      {!analyticsLoading && summary && summary.totalEntries === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
              <BarChart3 className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold text-foreground">
                {t("reports.noDataYet")}
              </h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                {t("reports.noDataDesc")}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Stats Grid ── */}
      {summary && summary.totalEntries > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {statsCards.map((stat) => (
              <Card
                key={stat.label}
                className={`transition-all hover:shadow-md border-l-4 ${stat.borderColor}`}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-sm text-muted-foreground font-medium">
                        {stat.label}
                      </p>
                      <div className="flex items-baseline gap-2 mt-1">
                        <p className="text-3xl font-bold text-foreground tracking-tight">
                          {stat.value}
                        </p>
                        {stat.trend === "up" && (
                          <ArrowUpRight className="h-4 w-4 text-emerald-500" />
                        )}
                        {stat.trend === "down" && (
                          <ArrowDownRight className="h-4 w-4 text-blue-500" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {stat.subtitle}
                      </p>
                    </div>
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.bgColor}`}
                    >
                      <stat.icon className={`h-5 w-5 ${stat.color}`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ── Charts Row 1 ── */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Hourly Distribution — takes 2 cols */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">
                      {t("reports.hourlyDistribution")}
                    </CardTitle>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {t("reports.peakHour")}: {summary.peakHourFormatted}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={activeHourly}>
                      <defs>
                        <linearGradient id="gradJoined" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="gradServed" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-border"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="hour"
                        tickFormatter={formatHour}
                        tick={{ fontSize: 11 }}
                        className="fill-muted-foreground"
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        className="fill-muted-foreground"
                        axisLine={false}
                        tickLine={false}
                        width={30}
                      />
                      <RechartsTooltip
                        content={
                          <ChartTooltip
                            labelFormatter={(h: number) => formatHour(Number(h))}
                          />
                        }
                      />
                      <Area
                        type="monotone"
                        dataKey="joined"
                        name="Joined"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        fill="url(#gradJoined)"
                      />
                      <Area
                        type="monotone"
                        dataKey="served"
                        name={t("reports.servedCount")}
                        stroke="#10b981"
                        strokeWidth={2}
                        fill="url(#gradServed)"
                      />
                      <Line
                        type="monotone"
                        dataKey="noShow"
                        name={t("reports.noShowCount")}
                        stroke="#ef4444"
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center justify-center gap-5 mt-2">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="h-2 w-5 rounded bg-blue-500/40" />
                    Joined
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="h-2 w-5 rounded bg-emerald-500/40" />
                    {t("reports.servedCount")}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="h-0.5 w-5 rounded border-t-2 border-dashed border-red-500" />
                    {t("reports.noShowCount")}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Efficiency Score + Pie */}
            <div className="space-y-6">
              {/* Efficiency Score */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">{t("reports.efficiency")}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-center">
                    <div className="relative">
                      <ResponsiveContainer width={140} height={140}>
                        <RadialBarChart
                          cx="50%"
                          cy="50%"
                          innerRadius="70%"
                          outerRadius="100%"
                          startAngle={90}
                          endAngle={-270}
                          data={efficiencyData}
                        >
                          <RadialBar
                            dataKey="value"
                            cornerRadius={10}
                            background={{ fill: "var(--muted)" }}
                          />
                        </RadialBarChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-2xl font-bold text-foreground">
                          {efficiencyScore}%
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-center text-muted-foreground mt-2">
                    Served vs. No-Show ratio
                  </p>
                </CardContent>
              </Card>

              {/* Queue Type Donut */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">
                      {t("reports.queueBreakdown")}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  {pieData.length === 0 || pieData.every((d) => d.value === 0) ? (
                    <div className="flex h-40 items-center justify-center">
                      <p className="text-sm text-muted-foreground">
                        {t("common.noData")}
                      </p>
                    </div>
                  ) : (
                    <div className="h-44">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={45}
                            outerRadius={70}
                            paddingAngle={3}
                            dataKey="value"
                            stroke="none"
                          >
                            {pieData.map((_entry, idx) => (
                              <Cell
                                key={`cell-${idx}`}
                                fill={CHART_COLORS[idx % CHART_COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <RechartsTooltip content={<ChartTooltip />} />
                          <Legend
                            iconSize={8}
                            formatter={(value) => (
                              <span className="text-xs text-foreground">
                                {value}
                              </span>
                            )}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* ── Queue Type Details ── */}
          {queueBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t("reports.queueBreakdown")} — {t("common.today")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {queueBreakdown.map((q, idx) => {
                    const total = q.served + q.noShow + q.cancelled;
                    const servedPct = total > 0 ? Math.round((q.served / total) * 100) : 0;
                    return (
                      <div
                        key={q.id}
                        className="rounded-xl border border-border p-4 transition-all hover:bg-accent/30 hover:shadow-sm"
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <div
                            className="flex h-10 w-10 items-center justify-center rounded-lg font-bold text-sm text-white"
                            style={{
                              backgroundColor:
                                CHART_COLORS[idx % CHART_COLORS.length],
                            }}
                          >
                            {q.prefix}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-foreground truncate">
                              {q.name}
                            </h4>
                            <p className="text-xs text-muted-foreground">
                              {servedPct}% served
                            </p>
                          </div>
                        </div>
                        {/* Mini progress bar */}
                        {total > 0 && (
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-3">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${servedPct}%`,
                                backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
                              }}
                            />
                          </div>
                        )}
                        <div className="grid grid-cols-4 gap-2 text-center">
                          <div>
                            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                              {q.served}
                            </p>
                            <p className="text-[0.65rem] text-muted-foreground">
                              {t("reports.servedCount")}
                            </p>
                          </div>
                          <div>
                            <p className="text-lg font-bold text-blue-600 dark:text-blue-400">
                              {q.waiting}
                            </p>
                            <p className="text-[0.65rem] text-muted-foreground">
                              {t("queue.waiting")}
                            </p>
                          </div>
                          <div>
                            <p className="text-lg font-bold text-red-600 dark:text-red-400">
                              {q.noShow}
                            </p>
                            <p className="text-[0.65rem] text-muted-foreground">
                              {t("reports.noShowCount")}
                            </p>
                          </div>
                          <div>
                            <p className="text-lg font-bold text-amber-600 dark:text-amber-400">
                              {q.cancelled}
                            </p>
                            <p className="text-[0.65rem] text-muted-foreground">
                              {t("reports.cancelledCount")}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Staff Performance Leaderboard ── */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">
                    {t("reports.staffPerformance")}
                  </CardTitle>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {staffPerformance.length} staff
                </Badge>
              </div>
              <CardDescription>
                Performance ranking based on customers served
              </CardDescription>
            </CardHeader>
            <CardContent>
              {staffPerformance.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Users className="h-10 w-10 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    {t("common.noData")}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {staffPerformance.map((s, idx) => (
                    <div
                      key={s.id}
                      className="group flex items-center gap-4 rounded-lg px-4 py-3 transition-colors hover:bg-accent/30"
                    >
                      {/* Rank */}
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-bold text-xs ${
                          idx === 0
                            ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                            : idx === 1
                              ? "bg-slate-400/20 text-slate-600 dark:text-slate-300"
                              : idx === 2
                                ? "bg-orange-500/20 text-orange-600 dark:text-orange-400"
                                : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {idx + 1}
                      </div>

                      {/* Name + bar */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-foreground truncate">
                            {s.name}
                          </span>
                          <span className="text-sm font-bold text-foreground ml-2">
                            {s.served}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/70 transition-all duration-500"
                            style={{
                              width: `${(s.served / maxStaffServed) * 100}%`,
                            }}
                          />
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                        <div className="text-center">
                          <span className="block text-sm font-medium text-foreground">
                            {s.avgWait}m
                          </span>
                          <span className="text-[0.6rem]">Avg Wait</span>
                        </div>
                        <div className="text-center">
                          <span className="block text-sm font-medium text-foreground">
                            {s.avgService}m
                          </span>
                          <span className="text-[0.6rem]">Avg Service</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
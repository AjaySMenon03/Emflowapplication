/**
 * Advanced Analytics Dashboard — /admin/analytics
 *
 * Full-featured analytics with:
 *   - Date range selector (Today / 7d / 30d / Custom)
 *   - Animated KPI cards with % change vs previous period
 *   - Queue Health Score (circular gauge 0-100)
 *   - Staff Performance Leaderboard with efficiency scores
 *   - Day x Hour heatmap grid
 *   - Service type analysis (pie + per-type metrics)
 *   - 30-day trend line chart with 7-day SMA overlay
 *   - Predictive trend indicator
 *
 * Security: owner & admin only (enforced server-side)
 */
import { useEffect, useState, useCallback, useMemo } from "react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import { ReportsSkeleton } from "../../components/loading-skeleton";
import {
  LineChart,
  Line,
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
  Bar,
  BarChart,
  RadialBarChart,
  RadialBar,
} from "recharts";
import {
  Users,
  Clock,
  Timer,
  UserX,
  TrendingUp,
  TrendingDown,
  Minus,
  MapPin,
  BarChart3,
  Award,
  Activity,
  AlertCircle,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Heart,
  Shield,
  Flame,
  Info,
  Calendar,
  Crown,
  Zap,
} from "lucide-react";
import { motion } from "motion/react";

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

interface KpiChanges {
  servedChange: number;
  avgWaitChange: number;
  avgServiceChange: number;
  noShowRateChange: number;
}

interface StaffPerf {
  id: string;
  name: string;
  served: number;
  avgWait: number;
  avgService: number;
  efficiency: number;
  efficiencyScore: number;
}

interface HeatmapCell {
  day: number;
  hour: number;
  count: number;
}

interface ServiceType {
  id: string;
  name: string;
  prefix: string;
  totalEntries: number;
  servedCount: number;
  noShowCount: number;
  cancelledCount: number;
  avgWait: number;
  avgService: number;
}

interface DailyTrend {
  date: string;
  served: number;
  joined: number;
  avgWait: number;
  sma7: number | null;
}

interface AnalyticsData {
  summary: Summary;
  kpiChanges: KpiChanges;
  healthScore: number;
  healthLabel: "smooth" | "busy" | "overloaded";
  staffPerformance: StaffPerf[];
  heatmapData: HeatmapCell[];
  serviceAnalysis: ServiceType[];
  dailyTrend: DailyTrend[];
  trendDirection: "up" | "stable" | "down";
  periodLabel: string;
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

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6-22

// ── Custom Tooltip ──
function ChartTooltip({ active, payload, label, labelFormatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-xl">
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

// ── Animated KPI Card ──
function KpiCard({
  label,
  value,
  icon: Icon,
  change,
  subtitle,
  color,
  bgColor,
  borderColor,
  goodDirection,
  delay = 0,
}: {
  label: string;
  value: string;
  icon: any;
  change: number;
  subtitle: string;
  color: string;
  bgColor: string;
  borderColor: string;
  goodDirection: "up" | "down";
  delay?: number;
}) {
  const isGood =
    goodDirection === "up" ? change > 0 : goodDirection === "down" ? change < 0 : true;
  const changeColor =
    change === 0
      ? "text-muted-foreground"
      : isGood
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-red-600 dark:text-red-400";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
    >
      <Card
        className={`transition-all hover:shadow-lg border-l-4 ${borderColor} group`}
      >
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm text-muted-foreground font-medium">
                {label}
              </p>
              <div className="flex items-baseline gap-2 mt-1">
                <p className="text-3xl font-bold text-foreground tracking-tight">
                  {value}
                </p>
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                {change !== 0 && (
                  <span className={`flex items-center gap-0.5 text-xs font-medium ${changeColor}`}>
                    {change > 0 ? (
                      <ArrowUpRight className="h-3 w-3" />
                    ) : (
                      <ArrowDownRight className="h-3 w-3" />
                    )}
                    {Math.abs(change)}%
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {subtitle}
                </span>
              </div>
            </div>
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-xl ${bgColor} transition-transform group-hover:scale-110`}
            >
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Queue Health Gauge ──
function HealthGauge({
  score,
  label,
}: {
  score: number;
  label: "smooth" | "busy" | "overloaded";
}) {
  const { t } = useLocaleStore();
  const color =
    label === "smooth"
      ? "#10b981"
      : label === "busy"
        ? "#f59e0b"
        : "#ef4444";
  const emoji =
    label === "smooth" ? "smooth" : label === "busy" ? "busy" : "overloaded";
  const data = [{ name: "Health", value: score, fill: color }];

  return (
    <Card className="relative overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Heart className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">
            {t("analytics.queueHealth")}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <ResponsiveContainer width={160} height={160}>
              <RadialBarChart
                cx="50%"
                cy="50%"
                innerRadius="70%"
                outerRadius="100%"
                startAngle={90}
                endAngle={-270}
                data={data}
              >
                <RadialBar
                  dataKey="value"
                  cornerRadius={10}
                  background={{ fill: "var(--muted)" }}
                />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold text-foreground">
                {score}
              </span>
              <span className="text-xs text-muted-foreground">/100</span>
            </div>
          </div>
          <Badge
            variant="outline"
            className="text-sm px-3 py-1"
            style={{ borderColor: color, color }}
          >
            {t(`analytics.health_${emoji}`)}
          </Badge>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <Info className="h-3 w-3" />
                  {t("analytics.howCalculated")}
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                <p>{t("analytics.healthTooltip")}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Heatmap Grid ──
function HeatmapGrid({ data }: { data: HeatmapCell[] }) {
  const { t } = useLocaleStore();
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  function getHeatColor(count: number) {
    if (count === 0) return "bg-muted/50";
    const intensity = count / maxCount;
    if (intensity < 0.25) return "bg-emerald-200 dark:bg-emerald-900/60";
    if (intensity < 0.5) return "bg-emerald-400 dark:bg-emerald-700/70";
    if (intensity < 0.75) return "bg-amber-400 dark:bg-amber-600/70";
    return "bg-red-500 dark:bg-red-600/80";
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">
            {t("analytics.hourlyHeatmap")}
          </CardTitle>
        </div>
        <CardDescription>{t("analytics.heatmapDesc")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            {/* Hour labels */}
            <div className="flex">
              <div className="w-12 shrink-0" />
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="flex-1 text-center text-[0.6rem] text-muted-foreground font-medium pb-1"
                >
                  {h}:00
                </div>
              ))}
            </div>
            {/* Grid rows */}
            {[1, 2, 3, 4, 5, 6, 0].map((dayIdx) => (
              <div key={dayIdx} className="flex items-center gap-0.5 mb-0.5">
                <div className="w-12 shrink-0 text-xs text-muted-foreground font-medium text-right pr-2">
                  {DAY_LABELS[dayIdx]}
                </div>
                {HOURS.map((h) => {
                  const cell = data.find(
                    (d) => d.day === dayIdx && d.hour === h
                  );
                  const count = cell?.count || 0;
                  return (
                    <TooltipProvider key={h}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className={`flex-1 aspect-square rounded-sm ${getHeatColor(
                              count
                            )} transition-all hover:ring-2 hover:ring-primary/50 cursor-default min-h-[18px]`}
                          />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">
                          <p>
                            {DAY_LABELS[dayIdx]} {h}:00 — {count} entries
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                })}
              </div>
            ))}
            {/* Legend */}
            <div className="flex items-center justify-end gap-2 mt-3">
              <span className="text-[0.6rem] text-muted-foreground">
                {t("analytics.less")}
              </span>
              <div className="flex gap-0.5">
                <div className="h-3 w-3 rounded-sm bg-muted/50" />
                <div className="h-3 w-3 rounded-sm bg-emerald-200 dark:bg-emerald-900/60" />
                <div className="h-3 w-3 rounded-sm bg-emerald-400 dark:bg-emerald-700/70" />
                <div className="h-3 w-3 rounded-sm bg-amber-400 dark:bg-amber-600/70" />
                <div className="h-3 w-3 rounded-sm bg-red-500 dark:bg-red-600/80" />
              </div>
              <span className="text-[0.6rem] text-muted-foreground">
                {t("analytics.more")}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Component ──

export function AnalyticsPage() {
  const { t } = useLocaleStore();
  const { session, staffRecord, businessId, role } = useAuthStore();
  const accessToken = session?.access_token;

  const [locations, setLocations] = useState<any[]>([]);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [error, setError] = useState("");
  const [dateRange, setDateRange] = useState("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<AnalyticsData | null>(null);

  // Role check — only owner/admin
  const canView = role === "owner" || staffRecord?.role === "owner" || staffRecord?.role === "admin";

  // Load locations
  useEffect(() => {
    if (!businessId || !accessToken) return;
    (async () => {
      const { data: resp } = await api<{ locations: any[] }>(
        `/business/${businessId}/locations`,
        { accessToken }
      );
      if (resp?.locations?.length) {
        setLocations(resp.locations);
        const staffLocs = staffRecord?.locations || [];
        const first =
          resp.locations.find((l: any) => staffLocs.includes(l.id)) ||
          resp.locations[0];
        if (first) setSelectedLocation(first.id);
      }
      setLoading(false);
    })();
  }, [businessId, accessToken, staffRecord]);

  // Fetch analytics
  const fetchAnalytics = useCallback(async () => {
    if (!selectedLocation || !accessToken) return;
    setAnalyticsLoading(true);
    setError("");

    let query = `/analytics/advanced/${selectedLocation}?range=${dateRange}`;
    if (dateRange === "custom" && customFrom && customTo) {
      query += `&from=${customFrom}&to=${customTo}`;
    }

    const { data: resp, error: apiErr } = await api<AnalyticsData>(query, {
      accessToken,
    });

    if (apiErr) {
      setError(apiErr);
    } else if (resp) {
      setData(resp);
    }
    setAnalyticsLoading(false);
  }, [selectedLocation, accessToken, dateRange, customFrom, customTo]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // KPI cards config
  const kpiCards = useMemo(() => {
    if (!data) return [];
    const { summary: s, kpiChanges: kc } = data;
    return [
      {
        label: t("analytics.totalServed"),
        value: String(s.servedCount),
        icon: Users,
        change: kc.servedChange,
        subtitle: data.periodLabel,
        color: "text-emerald-600 dark:text-emerald-400",
        bgColor: "bg-emerald-500/10",
        borderColor: "border-emerald-500/20",
        goodDirection: "up" as const,
      },
      {
        label: t("analytics.avgWait"),
        value: `${s.avgWaitMinutes}m`,
        icon: Clock,
        change: kc.avgWaitChange,
        subtitle: data.periodLabel,
        color: "text-blue-600 dark:text-blue-400",
        bgColor: "bg-blue-500/10",
        borderColor: "border-blue-500/20",
        goodDirection: "down" as const,
      },
      {
        label: t("analytics.avgService"),
        value: `${s.avgServiceMinutes}m`,
        icon: Timer,
        change: kc.avgServiceChange,
        subtitle: data.periodLabel,
        color: "text-purple-600 dark:text-purple-400",
        bgColor: "bg-purple-500/10",
        borderColor: "border-purple-500/20",
        goodDirection: "down" as const,
      },
      {
        label: t("analytics.noShowRate"),
        value: `${s.noShowRate}%`,
        icon: UserX,
        change: kc.noShowRateChange,
        subtitle: data.periodLabel,
        color: s.noShowRate > 15
          ? "text-red-600 dark:text-red-400"
          : "text-amber-600 dark:text-amber-400",
        bgColor: s.noShowRate > 15 ? "bg-red-500/10" : "bg-amber-500/10",
        borderColor: s.noShowRate > 15
          ? "border-red-500/20"
          : "border-amber-500/20",
        goodDirection: "down" as const,
      },
      {
        label: t("analytics.peakHour"),
        value: s.peakHourFormatted,
        icon: Flame,
        change: 0,
        subtitle: `${s.totalEntries} ${t("analytics.totalEntries")}`,
        color: "text-orange-600 dark:text-orange-400",
        bgColor: "bg-orange-500/10",
        borderColor: "border-orange-500/20",
        goodDirection: "up" as const,
      },
    ];
  }, [data, t]);

  // Staff leaderboard max
  const maxStaffServed = useMemo(
    () =>
      data
        ? Math.max(...data.staffPerformance.map((s) => s.served), 1)
        : 1,
    [data]
  );

  // Pie data
  const pieData = useMemo(
    () =>
      data
        ? data.serviceAnalysis.map((s) => ({
            name: s.name,
            value: s.totalEntries,
          }))
        : [],
    [data]
  );

  // ── Auth guard ──
  if (!canView) {
    return (
      <div className="flex items-center justify-center h-96">
        <Card className="max-w-md">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Shield className="h-12 w-12 text-muted-foreground" />
            <h2 className="text-lg font-semibold">
              {t("analytics.restricted")}
            </h2>
            <p className="text-sm text-muted-foreground text-center">
              {t("analytics.restrictedDesc")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) return <ReportsSkeleton />;

  const formatHour = (h: number) => `${h.toString().padStart(2, "0")}:00`;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("analytics.title")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("analytics.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Date Range Selector */}
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-36">
              <Calendar className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">{t("common.today")}</SelectItem>
              <SelectItem value="7d">{t("analytics.last7Days")}</SelectItem>
              <SelectItem value="30d">{t("analytics.last30Days")}</SelectItem>
              <SelectItem value="custom">{t("analytics.custom")}</SelectItem>
            </SelectContent>
          </Select>

          {dateRange === "custom" && (
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              />
              <span className="text-xs text-muted-foreground">—</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              />
            </div>
          )}

          {/* Location Selector */}
          {locations.length > 0 && (
            <Select
              value={selectedLocation}
              onValueChange={setSelectedLocation}
            >
              <SelectTrigger className="w-48">
                <MapPin className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                <SelectValue />
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

      {analyticsLoading && !data && <ReportsSkeleton />}

      {/* ── Empty state ── */}
      {!analyticsLoading && data && data.summary.totalEntries === 0 && (
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

      {data && data.summary.totalEntries > 0 && (
        <>
          {/* ── KPI Cards ── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {kpiCards.map((card, i) => (
              <KpiCard key={card.label} {...card} delay={i * 0.08} />
            ))}
          </div>

          {/* ── Health Score + Staff Leaderboard ── */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Health Gauge */}
            <HealthGauge
              score={data.healthScore}
              label={data.healthLabel}
            />

            {/* Staff Performance Leaderboard */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Award className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">
                      {t("analytics.staffLeaderboard")}
                    </CardTitle>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {data.staffPerformance.length} {t("analytics.staff")}
                  </Badge>
                </div>
                <CardDescription>
                  {t("analytics.staffLeaderboardDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.staffPerformance.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-3">
                    <Users className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {t("common.noData")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {data.staffPerformance.map((staff, idx) => (
                      <motion.div
                        key={staff.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-accent/30 transition-all"
                      >
                        {/* Rank */}
                        <div
                          className={`flex h-8 w-8 items-center justify-center rounded-full shrink-0 ${
                            idx === 0
                              ? "bg-amber-100 dark:bg-amber-900/40"
                              : "bg-muted"
                          }`}
                        >
                          {idx === 0 ? (
                            <Crown className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          ) : (
                            <span className="text-xs font-bold text-muted-foreground">
                              #{idx + 1}
                            </span>
                          )}
                        </div>

                        {/* Name & stats */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm text-foreground truncate">
                              {staff.name}
                            </p>
                            {idx === 0 && (
                              <Badge className="text-[0.6rem] h-4 bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30">
                                {t("analytics.topPerformer")}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs text-muted-foreground">
                              {staff.served} {t("analytics.served")}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {t("analytics.avgSvc")}: {staff.avgService}m
                            </span>
                          </div>
                        </div>

                        {/* Efficiency bar */}
                        <div className="w-24 shrink-0">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-muted-foreground">
                              {t("analytics.efficiency")}
                            </span>
                            <span className="font-semibold text-foreground">
                              {staff.efficiencyScore}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <motion.div
                              className="h-full rounded-full"
                              style={{
                                backgroundColor:
                                  staff.efficiencyScore >= 80
                                    ? "#10b981"
                                    : staff.efficiencyScore >= 50
                                      ? "#f59e0b"
                                      : "#ef4444",
                              }}
                              initial={{ width: 0 }}
                              animate={{
                                width: `${staff.efficiencyScore}%`,
                              }}
                              transition={{
                                duration: 0.8,
                                delay: idx * 0.1,
                              }}
                            />
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Hourly Heatmap (full width) ── */}
          <HeatmapGrid data={data.heatmapData} />

          {/* ── Service Analysis + Trend ── */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Service Type Analysis */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">
                    {t("analytics.serviceInsights")}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {pieData.length === 0 ||
                pieData.every((d) => d.value === 0) ? (
                  <div className="flex h-40 items-center justify-center">
                    <p className="text-sm text-muted-foreground">
                      {t("common.noData")}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={80}
                            paddingAngle={3}
                            dataKey="value"
                            stroke="none"
                          >
                            {pieData.map((_entry, idx) => (
                              <Cell
                                key={idx}
                                fill={
                                  CHART_COLORS[idx % CHART_COLORS.length]
                                }
                              />
                            ))}
                          </Pie>
                          <RechartsTooltip
                            content={<ChartTooltip />}
                          />
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

                    {/* Per-service metrics table */}
                    <div className="mt-4 space-y-2">
                      {data.serviceAnalysis.map((svc, idx) => (
                        <div
                          key={svc.id}
                          className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                        >
                          <div
                            className="h-3 w-3 rounded-full shrink-0"
                            style={{
                              backgroundColor:
                                CHART_COLORS[idx % CHART_COLORS.length],
                            }}
                          />
                          <span className="text-sm font-medium flex-1 truncate">
                            {svc.name}
                          </span>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>
                              {t("analytics.wait")}: {svc.avgWait}m
                            </span>
                            <span>
                              {t("analytics.svc")}: {svc.avgService}m
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* 30-Day Trend Chart */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">
                      {t("analytics.trendTitle")}
                    </CardTitle>
                  </div>
                  {/* Predictive trend badge */}
                  <Badge
                    variant="outline"
                    className={`text-xs ${
                      data.trendDirection === "up"
                        ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                        : data.trendDirection === "down"
                          ? "border-red-500/30 text-red-600 dark:text-red-400"
                          : "border-muted-foreground/30 text-muted-foreground"
                    }`}
                  >
                    {data.trendDirection === "up" && (
                      <TrendingUp className="h-3 w-3 mr-1" />
                    )}
                    {data.trendDirection === "down" && (
                      <TrendingDown className="h-3 w-3 mr-1" />
                    )}
                    {data.trendDirection === "stable" && (
                      <Minus className="h-3 w-3 mr-1" />
                    )}
                    {t(`analytics.trend_${data.trendDirection}`)}
                  </Badge>
                </div>
                <CardDescription>
                  {t("analytics.trendDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.dailyTrend.length === 0 ? (
                  <div className="flex h-64 items-center justify-center">
                    <p className="text-sm text-muted-foreground">
                      {t("common.noData")}
                    </p>
                  </div>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={data.dailyTrend}>
                        <defs>
                          <linearGradient
                            id="gradServedTrend"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor="#10b981"
                              stopOpacity={0.3}
                            />
                            <stop
                              offset="100%"
                              stopColor="#10b981"
                              stopOpacity={0.02}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          className="stroke-border"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(d: string) => d.slice(5)}
                          tick={{ fontSize: 10 }}
                          className="fill-muted-foreground"
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          yAxisId="left"
                          tick={{ fontSize: 10 }}
                          className="fill-muted-foreground"
                          axisLine={false}
                          tickLine={false}
                          width={30}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          tick={{ fontSize: 10 }}
                          className="fill-muted-foreground"
                          axisLine={false}
                          tickLine={false}
                          width={30}
                        />
                        <RechartsTooltip
                          content={<ChartTooltip />}
                        />
                        <Area
                          yAxisId="left"
                          type="monotone"
                          dataKey="served"
                          name={t("analytics.dailyServed")}
                          stroke="#10b981"
                          strokeWidth={2}
                          fill="url(#gradServedTrend)"
                        />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="sma7"
                          name={t("analytics.sma7")}
                          stroke="#8b5cf6"
                          strokeWidth={2}
                          strokeDasharray="6 3"
                          dot={false}
                        />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="avgWait"
                          name={t("analytics.avgWaitOverlay")}
                          stroke="#f59e0b"
                          strokeWidth={1.5}
                          dot={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="flex items-center justify-center gap-5 mt-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="h-2 w-5 rounded bg-emerald-500/40" />
                    {t("analytics.dailyServed")}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="h-0.5 w-5 rounded border-t-2 border-dashed border-purple-500" />
                    {t("analytics.sma7")}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="h-0.5 w-5 rounded border-t-2 border-amber-500" />
                    {t("analytics.avgWaitOverlay")}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

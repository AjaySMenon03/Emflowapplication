/**
 * Admin Dashboard Page — Real-time overview with skeleton loading
 */
import { useEffect, useState, useCallback } from "react";
import { useLocaleStore } from "../../stores/locale-store";
import { useAuthStore } from "../../stores/auth-store";
import { api } from "../../lib/api";
import { useRealtime } from "../../lib/use-realtime";
import { DashboardSkeleton } from "../../components/loading-skeleton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import {
  Users,
  ListOrdered,
  Clock,
  TrendingUp,
  Building2,
  MapPin,
  PhoneForwarded,
} from "lucide-react";

export function DashboardPage() {
  const { t } = useLocaleStore();
  const { session, staffRecord, businessId } = useAuthStore();
  const accessToken = session?.access_token;

  const [business, setBusiness] = useState<any>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [waitingCount, setWaitingCount] = useState(0);
  const [servingCount, setServingCount] = useState(0);
  const [servedCount, setServedCount] = useState(0);
  const [avgWait, setAvgWait] = useState(0);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);

  const selectedLocationId = staffRecord?.locations?.[0] || null;

  useEffect(() => {
    async function loadBusiness() {
      if (!businessId || !accessToken) {
        setLoading(false);
        return;
      }
      const [{ data: bizData }, { data: locData }] = await Promise.all([
        api<{ business: any }>(`/business/${businessId}`, { accessToken }),
        api<{ locations: any[] }>(`/business/${businessId}/locations`, {
          accessToken,
        }),
      ]);
      if (bizData?.business) setBusiness(bizData.business);
      if (locData?.locations) setLocations(locData.locations);
      setLoading(false);
    }
    loadBusiness();
  }, [businessId, accessToken]);

  const fetchStats = useCallback(async () => {
    if (!selectedLocationId || !accessToken) return;
    const { data } = await api<{
      waiting: any[];
      serving: any[];
      completed: any[];
    }>(`/queue/entries/${selectedLocationId}`, { accessToken });

    if (data) {
      setWaitingCount(data.waiting.length);
      setServingCount(data.serving.length);
      setServedCount(data.completed.filter((e) => e.status === "served").length);

      const servedEntries = data.completed.filter(
        (e) => e.status === "served" && e.joined_at && e.called_at
      );
      if (servedEntries.length > 0) {
        const totalWait = servedEntries.reduce((acc: number, e: any) => {
          return acc + (new Date(e.called_at).getTime() - new Date(e.joined_at).getTime()) / 60000;
        }, 0);
        setAvgWait(Math.round(totalWait / servedEntries.length));
      }

      const recent = [
        ...data.serving.map((e: any) => ({ ...e, activityType: "serving" })),
        ...data.completed.slice(0, 5).map((e: any) => ({ ...e, activityType: e.status })),
      ]
        .sort(
          (a, b) =>
            new Date(b.called_at || b.joined_at).getTime() -
            new Date(a.called_at || a.joined_at).getTime()
        )
        .slice(0, 8);
      setRecentActivity(recent);
    }
  }, [selectedLocationId, accessToken]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useRealtime(selectedLocationId, () => {
    fetchStats();
  });

  const statusBadge: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    serving: { variant: "default", label: t("queue.serving") },
    served: { variant: "secondary", label: t("queue.served") },
    no_show: { variant: "destructive", label: t("queue.no_show") },
    cancelled: { variant: "outline", label: t("queue.cancelled") },
    waiting: { variant: "outline", label: t("queue.waiting") },
  };

  const stats = [
    {
      label: t("queue.waiting"),
      value: String(waitingCount),
      icon: ListOrdered,
      desc: t("queue.customersInQueue"),
      color: "text-blue-600 dark:text-blue-400",
      bgColor: "bg-blue-500/10",
    },
    {
      label: t("queue.serving"),
      value: String(servingCount),
      icon: PhoneForwarded,
      desc: t("queue.currentlyServing"),
      color: "text-emerald-600 dark:text-emerald-400",
      bgColor: "bg-emerald-500/10",
    },
    {
      label: t("reports.avgWaitTime"),
      value: `${avgWait}m`,
      icon: Clock,
      desc: t("reports.avgWaitTime"),
      color: "text-amber-600 dark:text-amber-400",
      bgColor: "bg-amber-500/10",
    },
    {
      label: t("reports.servedToday"),
      value: String(servedCount),
      icon: TrendingUp,
      desc: t("queue.completedServices"),
      color: "text-purple-600 dark:text-purple-400",
      bgColor: "bg-purple-500/10",
    },
  ];

  if (loading) return <DashboardSkeleton />;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("nav.dashboard")}</h1>
          <p className="text-muted-foreground text-sm">
            {business
              ? `${t("dashboard.welcome")}, ${staffRecord?.name || "Admin"}`
              : t("dashboard.overview")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {staffRecord?.role && (
            <Badge variant="secondary" className="capitalize">
              {t(`role.${staffRecord.role}`) || staffRecord.role}
            </Badge>
          )}
          {selectedLocationId && (
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-xs text-emerald-600 dark:text-emerald-400">
                {t("common.live")}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Business info card */}
      {business && (
        <Card className="transition-shadow hover:shadow-md">
          <CardContent className="flex flex-wrap items-center gap-6 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold">{business.name}</h3>
              <div className="flex flex-wrap items-center gap-3 mt-1">
                {business.industry && (
                  <span className="text-xs text-muted-foreground">
                    {business.industry}
                  </span>
                )}
                {locations.length > 0 && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {locations.length}{" "}
                    {locations.length !== 1
                      ? t("dashboard.locationsPlural")
                      : t("dashboard.locations")}
                  </span>
                )}
              </div>
            </div>
            <Badge
              variant="outline"
              className="border-emerald-500/30 text-emerald-600 dark:text-emerald-400 capitalize"
            >
              {business.status}
            </Badge>
          </CardContent>
        </Card>
      )}

      {/* Stats grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card
            key={stat.label}
            className="transition-all hover:shadow-md"
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground font-medium">
                    {stat.label}
                  </p>
                  <p className="text-3xl font-bold text-foreground mt-1 tracking-tight">
                    {stat.value}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {stat.desc}
                  </p>
                </div>
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.bgColor}`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("dashboard.recentActivity")}</CardTitle>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center rounded-xl border-2 border-dashed border-border gap-2">
              <Users className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm">
                {t("dashboard.noActivity")}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {recentActivity.map((entry) => {
                const badge = statusBadge[entry.status] || statusBadge.waiting;
                return (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-accent/30"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-semibold text-xs">
                      {entry.ticket_number}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate font-medium">
                        {entry.customer_name || t("queue.walkIn")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {entry.queue_type_name || t("queue.general")}
                      </p>
                    </div>
                    <Badge variant={badge.variant} className="text-[0.6rem] shrink-0">
                      {badge.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(entry.called_at || entry.joined_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

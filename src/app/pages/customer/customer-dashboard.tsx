/**
 * Customer Dashboard — /customer
 * Premium SaaS dashboard showing visit stats, retention boosters, and quick actions.
 */
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import {
  Calendar,
  Clock,
  BarChart3,
  AlertTriangle,
  TrendingUp,
  Star,
  ArrowRight,
  Activity,
  HandHeart,
  History,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Skeleton } from "../../components/ui/skeleton";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/auth-store";
import { useLocaleStore } from "../../stores/locale-store";

interface CustomerSummary {
  totalVisits: number;
  avgWaitTime: number;
  avgServiceTime: number;
  noShowCount: number;
  noShowRate: number;
  cancelledCount: number;
  lastVisitDate: string | null;
  mostUsedService: { id: string; name: string; count: number } | null;
  daysSinceLastVisit: number | null;
}

/** Animated counter hook */
function useAnimatedCounter(end: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const frameRef = useRef<number>();

  useEffect(() => {
    if (end === 0) { setValue(0); return; }
    const start = 0;
    const startTime = performance.now();

    function step(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(start + (end - start) * eased));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      }
    }

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [end, duration]);

  return value;
}

function StatCard({
  icon: Icon,
  label,
  value,
  suffix,
  gradient,
  delay = 0,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  suffix?: string;
  gradient: string;
  delay?: number;
}) {
  const animatedValue = useAnimatedCounter(value);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
    >
      <Card className="overflow-hidden border-0 shadow-md hover:shadow-lg transition-shadow duration-300">
        <div className={`h-1 ${gradient}`} />
        <CardContent className="pt-5 pb-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {label}
              </p>
              <p className="text-3xl font-bold text-foreground mt-1.5 tabular-nums">
                {animatedValue}
                {suffix && (
                  <span className="text-base font-normal text-muted-foreground ml-1">
                    {suffix}
                  </span>
                )}
              </p>
            </div>
            <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${gradient} bg-opacity-10`}>
              <Icon className="h-5 w-5 text-white" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function CustomerDashboard() {
  const { session, user } = useAuthStore();
  const { t } = useLocaleStore();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (!session?.access_token) return;
      setLoading(true);
      const { data, error: err } = await api<CustomerSummary>("/customer/summary", {
        accessToken: session.access_token,
      });
      if (err) {
        setError(err);
      } else if (data) {
        setSummary(data);
      }
      setLoading(false);
    }
    load();
  }, [session?.access_token]);

  const customerName =
    user?.user_metadata?.name || user?.email?.split("@")[0] || t("customer.defaultName");

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-lg font-semibold text-foreground mb-2">{t("common.error")}</h2>
        <p className="text-muted-foreground text-sm mb-4">{error}</p>
        <Button onClick={() => window.location.reload()}>{t("common.retry")}</Button>
      </div>
    );
  }

  const s = summary!;
  const showMissYou = s.daysSinceLastVisit !== null && s.daysSinceLastVisit > 30;
  const showNoShowWarning = s.noShowRate > 30;

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
          {t("customer.welcomeBack")}, {customerName}!
        </h1>
        <p className="text-muted-foreground mt-1">{t("customer.dashboardSubtitle")}</p>
      </motion.div>

      {/* Retention Boosters */}
      {(showMissYou || showNoShowWarning) && (
        <div className="space-y-3">
          {showMissYou && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <Card className="border-amber-200 dark:border-amber-800 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border-0 shadow-sm">
                <CardContent className="py-4 flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50 shrink-0">
                    <HandHeart className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      {t("customer.missYou")}
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                      {t("customer.lastVisitDaysAgo").replace("{days}", String(s.daysSinceLastVisit))}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 shrink-0"
                    onClick={() => navigate("/")}
                  >
                    {t("customer.visitAgain")}
                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {showNoShowWarning && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
            >
              <Card className="border-blue-200 dark:border-blue-800 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-0 shadow-sm">
                <CardContent className="py-4 flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50 shrink-0">
                    <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                      {t("customer.noShowReminder")}
                    </p>
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                      {t("customer.noShowReminderDesc")}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </div>
      )}

      {/* Stats Grid */}
      {s.totalVisits > 0 ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={BarChart3}
              label={t("customer.totalVisits")}
              value={s.totalVisits}
              gradient="bg-gradient-to-r from-violet-500 to-purple-500"
              delay={0.1}
            />
            <StatCard
              icon={Clock}
              label={t("customer.avgWaitTime")}
              value={s.avgWaitTime}
              suffix={t("queue.min")}
              gradient="bg-gradient-to-r from-blue-500 to-cyan-500"
              delay={0.2}
            />
            <StatCard
              icon={Activity}
              label={t("customer.avgServiceTime")}
              value={s.avgServiceTime}
              suffix={t("queue.min")}
              gradient="bg-gradient-to-r from-emerald-500 to-teal-500"
              delay={0.3}
            />
            <StatCard
              icon={AlertTriangle}
              label={t("customer.noShowCount")}
              value={s.noShowCount}
              gradient="bg-gradient-to-r from-orange-500 to-red-500"
              delay={0.4}
            />
          </div>

          {/* Details Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Most Used Service */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.5 }}
            >
              <Card className="h-full border-0 shadow-md">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Star className="h-4 w-4 text-amber-500" />
                    {t("customer.favoriteService")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {s.mostUsedService ? (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xl font-bold text-foreground">
                          {s.mostUsedService.name}
                        </p>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {s.mostUsedService.count} {t("customer.timesUsed")}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        <TrendingUp className="h-3 w-3 mr-1" />
                        {t("customer.mostPopular")}
                      </Badge>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("common.noData")}</p>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Last Visit */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.6 }}
            >
              <Card className="h-full border-0 shadow-md">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-blue-500" />
                    {t("customer.lastVisit")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {s.lastVisitDate ? (
                    <div>
                      <p className="text-xl font-bold text-foreground">
                        {new Date(s.lastVisitDate).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </p>
                      {s.daysSinceLastVisit !== null && (
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {s.daysSinceLastVisit === 0
                            ? t("common.today")
                            : `${s.daysSinceLastVisit} ${t("customer.daysAgo")}`}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("common.noData")}</p>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Quick Actions */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.7 }}
            className="flex flex-wrap gap-3"
          >
            <Button
              onClick={() => navigate("/customer/history")}
              variant="outline"
              className="gap-2"
            >
              <History className="h-4 w-4" />
              {t("customer.viewHistory")}
            </Button>
            <Button
              onClick={() => navigate("/customer/profile")}
              variant="outline"
              className="gap-2"
            >
              <Star className="h-4 w-4" />
              {t("customer.editProfile")}
            </Button>
          </motion.div>
        </>
      ) : (
        /* Empty state */
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <Card className="border-0 shadow-md">
            <CardContent className="py-16 text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-accent/20 mb-6">
                <BarChart3 className="h-10 w-10 text-primary/60" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {t("customer.noVisitsTitle")}
              </h3>
              <p className="text-muted-foreground text-sm max-w-sm mx-auto mb-6">
                {t("customer.noVisitsDesc")}
              </p>
              <Button
                onClick={() => navigate("/")}
                className="gap-2"
              >
                {t("customer.joinFirstQueue")}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

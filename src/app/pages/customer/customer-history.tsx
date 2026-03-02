/**
 * Customer Visit History — /customer/history
 * Paginated card/table with filters for location, service, date range.
 */
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Clock,
  MapPin,
  Filter,
  ChevronLeft,
  ChevronRight,
  Calendar,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  Ticket,
  Loader2,
  Search,
} from "lucide-react";
import {
  Card,
  CardContent,
} from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/auth-store";
import { useLocaleStore } from "../../stores/locale-store";

interface HistoryEntry {
  id: string;
  ticket_number: string;
  status: string;
  queue_type_name: string;
  queue_type_id: string;
  location_id: string;
  location_name: string;
  joined_at: string;
  called_at: string | null;
  served_at: string | null;
  cancelled_at: string | null;
  customer_name: string;
}

interface FilterOption {
  id: string;
  name: string;
}

const statusConfig: Record<string, { icon: React.ElementType; color: string; bgColor: string }> = {
  served: { icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-400", bgColor: "bg-emerald-100 dark:bg-emerald-900/30" },
  cancelled: { icon: XCircle, color: "text-red-600 dark:text-red-400", bgColor: "bg-red-100 dark:bg-red-900/30" },
  no_show: { icon: AlertTriangle, color: "text-amber-600 dark:text-amber-400", bgColor: "bg-amber-100 dark:bg-amber-900/30" },
  waiting: { icon: Clock, color: "text-blue-600 dark:text-blue-400", bgColor: "bg-blue-100 dark:bg-blue-900/30" },
  serving: { icon: Activity, color: "text-violet-600 dark:text-violet-400", bgColor: "bg-violet-100 dark:bg-violet-900/30" },
  next: { icon: Activity, color: "text-violet-600 dark:text-violet-400", bgColor: "bg-violet-100 dark:bg-violet-900/30" },
};

function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "<1 min";
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

export function CustomerHistory() {
  const { session } = useAuthStore();
  const { t } = useLocaleStore();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [locationFilter, setLocationFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [locationOptions, setLocationOptions] = useState<FilterOption[]>([]);
  const [serviceOptions, setServiceOptions] = useState<FilterOption[]>([]);

  const limit = 10;

  const fetchHistory = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);

    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));
    if (locationFilter !== "all") params.set("locationId", locationFilter);
    if (serviceFilter !== "all") params.set("queueTypeId", serviceFilter);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);

    const { data, error } = await api<{
      entries: HistoryEntry[];
      total: number;
      filters: { locations: FilterOption[]; services: FilterOption[] };
    }>(`/customer/history?${params.toString()}`, {
      accessToken: session.access_token,
    });

    if (data) {
      setEntries(data.entries);
      setTotal(data.total);
      setLocationOptions(data.filters.locations);
      setServiceOptions(data.filters.services);
    }
    if (error) console.error("History fetch error:", error);
    setLoading(false);
  }, [session?.access_token, page, locationFilter, serviceFilter, startDate, endDate]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const totalPages = Math.ceil(total / limit);

  const handleClearFilters = () => {
    setLocationFilter("all");
    setServiceFilter("all");
    setStartDate("");
    setEndDate("");
    setPage(0);
  };

  const hasActiveFilters = locationFilter !== "all" || serviceFilter !== "all" || startDate || endDate;

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center justify-between flex-wrap gap-3"
      >
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("customer.historyTitle")}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {total > 0 ? `${total} ${t("customer.totalEntries")}` : t("customer.noHistory")}
          </p>
        </div>
        <Button
          variant={filtersOpen ? "secondary" : "outline"}
          size="sm"
          onClick={() => setFiltersOpen(!filtersOpen)}
          className="gap-2"
        >
          <Filter className="h-4 w-4" />
          {t("common.filter")}
          {hasActiveFilters && (
            <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
              !
            </span>
          )}
        </Button>
      </motion.div>

      {/* Filters */}
      <AnimatePresence>
        {filtersOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-5 pb-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("customer.filterLocation")}</Label>
                    <Select value={locationFilter} onValueChange={(v) => { setLocationFilter(v); setPage(0); }}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder={t("common.all")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("common.all")}</SelectItem>
                        {locationOptions.map((loc) => (
                          <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("customer.filterService")}</Label>
                    <Select value={serviceFilter} onValueChange={(v) => { setServiceFilter(v); setPage(0); }}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder={t("common.all")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("common.all")}</SelectItem>
                        {serviceOptions.map((svc) => (
                          <SelectItem key={svc.id} value={svc.id}>{svc.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("customer.filterStartDate")}</Label>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => { setStartDate(e.target.value); setPage(0); }}
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("customer.filterEndDate")}</Label>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => { setEndDate(e.target.value); setPage(0); }}
                      className="h-9"
                    />
                  </div>
                </div>
                {hasActiveFilters && (
                  <div className="mt-3 flex justify-end">
                    <Button variant="ghost" size="sm" onClick={handleClearFilters}>
                      {t("customer.clearFilters")}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Entries */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <Card className="border-0 shadow-md">
            <CardContent className="py-16 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50 mb-4">
                <Search className="h-8 w-8 text-muted-foreground/50" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-1">{t("customer.noVisitsTitle")}</h3>
              <p className="text-muted-foreground text-sm">
                {hasActiveFilters ? t("customer.noFilterResults") : t("customer.noVisitsDesc")}
              </p>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {entries.map((entry, idx) => {
              const sc = statusConfig[entry.status] || statusConfig.waiting;
              const StatusIcon = sc.icon;

              const waitTime = entry.called_at && entry.joined_at
                ? new Date(entry.called_at).getTime() - new Date(entry.joined_at).getTime()
                : null;
              const serviceTime = entry.served_at && entry.called_at
                ? new Date(entry.served_at).getTime() - new Date(entry.called_at).getTime()
                : null;

              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3, delay: idx * 0.05 }}
                >
                  <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-200">
                    <CardContent className="py-4">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        {/* Status icon */}
                        <div className={`flex h-10 w-10 items-center justify-center rounded-xl shrink-0 ${sc.bgColor}`}>
                          <StatusIcon className={`h-5 w-5 ${sc.color}`} />
                        </div>

                        {/* Main info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-foreground text-sm">
                              {entry.ticket_number}
                            </span>
                            <Badge variant="outline" className="text-[10px] h-5 px-1.5 capitalize">
                              {t(`queue.${entry.status}`) || entry.status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1">
                              <Ticket className="h-3 w-3" />
                              {entry.queue_type_name}
                            </span>
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {entry.location_name}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(entry.joined_at).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </span>
                          </div>
                        </div>

                        {/* Times */}
                        <div className="flex items-center gap-4 text-xs sm:text-right shrink-0">
                          {waitTime !== null && (
                            <div>
                              <p className="text-muted-foreground">{t("customer.waitTime")}</p>
                              <p className="font-medium text-foreground">{formatDuration(waitTime)}</p>
                            </div>
                          )}
                          {serviceTime !== null && (
                            <div>
                              <p className="text-muted-foreground">{t("customer.serviceTime")}</p>
                              <p className="font-medium text-foreground">{formatDuration(serviceTime)}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex items-center justify-between pt-2"
        >
          <p className="text-xs text-muted-foreground">
            {t("customer.showingRange")
              .replace("{start}", String(page * limit + 1))
              .replace("{end}", String(Math.min((page + 1) * limit, total)))
              .replace("{total}", String(total))}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              {page + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

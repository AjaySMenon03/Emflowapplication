/**
 * Customer Status Page — /status/:entryId
 *
 * Premium-tone real-time status page showing:
 * - Ticket number
 * - Position in queue
 * - Estimated wait time
 * - Cancel button
 * - Share link
 * - Realtime updates via polling
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router";
import { api } from "../../lib/api";
import { useRealtimePublic } from "../../lib/use-realtime";
import {
  useLocaleStore,
  type Locale,
  LOCALE_LABELS,
} from "../../stores/locale-store";
import { usePushNotifications } from "../../lib/use-pwa";
import {
  useNetworkStatus,
  cacheSet,
  cacheGet,
} from "../../lib/use-network-status";
import { OfflineBanner } from "../../components/offline-banner";
import { enqueue } from "../../lib/offline-queue";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Zap,
  Loader2,
  Clock,
  Users,
  MapPin,
  Share2,
  X,
  CheckCircle2,
  AlertTriangle,
  Globe,
  Copy,
  PartyPopper,
  Ban,
  Bell,
  BellOff,
  Wifi,
  WifiOff,
  Megaphone,
} from "lucide-react";

interface StatusData {
  entry: {
    id: string;
    ticket_number: string;
    status: string;
    queue_type_name: string | null;
    joined_at: string;
    called_at: string | null;
    customer_name: string | null;
    location_id: string;
  };
  position: number;
  totalWaiting: number;
  estimatedMinutes: number;
  location: { name: string; address: string | null } | null;
  businessName: string | null;
}

const STATUS_CONFIG: Record<
  string,
  {
    color: string;
    bg: string;
    icon: typeof CheckCircle2;
    title: string;
    message: string;
  }
> = {
  waiting: {
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-500/10",
    icon: Clock,
    title: "You're in the queue",
    message: "Please stay nearby. We'll update your status in real-time.",
  },
  next: {
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10",
    icon: PartyPopper,
    title: "You've been called!",
    message: "Please proceed to the service counter — you're next in line.",
  },
  serving: {
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10",
    icon: PartyPopper,
    title: "It's your turn!",
    message: "Please proceed to the service counter now.",
  },
  served: {
    color: "text-gray-600 dark:text-gray-400",
    bg: "bg-gray-500/10",
    icon: CheckCircle2,
    title: "Service Complete",
    message: "Thank you for visiting. We hope to see you again!",
  },
  cancelled: {
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10",
    icon: Ban,
    title: "Cancelled",
    message: "This queue entry has been cancelled.",
  },
  no_show: {
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/10",
    icon: AlertTriangle,
    title: "Missed",
    message: "You were called but didn't arrive. Please rejoin if needed.",
  },
  waitlisted: {
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10",
    icon: Clock,
    title: "You're in Waiting list",
    message:
      "The maximum customer count is reached. You are in the waiting list. If any of the confirmed customers is no-show or canceled, you will be considered as next.",
  },
};

export function StatusPage() {
  const { entryId } = useParams<{ entryId: string }>();
  const { locale, setLocale, t } = useLocaleStore();
  const { showNotification, permission, requestPermission } =
    usePushNotifications();

  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const prevStatusRef = useRef<string | null>(null);

  // Emergency broadcast state
  const [broadcastNotice, setBroadcastNotice] = useState<string | null>(null);

  // ── Offline Resilience ──
  const STATUS_CACHE_KEY = `customer-status:${entryId}`;
  const { isOnline, isReconnecting, lastSyncedAt, markSynced } =
    useNetworkStatus({
      onReconnect: () => {
        fetchStatus();
      },
    });

  // Cache status data when online
  useEffect(() => {
    if (data && isOnline) {
      cacheSet(STATUS_CACHE_KEY, data);
    }
  }, [data, isOnline]);

  // Restore from cache on mount if offline
  useEffect(() => {
    if (!isOnline && !data && entryId) {
      const cached = cacheGet<StatusData>(STATUS_CACHE_KEY);
      if (cached?.data) {
        setData(cached.data);
        setLoading(false);
      }
    }
  }, [isOnline, entryId]);

  const fetchStatus = useCallback(async () => {
    if (!entryId) return;
    try {
      const { data: statusData, error: apiErr } = await api<StatusData>(
        `/public/queue/status/${entryId}`,
      );
      if (apiErr || !statusData) {
        if (!data) setError(apiErr || "Entry not found");
        return;
      }

      // ── Push notification on status transition to "serving" ──
      const prevStatus = prevStatusRef.current;
      const newStatus = statusData.entry.status;
      if (prevStatus && prevStatus !== newStatus) {
        if (newStatus === "next") {
          showNotification("📢 You've been called!", {
            body: `Ticket ${statusData.entry.ticket_number} — Please proceed to the counter.`,
            tag: "your-turn",
            data: { entryId, url: window.location.href },
            requireInteraction: true,
          });
        } else if (newStatus === "serving") {
          showNotification("🎉 It's your turn!", {
            body: `Ticket ${statusData.entry.ticket_number} — You're now being served.`,
            tag: "your-turn",
            data: { entryId, url: window.location.href },
            requireInteraction: true,
          });
        } else if (newStatus === "served") {
          showNotification("✅ Service Complete", {
            body: `Thank you for visiting, ${statusData.entry.customer_name || "Customer"}!`,
            tag: "service-complete",
          });
        }
      }
      prevStatusRef.current = newStatus;

      setData(statusData);
      setError("");
      markSynced();

      // Fetch emergency broadcast for this location
      if (statusData.entry.location_id) {
        const { data: emergencyData } = await api<{
          paused: boolean;
          broadcast: string | null;
        }>(`/public/emergency/${statusData.entry.location_id}`);
        if (emergencyData) {
          setBroadcastNotice(emergencyData.broadcast);
        }
      }
    } catch {
      if (!data) setError("Failed to load status");
    } finally {
      setLoading(false);
    }
  }, [entryId, showNotification, markSynced]);

  // Initial load
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Realtime updates
  useRealtimePublic(data?.entry?.location_id, () => {
    fetchStatus();
  });

  const handleCancel = async () => {
    if (!entryId) return;
    setCancelling(true);

    // If offline → enqueue + optimistic UI
    if (!isOnline) {
      enqueue(`/public/queue/cancel/${entryId}`, {
        method: "POST",
        label: `Cancel ticket ${data?.entry?.ticket_number || entryId}`,
      });
      // Optimistic: update local state to show cancelled
      if (data) {
        setData({ ...data, entry: { ...data.entry, status: "cancelled" } });
      }
      toast.info(t("offline.actionQueued"));
      setCancelling(false);
      return;
    }

    try {
      const { error: apiErr } = await api(`/public/queue/cancel/${entryId}`, {
        method: "POST",
      });
      if (apiErr) {
        setError(apiErr);
        return;
      }
      await fetchStatus();
    } catch {
      setError("Failed to cancel");
    } finally {
      setCancelling(false);
    }
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Queue Status — ${data?.entry?.ticket_number}`,
          text: `Track my queue position: ${data?.entry?.ticket_number}`,
          url,
        });
      } catch {
        // User cancelled share
      }
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
            <Zap className="h-7 w-7 text-primary-foreground" />
          </div>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Loading your status...
          </p>
        </div>
      </div>
    );
  }

  // ── Error / not found ──
  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="py-12">
            <AlertTriangle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-foreground mb-2">Entry Not Found</h2>
            <p className="text-muted-foreground text-sm">
              {error || "This queue entry doesn't exist or has expired."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const status = data.entry.status;
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.waiting;
  const StatusIcon = config.icon;
  const isActive =
    status === "waiting" ||
    status === "next" ||
    status === "serving" ||
    status === "waitlisted";

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background">
      {/* Top bar */}
      <div className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-sm font-medium text-foreground">
              {data.businessName || "EM Flow"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            <Select
              value={locale}
              onValueChange={(v) => setLocale(v as Locale)}
            >
              <SelectTrigger className="h-8 w-24 text-xs border-0 bg-transparent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(LOCALE_LABELS) as Locale[]).map((loc) => (
                  <SelectItem key={loc} value={loc} className="text-xs">
                    {LOCALE_LABELS[loc].nativeLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-lg px-4 py-6 sm:py-10 space-y-5">
        {/* Offline Banner */}
        <OfflineBanner
          isOnline={isOnline}
          isReconnecting={isReconnecting}
          lastSyncedAt={lastSyncedAt}
        />

        {/* Error banner */}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
            <p className="text-destructive text-sm">{error}</p>
          </div>
        )}

        {/* Broadcast notice */}
        {broadcastNotice && (
          <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <Megaphone className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">
                  {t("emergency.noticeLabel")}
                </span>
                <p className="text-sm text-blue-700 dark:text-blue-300 mt-0.5">
                  {broadcastNotice}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Ticket number hero */}
        <Card className="overflow-hidden">
          <div className={`${config.bg} px-6 py-8 text-center`}>
            <div
              className={`mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full ${config.bg}`}
            >
              <StatusIcon className={`h-8 w-8 ${config.color}`} />
            </div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              {data.entry.queue_type_name || "Queue"}
            </p>
            {status === "waitlisted" && (
              <h1
                className={`text-5xl font-bold tracking-tight ${config.color} mb-2`}
              >
                {data.entry.ticket_number}
              </h1>
            )}
            <p className="text-foreground font-medium">{config.title}</p>
            <p className="text-muted-foreground text-sm mt-1">
              {config.message}
            </p>
          </div>

          {/* Stats */}
          {isActive && status !== "waitlisted" && (
            <CardContent className="p-0">
              <div className="grid grid-cols-2 divide-x divide-border">
                <div className="px-6 py-5 text-center">
                  <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
                    <Users className="h-3.5 w-3.5" />
                    <span className="text-xs uppercase tracking-wider">
                      Position
                    </span>
                  </div>
                  <p className="text-3xl font-bold text-foreground">
                    {status === "serving" || status === "next"
                      ? "Next!"
                      : `#${data.position}`}
                  </p>
                  {status === "waiting" && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      of {data.totalWaiting} waiting
                    </p>
                  )}
                </div>
                <div className="px-6 py-5 text-center">
                  <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="text-xs uppercase tracking-wider">
                      Est. Wait
                    </span>
                  </div>
                  <p className="text-3xl font-bold text-foreground">
                    {status === "serving" || status === "next"
                      ? "0"
                      : data.estimatedMinutes}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    minutes
                  </p>
                </div>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Location info */}
        {data.location && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground justify-center">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span>
              {data.location.name}
              {data.location.address ? ` — ${data.location.address}` : ""}
            </span>
          </div>
        )}

        {/* Customer greeting */}
        {data.entry.customer_name && (
          <p className="text-center text-sm text-muted-foreground">
            Welcome,{" "}
            <span className="text-foreground font-medium">
              {data.entry.customer_name}
            </span>
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={handleShare}>
            {copied ? (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" />
                Copied!
              </>
            ) : (
              <>
                {navigator.share ? (
                  <Share2 className="mr-2 h-4 w-4" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                Share
              </>
            )}
          </Button>

          {(status === "waiting" || status === "waitlisted") && (
            <Button
              variant="outline"
              className="flex-1 border-destructive/30 text-destructive hover:bg-destructive/10"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <X className="mr-2 h-4 w-4" />
              )}
              Cancel
            </Button>
          )}
        </div>

        {/* Notification opt-in */}
        {isActive && permission !== "granted" && "Notification" in window && (
          <button
            onClick={requestPermission}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 text-sm text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors"
          >
            <Bell className="h-4 w-4" />
            <span>Enable notifications to know when it's your turn</span>
          </button>
        )}
        {isActive && permission === "granted" && (
          <div className="flex items-center justify-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <Bell className="h-3.5 w-3.5" />
            <span>
              Notifications enabled — we'll alert you when it's your turn
            </span>
          </div>
        )}

        {/* Joined time */}
        <p className="text-center text-xs text-muted-foreground">
          Joined at{" "}
          {new Date(data.entry.joined_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {isActive && (
            <span className="inline-flex items-center gap-1 ml-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-emerald-600 dark:text-emerald-400">
                Live
              </span>
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

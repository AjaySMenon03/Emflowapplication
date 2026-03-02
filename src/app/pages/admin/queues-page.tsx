/**
 * Staff Queue Dashboard — /admin/queues
 *
 * Role-based access:
 *   OWNER  → full access (call, mark, reorder, reassign)
 *   ADMIN  → reorder + reassign + call + mark
 *   STAFF  → call next + mark served/no-show only
 *
 * Features:
 *   - Select location / queue type
 *   - View today's entries (waiting / serving / completed)
 *   - Call next, mark served, mark no-show
 *   - Reorder entries (owner/admin)
 *   - Reassign staff (owner/admin)
 *   - Optimistic UI + realtime polling
 *   - Mobile-first responsive
 */
import { useState, useEffect, useCallback } from "react";
import { useLocaleStore } from "../../stores/locale-store";
import { useAuthStore } from "../../stores/auth-store";
import { api } from "../../lib/api";
import { useRealtime } from "../../lib/use-realtime";
import { useNetworkStatus, cacheSet, cacheGet } from "../../lib/use-network-status";
import { OfflineBanner } from "../../components/offline-banner";
import { OfflineQueueDrawer } from "../../components/offline-queue-drawer";
import { EmergencyControlsPanel } from "../../components/emergency-controls";
import { enqueue, getPendingCount, replay } from "../../lib/offline-queue";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import { Separator } from "../../components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import {
  Loader2,
  PhoneForwarded,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  AlertTriangle,
  ListOrdered,
  MapPin,
  Copy,
  ArrowUp,
  ArrowDown,
  UserRoundCog,
  Shield,
  ShieldCheck,
  ShieldAlert,
  ExternalLink,
  Hash,
  Phone,
  PlayCircle,
  SkipBack,
  UploadCloud,
} from "lucide-react";

// ── Types ──

interface QueueEntry {
  id: string;
  ticket_number: string;
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  queue_type_name: string | null;
  queue_type_prefix: string | null;
  queue_type_id: string;
  queue_session_id: string;
  joined_at: string;
  called_at: string | null;
  served_at: string | null;
  priority: number;
  location_id: string;
  business_id: string;
  served_by: string | null;
}

interface QueueTypeInfo {
  id: string;
  name: string;
  prefix: string;
  location_id: string;
  estimated_service_time: number;
}

interface StaffMember {
  auth_user_id: string;
  name: string;
  email: string;
  role: string;
  locations: string[];
}

type StaffRole = "owner" | "admin" | "staff";

// ── Role permission helpers ──

function canReorder(role: StaffRole): boolean {
  return role === "owner" || role === "admin";
}
function canReassign(role: StaffRole): boolean {
  return role === "owner" || role === "admin";
}
function canCallAndMark(_role: StaffRole): boolean {
  return true; // All roles can call/mark
}

const ROLE_BADGES: Record<string, { icon: typeof Shield; color: string; label: string }> = {
  owner: { icon: ShieldCheck, color: "text-amber-500", label: "Owner" },
  admin: { icon: ShieldAlert, color: "text-blue-500", label: "Admin" },
  staff: { icon: Shield, color: "text-muted-foreground", label: "Staff" },
};

// ══════════════════════════════════════════════

export function QueuesPage() {
  const { t } = useLocaleStore();
  const { session, staffRecord, businessId } = useAuthStore();
  const accessToken = session?.access_token;
  const myRole = (staffRecord?.role || "staff") as StaffRole;

  const [locations, setLocations] = useState<any[]>([]);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [queueTypes, setQueueTypes] = useState<QueueTypeInfo[]>([]);
  const [selectedQueueType, setSelectedQueueType] = useState("all");

  const [waiting, setWaiting] = useState<QueueEntry[]>([]);
  const [nextEntries, setNextEntries] = useState<QueueEntry[]>([]);
  const [serving, setServing] = useState<QueueEntry[]>([]);
  const [completed, setCompleted] = useState<QueueEntry[]>([]);

  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [copiedSlug, setCopiedSlug] = useState(false);

  // Reassign dialog
  const [reassignEntry, setReassignEntry] = useState<QueueEntry | null>(null);

  // ── Offline Queue Drawer ──
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(() => getPendingCount());

  // ── Offline Resilience ──
  const CACHE_KEY = `staff-queue:${selectedLocation}`;
  const { isOnline, isReconnecting, lastSyncedAt, markSynced } = useNetworkStatus({
    onReconnect: async () => {
      // Replay any queued mutations first, then refresh
      if (accessToken) {
        const pending = getPendingCount();
        if (pending > 0) {
          const result = await replay(accessToken);
          if (result.succeeded > 0) {
            toast.success(
              t("offline.replaySuccess").replace("{succeeded}", String(result.succeeded))
            );
          }
          if (result.failed > 0) {
            toast.error(
              t("offline.replayPartial")
                .replace("{succeeded}", String(result.succeeded))
                .replace("{total}", String(result.total))
                .replace("{failed}", String(result.failed))
            );
          }
        }
      }
      fetchEntries();
    },
  });

  // Refresh pending count whenever drawer state or online state changes
  useEffect(() => {
    setPendingCount(getPendingCount());
  }, [drawerOpen, isOnline]);

  // Cache entries whenever they update (and we're online)
  useEffect(() => {
    if (!selectedLocation || !isOnline) return;
    if (waiting.length || nextEntries.length || serving.length || completed.length) {
      cacheSet(CACHE_KEY, { waiting, next: nextEntries, serving, completed });
    }
  }, [waiting, nextEntries, serving, completed, selectedLocation, isOnline]);

  // Restore from cache on initial load if offline
  useEffect(() => {
    if (!isOnline && selectedLocation && !waiting.length && !serving.length) {
      const cached = cacheGet<{ waiting: QueueEntry[]; next: QueueEntry[]; serving: QueueEntry[]; completed: QueueEntry[] }>(CACHE_KEY);
      if (cached?.data) {
        setWaiting(cached.data.waiting || []);
        setNextEntries(cached.data.next || []);
        setServing(cached.data.serving || []);
        setCompleted(cached.data.completed || []);
      }
    }
  }, [isOnline, selectedLocation]);

  // Block mutations when offline
  const guardOnline = (action: string): boolean => {
    if (!isOnline) {
      toast.error(t("offline.mutationBlocked"));
      return false;
    }
    return true;
  };

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
        const firstAllowed =
          data.locations.find((l: any) => staffLocs.includes(l.id)) ||
          data.locations[0];
        if (firstAllowed) setSelectedLocation(firstAllowed.id);
      }
      setLoading(false);
    })();
  }, [businessId, accessToken, staffRecord]);

  // ── Load queue types + staff when location changes ──
  useEffect(() => {
    if (!selectedLocation || !accessToken) return;
    (async () => {
      const [{ data: qtData }, { data: staffData }] = await Promise.all([
        api<{ queueTypes: QueueTypeInfo[] }>(
          `/queue/types/${selectedLocation}`,
          { accessToken }
        ),
        api<{ staff: StaffMember[] }>(
          `/business/${businessId}/staff`,
          { accessToken }
        ),
      ]);
      if (qtData?.queueTypes) setQueueTypes(qtData.queueTypes);
      if (staffData?.staff) setStaffList(staffData.staff);
    })();
  }, [selectedLocation, accessToken, businessId]);

  // ── Fetch entries ──
  const fetchEntries = useCallback(async () => {
    if (!selectedLocation || !accessToken) return;
    const { data, error: apiErr } = await api<{
      waiting: QueueEntry[];
      next: QueueEntry[];
      serving: QueueEntry[];
      completed: QueueEntry[];
    }>(`/queue/entries/${selectedLocation}`, { accessToken });

    if (apiErr) {
      setError(apiErr);
      return;
    }
    if (data) {
      setWaiting(data.waiting || []);
      setNextEntries(data.next || []);
      setServing(data.serving || []);
      setCompleted(data.completed || []);
      setError("");
      markSynced();
    }
  }, [selectedLocation, accessToken, markSynced]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // ── Realtime ──
  useRealtime(selectedLocation, () => {
    fetchEntries();
  });

  // ── Clear success message after 3s ──
  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(""), 3000);
      return () => clearTimeout(t);
    }
  }, [successMsg]);

  // ══════════════════════════════════════════════
  // STAFF ACTIONS
  // ══════════════════════════════════════════════

  const handleCallNext = async (queueTypeId: string) => {
    if (!accessToken || !guardOnline("call next")) return;
    setActionLoading(`call-${queueTypeId}`);
    setError("");

    const location = locations.find((l) => l.id === selectedLocation);
    const { data: sessionData } = await api<{ session: { id: string } }>(
      "/queue/session",
      {
        method: "POST",
        accessToken,
        body: {
          queueTypeId,
          locationId: selectedLocation,
          businessId: location?.business_id || businessId,
        },
      }
    );

    if (!sessionData?.session?.id) {
      setError("Failed to get queue session");
      setActionLoading(null);
      return;
    }

    const { data, error: apiErr } = await api<{
      entry: QueueEntry | null;
      message?: string;
    }>("/queue/call-next", {
      method: "POST",
      accessToken,
      body: { queueTypeId, sessionId: sessionData.session.id },
    });

    if (apiErr) {
      setError(apiErr);
    } else if (data?.entry) {
      setWaiting((prev) => prev.filter((e) => e.id !== data.entry!.id));
      // callNext now returns status "next", move previous NEXT back to waiting
      setNextEntries((prev) => {
        const demoted = prev.filter((e) => e.queue_type_id === data.entry!.queue_type_id);
        if (demoted.length > 0) {
          setWaiting((w) => [...demoted.map((e) => ({ ...e, status: "waiting" })), ...w]);
        }
        return [data.entry!, ...prev.filter((e) => e.queue_type_id !== data.entry!.queue_type_id)];
      });
      setSuccessMsg(`Called ${data.entry.ticket_number}`);
    } else {
      setError(data?.message || "No customers waiting");
    }
    setActionLoading(null);
  };

  const handleStartServing = async (entryId: string) => {
    if (!accessToken) return;
    setActionLoading(`start-${entryId}`);
    const entry = nextEntries.find((e) => e.id === entryId);
    // Optimistic UI
    if (entry) {
      setNextEntries((prev) => prev.filter((e) => e.id !== entryId));
      setServing((prev) => [{ ...entry, status: "serving" }, ...prev]);
    }
    // If offline → enqueue + toast
    if (!isOnline) {
      enqueue(`/queue/start-serving/${entryId}`, {
        method: "POST",
        label: `Start serving ${entry?.ticket_number || entryId}`,
      });
      toast.info(t("offline.actionQueued"));
      setPendingCount(getPendingCount());
      setActionLoading(null);
      return;
    }
    const { error: apiErr } = await api(`/queue/start-serving/${entryId}`, {
      method: "POST",
      accessToken,
    });
    if (apiErr) {
      setError(apiErr);
      await fetchEntries();
    } else {
      setSuccessMsg(`${entry?.ticket_number} now being served`);
    }
    setActionLoading(null);
  };

  const handleMarkServed = async (entryId: string) => {
    if (!accessToken) return;
    setActionLoading(`served-${entryId}`);
    const entry =
      nextEntries.find((e) => e.id === entryId) ||
      serving.find((e) => e.id === entryId);
    // Optimistic UI
    if (entry) {
      setNextEntries((prev) => prev.filter((e) => e.id !== entryId));
      setServing((prev) => prev.filter((e) => e.id !== entryId));
      setCompleted((prev) => [{ ...entry, status: "served" }, ...prev]);
    }
    // If offline → enqueue + toast
    if (!isOnline) {
      enqueue(`/queue/mark-served/${entryId}`, {
        method: "POST",
        label: `Mark served ${entry?.ticket_number || entryId}`,
      });
      toast.info(t("offline.actionQueued"));
      setPendingCount(getPendingCount());
      setActionLoading(null);
      return;
    }
    const { error: apiErr } = await api(`/queue/mark-served/${entryId}`, {
      method: "POST",
      accessToken,
    });
    if (apiErr) {
      setError(apiErr);
      await fetchEntries();
    } else {
      setSuccessMsg(`${entry?.ticket_number} marked served`);
    }
    setActionLoading(null);
  };

  const handleMarkNoShow = async (entryId: string) => {
    if (!accessToken) return;
    setActionLoading(`noshow-${entryId}`);
    const entry =
      waiting.find((e) => e.id === entryId) ||
      nextEntries.find((e) => e.id === entryId) ||
      serving.find((e) => e.id === entryId);
    // Optimistic UI
    if (entry) {
      setWaiting((prev) => prev.filter((e) => e.id !== entryId));
      setNextEntries((prev) => prev.filter((e) => e.id !== entryId));
      setServing((prev) => prev.filter((e) => e.id !== entryId));
      setCompleted((prev) => [{ ...entry, status: "no_show" }, ...prev]);
    }
    // If offline → enqueue + toast
    if (!isOnline) {
      enqueue(`/queue/mark-noshow/${entryId}`, {
        method: "POST",
        label: `Mark no-show ${entry?.ticket_number || entryId}`,
      });
      toast.info(t("offline.actionQueued"));
      setPendingCount(getPendingCount());
      setActionLoading(null);
      return;
    }
    const { error: apiErr } = await api(`/queue/mark-noshow/${entryId}`, {
      method: "POST",
      accessToken,
    });
    if (apiErr) {
      setError(apiErr);
      await fetchEntries();
    } else {
      setSuccessMsg(`${entry?.ticket_number} marked no-show`);
    }
    setActionLoading(null);
  };

  const handleMove = async (entryId: string, direction: "up" | "down") => {
    if (!accessToken || !canReorder(myRole) || !guardOnline("reorder")) return;
    setActionLoading(`move-${entryId}`);
    const filtered = filterByType(waiting);
    const idx = filtered.findIndex((e) => e.id === entryId);
    const newPos = direction === "up" ? idx : idx + 2; // 1-based

    const { error: apiErr } = await api(`/queue/move/${entryId}`, {
      method: "POST",
      accessToken,
      body: { newPosition: newPos },
    });
    if (apiErr) setError(apiErr);
    else await fetchEntries();
    setActionLoading(null);
  };

  const handleReassign = async (newStaffId: string) => {
    if (!accessToken || !reassignEntry || !canReassign(myRole) || !guardOnline("reassign")) return;
    setActionLoading(`reassign-${reassignEntry.id}`);
    const { error: apiErr } = await api(
      `/queue/reassign/${reassignEntry.id}`,
      {
        method: "POST",
        accessToken,
        body: { newStaffAuthUid: newStaffId },
      }
    );
    if (apiErr) setError(apiErr);
    else {
      setSuccessMsg(`Reassigned ${reassignEntry.ticket_number}`);
      await fetchEntries();
    }
    setReassignEntry(null);
    setActionLoading(null);
  };

  const handleCopyJoinLink = () => {
    const loc = locations.find((l) => l.id === selectedLocation);
    if (!loc?.slug) return;
    const url = `${window.location.origin}/join/${loc.slug}`;
    navigator.clipboard.writeText(url);
    setCopiedSlug(true);
    setTimeout(() => setCopiedSlug(false), 2000);
  };

  const handleMarkPreviousServed = async (queueTypeId: string) => {
    if (!accessToken || !guardOnline("mark previous served")) return;
    setActionLoading(`prev-${queueTypeId}`);
    setError("");

    const location = locations.find((l) => l.id === selectedLocation);
    const { data: sessionData } = await api<{ session: { id: string } }>(
      "/queue/session",
      {
        method: "POST",
        accessToken,
        body: {
          queueTypeId,
          locationId: selectedLocation,
          businessId: location?.business_id || businessId,
        },
      }
    );

    if (!sessionData?.session?.id) {
      setError("Failed to get queue session");
      setActionLoading(null);
      return;
    }

    const { data, error: apiErr } = await api<{
      entry: QueueEntry | null;
      message?: string;
    }>("/queue/mark-previous-served", {
      method: "POST",
      accessToken,
      body: { queueTypeId, sessionId: sessionData.session.id },
    });

    if (apiErr) {
      setError(apiErr);
    } else if (data?.entry) {
      setNextEntries((prev) => prev.filter((e) => e.id !== data.entry!.id));
      setServing((prev) => prev.filter((e) => e.id !== data.entry!.id));
      setCompleted((prev) => [{ ...data.entry!, status: "served" }, ...prev]);
      setSuccessMsg(`${data.entry.ticket_number} marked served (previous)`);
    } else {
      setError(data?.message || "No previous entry to mark as served");
    }
    setActionLoading(null);
  };

  const filterByType = (entries: QueueEntry[]) =>
    selectedQueueType === "all"
      ? entries
      : entries.filter((e) => e.queue_type_id === selectedQueueType);

  const getStaffName = (authUid: string | null) => {
    if (!authUid) return null;
    return staffList.find((s) => s.auth_user_id === authUid)?.name || null;
  };

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const roleBadge = ROLE_BADGES[myRole] || ROLE_BADGES.staff;
  const RoleIcon = roleBadge.icon;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-4 animate-fade-in">
        {/* ── Offline Banner ── */}
        <OfflineBanner isOnline={isOnline} isReconnecting={isReconnecting} lastSyncedAt={lastSyncedAt} pendingCount={pendingCount} />

        {/* ── Header ── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("nav.queues")}</h1>
            <p className="text-muted-foreground text-sm">
              Manage queues in real-time
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={`gap-1.5 ${roleBadge.color} border-current/20`}
            >
              <RoleIcon className="h-3 w-3" />
              {roleBadge.label}
            </Badge>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs text-emerald-600 dark:text-emerald-400">
              Live
            </span>
          </div>
        </div>

        {/* ── Controls bar ── */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-3">
            {/* Location selector */}
            {locations.length > 0 && (
              <Select
                value={selectedLocation}
                onValueChange={(v) => {
                  setSelectedLocation(v);
                  setSelectedQueueType("all");
                }}
              >
                <SelectTrigger className="w-44 sm:w-52">
                  <MapPin className="h-3.5 w-3.5 mr-1 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="Location" />
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

            {/* Queue type filter */}
            {queueTypes.length > 0 && (
              <Select
                value={selectedQueueType}
                onValueChange={setSelectedQueueType}
              >
                <SelectTrigger className="w-40 sm:w-48">
                  <ListOrdered className="h-3.5 w-3.5 mr-1 text-muted-foreground shrink-0" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Queues</SelectItem>
                  {queueTypes.map((qt) => (
                    <SelectItem key={qt.id} value={qt.id}>
                      [{qt.prefix}] {qt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <div className="flex-1" />

            {/* Copy join link */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyJoinLink}
              disabled={!selectedLocation}
              className="gap-1.5"
            >
              {copiedSlug ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {copiedSlug ? "Copied!" : "Share Join Link"}
              </span>
            </Button>
          </CardContent>
        </Card>

        {/* ── Emergency Controls (owner only) ── */}
        {myRole === "owner" && selectedLocation && accessToken && (
          <EmergencyControlsPanel
            locationId={selectedLocation}
            accessToken={accessToken}
            onStateChange={fetchEntries}
          />
        )}

        {/* ── Messages ── */}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            <p className="text-destructive text-sm flex-1">{error}</p>
            <button
              onClick={() => setError("")}
              className="text-destructive/60 hover:text-destructive text-xs"
            >
              Dismiss
            </button>
          </div>
        )}
        {successMsg && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <p className="text-emerald-700 dark:text-emerald-400 text-sm">{successMsg}</p>
          </div>
        )}

        {/* ── Call Next buttons ── */}
        {queueTypes.length > 0 && canCallAndMark(myRole) && (
          <div className="flex flex-wrap gap-2">
            {(selectedQueueType === "all"
              ? queueTypes
              : queueTypes.filter((q) => q.id === selectedQueueType)
            ).map((qt) => (
              <div key={qt.id} className="flex items-center gap-1.5">
                <Button
                  onClick={() => handleCallNext(qt.id)}
                  disabled={actionLoading === `call-${qt.id}`}
                  className="gap-1.5 font-semibold"
                  size="lg"
                >
                  {actionLoading === `call-${qt.id}` ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PhoneForwarded className="h-4 w-4" />
                  )}
                  Call Next [{qt.prefix}]
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => handleMarkPreviousServed(qt.id)}
                      disabled={actionLoading === `prev-${qt.id}`}
                      className="gap-1.5"
                    >
                      {actionLoading === `prev-${qt.id}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <SkipBack className="h-4 w-4" />
                      )}
                      <span className="hidden sm:inline">Mark Prev Served</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Mark the previous entry as served (if forgotten)</TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        )}

        {/* ── Tabs ── */}
        <Tabs defaultValue="waiting">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="waiting" className="gap-1.5 flex-1 sm:flex-initial">
              <Clock className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Waiting</span>
              <Badge variant="secondary" className="ml-0.5 h-5 min-w-5 px-1.5 text-[0.65rem]">
                {filterByType(waiting).length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="serving" className="gap-1.5 flex-1 sm:flex-initial">
              <PhoneForwarded className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Serving</span>
              <Badge variant="secondary" className="ml-0.5 h-5 min-w-5 px-1.5 text-[0.65rem]">
                {filterByType(nextEntries).length + filterByType(serving).length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="completed" className="gap-1.5 flex-1 sm:flex-initial">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Done</span>
              <Badge variant="secondary" className="ml-0.5 h-5 min-w-5 px-1.5 text-[0.65rem]">
                {filterByType(completed).length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          {/* ── WAITING ── */}
          <TabsContent value="waiting" className="mt-3 space-y-1.5">
            {filterByType(waiting).length === 0 ? (
              <EmptyState message="No customers waiting" />
            ) : (
              filterByType(waiting).map((entry, idx) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  position={idx + 1}
                  totalInList={filterByType(waiting).length}
                  staffName={null}
                  actions={
                    <div className="flex items-center gap-1">
                      {/* Reorder buttons (owner/admin only) */}
                      {canReorder(myRole) && (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                disabled={idx === 0 || !!actionLoading}
                                onClick={() => handleMove(entry.id, "up")}
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Move up</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                disabled={
                                  idx === filterByType(waiting).length - 1 ||
                                  !!actionLoading
                                }
                                onClick={() => handleMove(entry.id, "down")}
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Move down</TooltipContent>
                          </Tooltip>
                        </>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-7 w-7 text-destructive border-destructive/30"
                            onClick={() => handleMarkNoShow(entry.id)}
                            disabled={actionLoading === `noshow-${entry.id}`}
                          >
                            {actionLoading === `noshow-${entry.id}` ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>No show</TooltipContent>
                      </Tooltip>
                    </div>
                  }
                />
              ))
            )}
          </TabsContent>

          {/* ── SERVING ── */}
          <TabsContent value="serving" className="mt-3 space-y-1.5">
            {/* NEXT entries — called but not yet serving */}
            {filterByType(nextEntries).length > 0 && (
              <>
                {filterByType(nextEntries).map((entry) => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    staffName={getStaffName(entry.served_by)}
                    actions={
                      <div className="flex items-center gap-1">
                        {canReassign(myRole) && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => setReassignEntry(entry)}
                              >
                                <UserRoundCog className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Reassign staff</TooltipContent>
                          </Tooltip>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStartServing(entry.id)}
                          disabled={actionLoading === `start-${entry.id}`}
                          className="gap-1 font-medium border-primary text-primary hover:bg-primary/10"
                        >
                          {actionLoading === `start-${entry.id}` ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <PlayCircle className="h-3.5 w-3.5" />
                          )}
                          Start Serving
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleMarkServed(entry.id)}
                          disabled={actionLoading === `served-${entry.id}`}
                          className="gap-1 font-medium"
                        >
                          {actionLoading === `served-${entry.id}` ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                          Done
                        </Button>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-8 w-8 text-destructive border-destructive/30"
                              onClick={() => handleMarkNoShow(entry.id)}
                              disabled={actionLoading === `noshow-${entry.id}`}
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>No show</TooltipContent>
                        </Tooltip>
                      </div>
                    }
                  />
                ))}
                {filterByType(serving).length > 0 && (
                  <Separator className="my-2" />
                )}
              </>
            )}

            {/* SERVING entries — actively being served */}
            {filterByType(nextEntries).length === 0 && filterByType(serving).length === 0 ? (
              <EmptyState message="No one being served" />
            ) : (
              filterByType(serving).map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  staffName={getStaffName(entry.served_by)}
                  actions={
                    <div className="flex items-center gap-1">
                      {/* Reassign (owner/admin only) */}
                      {canReassign(myRole) && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => setReassignEntry(entry)}
                            >
                              <UserRoundCog className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Reassign staff</TooltipContent>
                        </Tooltip>
                      )}
                      <Button
                        size="sm"
                        onClick={() => handleMarkServed(entry.id)}
                        disabled={actionLoading === `served-${entry.id}`}
                        className="gap-1 font-medium"
                      >
                        {actionLoading === `served-${entry.id}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        Done
                      </Button>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-8 w-8 text-destructive border-destructive/30"
                            onClick={() => handleMarkNoShow(entry.id)}
                            disabled={actionLoading === `noshow-${entry.id}`}
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>No show</TooltipContent>
                      </Tooltip>
                    </div>
                  }
                />
              ))
            )}
          </TabsContent>

          {/* ── COMPLETED ── */}
          <TabsContent value="completed" className="mt-3 space-y-1.5">
            {filterByType(completed).length === 0 ? (
              <EmptyState message="No completed entries yet" />
            ) : (
              filterByType(completed).map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  staffName={getStaffName(entry.served_by)}
                />
              ))
            )}
          </TabsContent>
        </Tabs>

        {/* ── Reassign Dialog ── */}
        <Dialog
          open={!!reassignEntry}
          onOpenChange={(open) => !open && setReassignEntry(null)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Reassign Staff</DialogTitle>
              <DialogDescription>
                Reassign{" "}
                <span className="font-semibold text-foreground">
                  {reassignEntry?.ticket_number}
                </span>{" "}
                to a different staff member.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {staffList
                .filter((s) =>
                  s.locations.includes(selectedLocation)
                )
                .map((s) => (
                  <button
                    key={s.auth_user_id}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50 ${
                      reassignEntry?.served_by === s.auth_user_id
                        ? "border-primary bg-primary/5"
                        : "border-border"
                    }`}
                    onClick={() => handleReassign(s.auth_user_id)}
                    disabled={
                      !!actionLoading ||
                      reassignEntry?.served_by === s.auth_user_id
                    }
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {s.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {s.email}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[0.6rem] capitalize shrink-0">
                      {s.role}
                    </Badge>
                    {reassignEntry?.served_by === s.auth_user_id && (
                      <Badge variant="default" className="text-[0.6rem] shrink-0">
                        Current
                      </Badge>
                    )}
                  </button>
                ))}
              {staffList.filter((s) => s.locations.includes(selectedLocation))
                .length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No staff assigned to this location
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Offline Queue Drawer ── */}
        <OfflineQueueDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          isOnline={isOnline}
          accessToken={accessToken}
          onReplayComplete={() => {
            setPendingCount(getPendingCount());
            fetchEntries();
          }}
        />
      </div>
    </TooltipProvider>
  );
}

// ══════════════════════════════════════════════
// SUB-COMPONENTS
// ══════════════════════════════════════════════

function EntryCard({
  entry,
  position,
  totalInList,
  staffName,
  actions,
}: {
  entry: QueueEntry;
  position?: number;
  totalInList?: number;
  staffName?: string | null;
  actions?: React.ReactNode;
}) {
  const statusStyles: Record<
    string,
    { variant: "default" | "secondary" | "destructive" | "outline"; label: string; dotColor: string }
  > = {
    waiting: { variant: "outline", label: "Waiting", dotColor: "bg-blue-500" },
    next: { variant: "default", label: "Called", dotColor: "bg-amber-500" },
    serving: { variant: "default", label: "Serving", dotColor: "bg-emerald-500" },
    served: { variant: "secondary", label: "Served", dotColor: "bg-gray-400" },
    no_show: { variant: "destructive", label: "No Show", dotColor: "bg-red-500" },
    cancelled: { variant: "secondary", label: "Cancelled", dotColor: "bg-amber-500" },
  };
  const style = statusStyles[entry.status] || statusStyles.waiting;

  return (
    <Card className="transition-shadow hover:shadow-sm">
      <CardContent className="flex items-center gap-3 p-3">
        {/* Ticket badge */}
        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <span className="font-bold text-primary text-sm leading-none">
            {entry.ticket_number}
          </span>
          <span
            className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ${style.dotColor} ring-2 ring-card`}
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-foreground truncate">
              {entry.customer_name || "Walk-in"}
            </span>
            <Badge variant={style.variant} className="text-[0.6rem] h-[18px] px-1.5">
              {style.label}
            </Badge>
            {position != null && (
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <Hash className="h-3 w-3" />
                {position}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2.5 mt-0.5 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {entry.queue_type_name || "General"}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(entry.joined_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {entry.customer_phone && (
              <span className="hidden sm:flex items-center gap-0.5 text-xs text-muted-foreground">
                <Phone className="h-2.5 w-2.5" />
                {entry.customer_phone}
              </span>
            )}
            {staffName && (
              <span className="text-xs text-muted-foreground">
                by {staffName}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        {actions && <div className="shrink-0">{actions}</div>}
      </CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16">
      <Users className="h-10 w-10 text-muted-foreground/50 mb-3" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
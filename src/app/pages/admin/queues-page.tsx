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
import React, { useState, useEffect, useCallback } from "react";
import { useLocaleStore } from "../../stores/locale-store";
import { useAuthStore } from "../../stores/auth-store";
import { api } from "../../lib/api";
import { useRealtime } from "../../lib/use-realtime";
import {
  useNetworkStatus,
  cacheSet,
  cacheGet,
} from "../../lib/use-network-status";
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
  Scissors,
  Sparkles,
  MoreHorizontal,
  UserPlus,
  X,
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
  service_id: string | null;
  service_name: string | null;
  estimatedMinutes?: number;
}

interface Service {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  avg_service_time: number;
  status: string;
}

interface QueueTypeInfo {
  id: string;
  name: string;
  prefix: string;
  location_id: string;
  estimated_service_time: number;
  service_ids?: string[];
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

const ROLE_BADGES: Record<
  string,
  { icon: typeof Shield; color: string; label: string }
> = {
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

  const [services, setServices] = useState<Service[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string>("all");

  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [copiedSlug, setCopiedSlug] = useState(false);

  // Reassign dialog
  const [reassignEntry, setReassignEntry] = useState<QueueEntry | null>(null);

  // ── Walk-In Dialog State ──
  const [isWalkInOpen, setIsWalkInOpen] = useState(false);
  const [walkInName, setWalkInName] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");
  const [walkInServiceId, setWalkInServiceId] = useState("");
  const [isSubmittingWalkIn, setIsSubmittingWalkIn] = useState(false);

  // ── Offline Queue Drawer ──
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(() => getPendingCount());

  // ── Offline Resilience ──
  const CACHE_KEY = `staff-queue:${selectedLocation}`;
  const { isOnline, isReconnecting, lastSyncedAt, markSynced } =
    useNetworkStatus({
      onReconnect: async () => {
        // Replay any queued mutations first, then refresh
        if (accessToken) {
          const pending = getPendingCount();
          if (pending > 0) {
            const result = await replay(accessToken);
            if (result.succeeded > 0) {
              toast.success(
                t("offline.replaySuccess").replace(
                  "{succeeded}",
                  String(result.succeeded),
                ),
              );
            }
            if (result.failed > 0) {
              toast.error(
                t("offline.replayPartial")
                  .replace("{succeeded}", String(result.succeeded))
                  .replace("{total}", String(result.total))
                  .replace("{failed}", String(result.failed)),
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
    if (
      waiting.length ||
      nextEntries.length ||
      serving.length ||
      completed.length
    ) {
      cacheSet(CACHE_KEY, { waiting, next: nextEntries, serving, completed });
    }
  }, [waiting, nextEntries, serving, completed, selectedLocation, isOnline]);

  // Restore from cache on initial load if offline
  useEffect(() => {
    if (!isOnline && selectedLocation && !waiting.length && !serving.length) {
      const cached = cacheGet<{
        waiting: QueueEntry[];
        next: QueueEntry[];
        serving: QueueEntry[];
        completed: QueueEntry[];
      }>(CACHE_KEY);
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
        { accessToken },
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
      const [{ data: qtData }, { data: staffData }, { data: svcData }] =
        await Promise.all([
          api<{ queueTypes: QueueTypeInfo[] }>(
            `/queue/types/${selectedLocation}`,
            { accessToken },
          ),
          api<{ staff: StaffMember[] }>(`/business/${businessId}/staff`, {
            accessToken,
          }),
          api<{ services: Service[] }>(`/settings/services/${businessId}`, {
            accessToken,
          }),
        ]);
      if (qtData?.queueTypes) setQueueTypes(qtData.queueTypes);
      if (staffData?.staff) setStaffList(staffData.staff);
      if (svcData?.services) setServices(svcData.services);
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
      },
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
        const demoted = prev.filter(
          (e) => e.queue_type_id === data.entry!.queue_type_id,
        );
        if (demoted.length > 0) {
          setWaiting((w) => [
            ...demoted.map((e) => ({ ...e, status: "waiting" })),
            ...w,
          ]);
        }
        return [
          data.entry!,
          ...prev.filter((e) => e.queue_type_id !== data.entry!.queue_type_id),
        ];
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
    if (
      !accessToken ||
      !reassignEntry ||
      !canReassign(myRole) ||
      !guardOnline("reassign")
    )
      return;
    setActionLoading(`reassign-${reassignEntry.id}`);
    const { error: apiErr } = await api(`/queue/reassign/${reassignEntry.id}`, {
      method: "POST",
      accessToken,
      body: { newStaffAuthUid: newStaffId },
    });
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
      },
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

  const filterByType = (entries: QueueEntry[]) => {
    let filtered = entries;
    if (selectedQueueType !== "all") {
      filtered = filtered.filter((e) => e.queue_type_id === selectedQueueType);
    }
    if (selectedServiceId !== "all") {
      filtered = filtered.filter((e) => e.service_id === selectedServiceId);
    }
    return filtered;
  };

  const getWaitingCountForService = (serviceId: string) => {
    return waiting.filter((e) => e.service_id === serviceId).length;
  };

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
        <OfflineBanner
          isOnline={isOnline}
          isReconnecting={isReconnecting}
          lastSyncedAt={lastSyncedAt}
          pendingCount={pendingCount}
        />

        {/* ── Header ── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t("nav.queues")}
            </h1>
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

            {/* Add Walk-In */}
            <Button
              variant="default"
              size="sm"
              onClick={() => setIsWalkInOpen(true)}
              disabled={!selectedLocation}
              className="gap-1.5 bg-primary hover:bg-primary/90"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>Add Walk-In</span>
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
            <p className="text-emerald-700 dark:text-emerald-400 text-sm">
              {successMsg}
            </p>
          </div>
        )}

        {/* ── Service Filter ── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Service Filter</h2>
              <p className="text-[0.7rem] text-muted-foreground">
                View queue by service type
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={selectedServiceId === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedServiceId("all")}
              className="rounded-full h-8 px-4"
            >
              All Services
              <Badge
                variant="secondary"
                className="ml-2 h-4 min-w-4 p-0 text-[10px] flex items-center justify-center bg-white/20 text-white"
              >
                {waiting.length}
              </Badge>
            </Button>
            {services.map((svc) => (
              <Button
                key={svc.id}
                variant={selectedServiceId === svc.id ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedServiceId(svc.id)}
                className="rounded-full h-8 px-4"
              >
                {svc.name}
                <Badge
                  variant="secondary"
                  className="ml-2 h-4 min-w-4 p-0 text-[10px] bg-muted/20"
                >
                  {getWaitingCountForService(svc.id)}
                </Badge>
              </Button>
            ))}
          </div>
        </section>

        {/* ── Service Counters ── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Users className="h-4 w-4 text-primary" />
            </div>
            <h2 className="text-sm font-semibold">Service Counters</h2>
            <Badge variant="secondary" className="text-[0.65rem]">
              {queueTypes.length} active
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(selectedQueueType === "all"
              ? queueTypes
              : queueTypes.filter((qt) => qt.id === selectedQueueType)
            )
              .filter((qt) => {
                if (selectedServiceId === "all") return true;
                return qt.service_ids?.includes(selectedServiceId);
              })
              .map((qt, idx) => (
                <CounterCard
                  key={qt.id}
                  qt={qt}
                  number={idx + 1}
                  servingEntries={serving.filter(
                    (e) => e.queue_type_id === qt.id,
                  )}
                  nextEntries={nextEntries.filter(
                    (e) => e.queue_type_id === qt.id,
                  )}
                  allServices={services}
                  actionLoading={actionLoading}
                  onCallNext={() => handleCallNext(qt.id)}
                  onMarkServed={(id) => handleMarkServed(id)}
                />
              ))}
          </div>
        </section>

        {/* ── Waiting Queue ── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Waiting Queue</h2>
              <Badge
                variant="secondary"
                className="bg-primary text-primary-foreground h-5 w-5 p-0 flex items-center justify-center rounded-full text-[10px]"
              >
                {filterByType(waiting).length}
              </Badge>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground/50" />
          </div>

          {filterByType(waiting).length === 0 ? (
            <EmptyState message="No customers waiting" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filterByType(waiting).map((entry, idx) => (
                <WaitingEntryCard
                  key={entry.id}
                  entry={entry}
                  position={idx + 1}
                  onNoShow={() => handleMarkNoShow(entry.id)}
                  isActionLoading={actionLoading === `noshow-${entry.id}`}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Completed Tab (Optional, keep it small) ── */}
        <Separator className="my-8" />
        <Tabs defaultValue="completed">
          <TabsList>
            <TabsTrigger value="completed" className="gap-2">
              <CheckCircle2 className="h-3.5 w-3.5" />
              History
            </TabsTrigger>
          </TabsList>
          <TabsContent value="completed" className="mt-3">
            {filterByType(completed).length === 0 ? (
              <EmptyState message="No completed entries yet" />
            ) : (
              <div className="space-y-1.5">
                {filterByType(completed)
                  .slice(0, 10)
                  .map((entry) => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      staffName={getStaffName(entry.served_by)}
                    />
                  ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* ── Walk-In Dialog ── */}
        <Dialog open={isWalkInOpen} onOpenChange={setIsWalkInOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Walk-In Customer</DialogTitle>
              <DialogDescription>
                Manually add a customer to the queue.
              </DialogDescription>
            </DialogHeader>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!walkInName.trim()) {
                  toast.error("Please enter a name");
                  return;
                }
                if (!walkInServiceId) {
                  toast.error("Please select a service");
                  return;
                }

                setIsSubmittingWalkIn(true);
                try {
                  const location = locations.find(
                    (l) => l.id === selectedLocation,
                  );
                  const { error: apiErr } = await api("/public/queue/join", {
                    method: "POST",
                    body: {
                      serviceId: walkInServiceId,
                      locationId: selectedLocation,
                      businessId: businessId,
                      name: walkInName.trim(),
                      phone: walkInPhone.trim() || null,
                      locale: useLocaleStore.getState().locale,
                    },
                  });

                  if (apiErr) {
                    toast.error(apiErr);
                  } else {
                    toast.success(`Customer ${walkInName} added!`);
                    setIsWalkInOpen(false);
                    setWalkInName("");
                    setWalkInPhone("");
                    setWalkInServiceId("");
                    fetchEntries();
                  }
                } catch (err) {
                  toast.error("Failed to add customer");
                } finally {
                  setIsSubmittingWalkIn(false);
                }
              }}
              className="space-y-4 py-4"
            >
              <div className="space-y-2">
                <label className="text-sm font-medium">Customer Name</label>
                <div className="relative">
                  <Sparkles className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/40" />
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-9 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="Enter name"
                    value={walkInName}
                    onChange={(e) => setWalkInName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Phone Number (Optional)
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/40" />
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-9 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="Enter phone number"
                    value={walkInPhone}
                    onChange={(e) => setWalkInPhone(e.target.value)}
                    type="tel"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Select Service</label>
                <Select
                  value={walkInServiceId}
                  onValueChange={setWalkInServiceId}
                >
                  <SelectTrigger className="w-full">
                    <Scissors className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                    <SelectValue placeholder="Select a service" />
                  </SelectTrigger>
                  <SelectContent>
                    {services.map((svc) => (
                      <SelectItem key={svc.id} value={svc.id}>
                        {svc.name} ({svc.avg_service_time} min)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsWalkInOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmittingWalkIn}>
                  {isSubmittingWalkIn ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Join Queue"
                  )}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
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
                .filter((s) => s.locations.includes(selectedLocation))
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
                    <Badge
                      variant="outline"
                      className="text-[0.6rem] capitalize shrink-0"
                    >
                      {s.role}
                    </Badge>
                    {reassignEntry?.served_by === s.auth_user_id && (
                      <Badge
                        variant="default"
                        className="text-[0.6rem] shrink-0"
                      >
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
    {
      variant: "default" | "secondary" | "destructive" | "outline";
      label: string;
      dotColor: string;
    }
  > = {
    waiting: { variant: "outline", label: "Waiting", dotColor: "bg-blue-500" },
    next: { variant: "default", label: "Called", dotColor: "bg-amber-500" },
    serving: {
      variant: "default",
      label: "Serving",
      dotColor: "bg-emerald-500",
    },
    served: { variant: "secondary", label: "Served", dotColor: "bg-gray-400" },
    no_show: {
      variant: "destructive",
      label: "No Show",
      dotColor: "bg-red-500",
    },
    cancelled: {
      variant: "secondary",
      label: "Cancelled",
      dotColor: "bg-amber-500",
    },
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
            <Badge
              variant={style.variant}
              className="text-[0.6rem] h-[18px] px-1.5"
            >
              {style.label}
            </Badge>
            {entry.service_name && (
              <Badge
                variant="secondary"
                className="text-[0.6rem] h-[18px] px-1.5 bg-primary/5 text-primary border-primary/10"
              >
                {entry.service_name}
              </Badge>
            )}
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

function CounterCard({
  qt,
  number,
  servingEntries,
  nextEntries,
  allServices,
  actionLoading,
  onCallNext,
  onMarkServed,
}: {
  qt: QueueTypeInfo;
  number: number;
  servingEntries: QueueEntry[];
  nextEntries: QueueEntry[];
  allServices: Service[];
  actionLoading: string | null;
  onCallNext: () => void;
  onMarkServed: (id: string) => void;
}) {
  const isServing = servingEntries.length > 0 || nextEntries.length > 0;
  const currentEntry = servingEntries[0] || nextEntries[0];

  // Get service names for this counter
  const counterServices = allServices.filter((s) =>
    qt.service_ids?.includes(s.id),
  );
  const serviceText =
    counterServices.length === 0
      ? "All services"
      : counterServices.length === 1
        ? counterServices[0].name
        : counterServices.length === 2
          ? `${counterServices[0].name}, ${counterServices[1].name}`
          : `${counterServices[0].name}, ${counterServices[1].name} +${counterServices.length - 2}`;

  return (
    <Card
      className={`overflow-hidden transition-all duration-300 border-2 ${isServing ? "border-amber-200 shadow-amber-100" : "border-emerald-200 shadow-emerald-100"} hover:shadow-md`}
    >
      <CardContent className="p-0">
        <div className="p-4 space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-lg font-bold">
                {number}
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-base truncate">{qt.name}</h3>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <p className="text-[0.7rem] text-muted-foreground truncate cursor-help">
                      {serviceText}
                    </p>
                  </TooltipTrigger>
                  {counterServices.length > 2 && (
                    <TooltipContent>
                      <ul className="text-xs space-y-1">
                        {counterServices.map((s) => (
                          <li key={s.id}>{s.name}</li>
                        ))}
                      </ul>
                    </TooltipContent>
                  )}
                </Tooltip>
              </div>
            </div>
            <Badge
              variant={isServing ? "default" : "outline"}
              className={`text-[0.65rem] ${isServing ? "bg-amber-500 hover:bg-amber-600" : "text-emerald-600 border-emerald-200 bg-emerald-50"}`}
            >
              {isServing ? "Serving" : "Available"}
            </Badge>
          </div>

          <div className="min-h-[80px] flex flex-col justify-center">
            {isServing ? (
              <div className="bg-amber-50 rounded-xl p-3 border border-amber-100 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    {/* <span className="text-lg font-bold text-amber-900">
                      #{currentEntry.ticket_number}
                    </span> */}
                    <span className="text-sm font-medium text-amber-800">
                      {currentEntry.customer_name || "Guest"}
                    </span>
                  </div>
                  {currentEntry.service_name && (
                    <p className="text-[0.65rem] text-amber-700 font-medium uppercase tracking-wider mt-0.5">
                      {currentEntry.service_name}
                    </p>
                  )}
                </div>
                <Users className="h-5 w-5 text-amber-300" />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-2 text-muted-foreground/40">
                <Clock className="h-6 w-6 mb-1" />
                <p className="text-[0.65rem] font-medium">
                  No customers waiting
                </p>
              </div>
            )}
          </div>

          {isServing ? (
            <div className="flex gap-2">
              <Button
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 h-10 gap-2 font-bold"
                onClick={() => onMarkServed(currentEntry.id)}
                disabled={actionLoading === `served-${currentEntry.id}`}
              >
                {actionLoading === `served-${currentEntry.id}` ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Served
              </Button>
              {/* <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button> */}
            </div>
          ) : (
            <Button
              className="w-full bg-primary hover:bg-primary/90 h-11 gap-2 text-base font-bold shadow-lg shadow-primary/20 transition-all active:scale-95"
              onClick={onCallNext}
              disabled={actionLoading === `call-${qt.id}`}
            >
              {actionLoading === `call-${qt.id}` ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <PhoneForwarded className="h-5 w-5" />
              )}
              Call Next
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function WaitingEntryCard({
  entry,
  position,
  onNoShow,
  isActionLoading,
}: {
  entry: QueueEntry;
  position: number;
  onNoShow: () => void;
  isActionLoading: boolean;
}) {
  return (
    <Card className="overflow-hidden border border-border/60 hover:border-primary/30 transition-all hover:shadow-md group">
      <CardContent className="p-0">
        <div className="p-4 space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-center justify-center h-12 w-12 rounded-lg bg-muted/50 border border-muted-foreground/10">
                <span className="text-[0.6rem] font-bold text-muted-foreground/60 uppercase">
                  Pos
                </span>
                <span className="text-base font-black text-primary -mt-1">
                  #{position}
                </span>
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-base text-foreground truncate">
                  {entry.customer_name || "Guest"}
                </h3>
                <Badge
                  variant="secondary"
                  className="text-[0.6rem] h-4 bg-blue-50 text-blue-600 border-none px-1.5 font-bold uppercase tracking-tighter"
                >
                  Waiting
                </Badge>
              </div>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="destructive"
                    size="icon"
                    className="h-5 w-5 rounded-full hover:bg-red-600 border-none shadow-sm shadow-red-100 flex items-center justify-center shrink-0"
                    onClick={onNoShow}
                    disabled={isActionLoading}
                  >
                    <X className="h-4 w-4 text-white" strokeWidth={3} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-[10px] font-bold uppercase tracking-widest">
                    No-Show
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <div className="grid grid-cols-2 gap-4 py-1">
            <div className="space-y-1">
              <p className="text-[0.6rem] font-bold text-muted-foreground/60 uppercase tracking-widest">
                Service Name
              </p>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
                {/* <Phone className="h-3 w-3 text-muted-foreground/40" /> */}
                {entry.service_name ? (
                  entry.service_name
                ) : (
                  <span className="text-muted-foreground/30">—</span>
                )}
              </div>
            </div>
            {/* <div className="space-y-1">
              <p className="text-[0.6rem] font-bold text-muted-foreground/60 uppercase tracking-widest">Party Size</p>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
                <Users className="h-3 w-3 text-muted-foreground/40" />
                1 Person
              </div>
            </div> */}
          </div>

          <div className="pt-2 border-t border-dashed border-border/60">
            <p className="text-[0.6rem] font-bold text-muted-foreground/60 uppercase tracking-widest mb-1">
              Elapsed Time
            </p>
            <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
              <Clock className="h-3.5 w-3.5" />
              Wait time:{" "}
              <span className="font-black">
                {entry.estimatedMinutes !== undefined
                  ? entry.estimatedMinutes < 1
                    ? "Next"
                    : entry.estimatedMinutes > 60
                      ? `about ${Math.round(entry.estimatedMinutes / 60)} hour${Math.round(entry.estimatedMinutes / 60) > 1 ? "s" : ""}`
                      : `${entry.estimatedMinutes} min`
                  : "..."}
              </span>
            </div>
          </div>
        </div>
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

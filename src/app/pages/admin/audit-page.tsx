/**
 * Owner Audit Log Viewer — /admin/audit/:locationId
 *
 * Features:
 *   - Paginated table showing system events
 *   - Filter by date range, staff, event type
 *   - Searchable by customer name / ticket number
 *   - Owner-only access
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router";
import { useAuthStore } from "../../stores/auth-store";
import { api } from "../../lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Loader2,
  Search,
  ChevronLeft,
  ChevronRight,
  Shield,
  Clock,
  Filter,
  ArrowLeft,
  ScrollText,
  Bot,
  User,
  AlertTriangle,
  MapPin,
} from "lucide-react";

// ── Types ──

interface AuditLogEntry {
  id: string;
  timestamp: string;
  location_id: string;
  business_id: string;
  event_type: string;
  actor: string;
  actor_id: string | null;
  customer_name: string | null;
  ticket_number: string | null;
  queue_type_name: string | null;
  queue_type_id: string | null;
  entry_id: string | null;
  session_id: string | null;
  details: string | null;
}

interface StaffMember {
  auth_user_id: string;
  name: string;
  email: string;
  role: string;
}

// ── Event type styling ──

const EVENT_TYPE_CONFIG: Record<
  string,
  { label: string; color: string; bgColor: string }
> = {
  CALLED_NEXT: {
    label: "Called Next",
    color: "text-blue-700 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800",
  },
  SERVED: {
    label: "Served",
    color: "text-emerald-700 dark:text-emerald-400",
    bgColor: "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800",
  },
  NO_SHOW: {
    label: "No Show",
    color: "text-red-700 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800",
  },
  CANCELLED: {
    label: "Cancelled",
    color: "text-orange-700 dark:text-orange-400",
    bgColor: "bg-orange-50 dark:bg-orange-950/50 border-orange-200 dark:border-orange-800",
  },
  REORDERED: {
    label: "Reordered",
    color: "text-violet-700 dark:text-violet-400",
    bgColor: "bg-violet-50 dark:bg-violet-950/50 border-violet-200 dark:border-violet-800",
  },
  REASSIGNED: {
    label: "Reassigned",
    color: "text-indigo-700 dark:text-indigo-400",
    bgColor: "bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800",
  },
  AUTO_NO_SHOW: {
    label: "Auto No-Show",
    color: "text-rose-700 dark:text-rose-400",
    bgColor: "bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800",
  },
  AUTO_CANCEL: {
    label: "Auto Cancel",
    color: "text-amber-700 dark:text-amber-400",
    bgColor: "bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800",
  },
  SESSION_CLOSED: {
    label: "Session Closed",
    color: "text-slate-700 dark:text-slate-400",
    bgColor: "bg-slate-50 dark:bg-slate-950/50 border-slate-200 dark:border-slate-800",
  },
  MARK_PREVIOUS_SERVED: {
    label: "Mark Previous",
    color: "text-teal-700 dark:text-teal-400",
    bgColor: "bg-teal-50 dark:bg-teal-950/50 border-teal-200 dark:border-teal-800",
  },
  DUPLICATE_BLOCKED: {
    label: "Duplicate Blocked",
    color: "text-gray-700 dark:text-gray-400",
    bgColor: "bg-gray-50 dark:bg-gray-950/50 border-gray-200 dark:border-gray-800",
  },
  SESSION_ARCHIVED: {
    label: "Archived",
    color: "text-gray-700 dark:text-gray-400",
    bgColor: "bg-gray-50 dark:bg-gray-950/50 border-gray-200 dark:border-gray-800",
  },
  EMERGENCY_PAUSE: {
    label: "Emergency Pause",
    color: "text-red-700 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800",
  },
  EMERGENCY_RESUME: {
    label: "Emergency Resume",
    color: "text-emerald-700 dark:text-emerald-400",
    bgColor: "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800",
  },
  EMERGENCY_CLOSE: {
    label: "Emergency Close",
    color: "text-red-700 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800",
  },
  EMERGENCY_BROADCAST: {
    label: "Broadcast Sent",
    color: "text-blue-700 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800",
  },
  EMERGENCY_BROADCAST_CLEAR: {
    label: "Broadcast Cleared",
    color: "text-gray-700 dark:text-gray-400",
    bgColor: "bg-gray-50 dark:bg-gray-950/50 border-gray-200 dark:border-gray-800",
  },
};

const ALL_EVENT_TYPES = [
  "CALLED_NEXT",
  "SERVED",
  "NO_SHOW",
  "CANCELLED",
  "REORDERED",
  "REASSIGNED",
  "AUTO_NO_SHOW",
  "AUTO_CANCEL",
  "SESSION_CLOSED",
  "MARK_PREVIOUS_SERVED",
  "EMERGENCY_PAUSE",
  "EMERGENCY_RESUME",
  "EMERGENCY_CLOSE",
  "EMERGENCY_BROADCAST",
  "EMERGENCY_BROADCAST_CLEAR",
];

const PAGE_SIZE = 20;

// ── Helpers ──

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ══════════════════════════════════════════════

export function AuditPage() {
  const { locationId: paramLocationId } = useParams<{ locationId: string }>();
  const navigate = useNavigate();
  const { session, staffRecord, businessId } = useAuthStore();
  const accessToken = session?.access_token;

  // ── State ──
  const [locations, setLocations] = useState<any[]>([]);
  const [selectedLocation, setSelectedLocation] = useState(paramLocationId || "");
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);

  // Filters
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [staffFilter, setStaffFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  const isOwner = staffRecord?.role === "owner";

  // ── Load locations ──
  useEffect(() => {
    if (!businessId || !accessToken) return;
    (async () => {
      const [{ data: locData }, { data: staffData }] = await Promise.all([
        api<{ locations: any[] }>(`/business/${businessId}/locations`, { accessToken }),
        api<{ staff: StaffMember[] }>(`/business/${businessId}/staff`, { accessToken }),
      ]);
      if (locData?.locations) {
        setLocations(locData.locations);
        if (!selectedLocation && locData.locations.length > 0) {
          setSelectedLocation(locData.locations[0].id);
        }
      }
      if (staffData?.staff) setStaffList(staffData.staff);
      setLoading(false);
    })();
  }, [businessId, accessToken]);

  // ── Fetch audit log ──
  const fetchAuditLog = useCallback(async () => {
    if (!selectedLocation || !accessToken) return;
    setLoading(true);

    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (eventTypeFilter !== "all") params.set("eventType", eventTypeFilter);
    if (staffFilter !== "all") params.set("staffId", staffFilter);

    const { data, error } = await api<{
      entries: AuditLogEntry[];
      total: number;
    }>(`/audit/${selectedLocation}?${params.toString()}`, { accessToken });

    if (data) {
      setEntries(data.entries || []);
      setTotalCount(data.total || 0);
    }
    if (error) console.error("[AuditPage]", error);
    setLoading(false);
  }, [selectedLocation, accessToken, page, startDate, endDate, eventTypeFilter, staffFilter]);

  useEffect(() => {
    fetchAuditLog();
  }, [fetchAuditLog]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [startDate, endDate, eventTypeFilter, staffFilter, selectedLocation]);

  // ── Search (client-side) ──
  const filteredEntries = useMemo(() => {
    if (!searchTerm.trim()) return entries;
    const lower = searchTerm.toLowerCase();
    return entries.filter(
      (e) =>
        (e.customer_name || "").toLowerCase().includes(lower) ||
        (e.ticket_number || "").toLowerCase().includes(lower) ||
        (e.actor || "").toLowerCase().includes(lower) ||
        (e.details || "").toLowerCase().includes(lower)
    );
  }, [entries, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const locationName =
    locations.find((l) => l.id === selectedLocation)?.name || "Location";

  // ── Owner guard ──
  if (!isOwner) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Shield className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Owner Access Required</h2>
        <p className="text-muted-foreground text-sm">
          Only business owners can view the audit log.
        </p>
        <Button variant="outline" onClick={() => navigate("/admin")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/admin")}
            className="shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ScrollText className="h-6 w-6 text-primary" />
              Audit Log
            </h1>
            <p className="text-muted-foreground text-sm">
              Track all queue events and system actions
            </p>
          </div>
        </div>

        {/* Location selector */}
        {locations.length > 1 && (
          <Select value={selectedLocation} onValueChange={setSelectedLocation}>
            <SelectTrigger className="w-[220px]">
              <MapPin className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Select location" />
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
      </div>

      {/* ── Filters ── */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filters</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Date range */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Start Date
              </label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                End Date
              </label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9 text-sm"
              />
            </div>

            {/* Event type */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Event Type
              </label>
              <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="All events" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Events</SelectItem>
                  {ALL_EVENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {EVENT_TYPE_CONFIG[type]?.label || type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Staff filter */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Staff
              </label>
              <Select value={staffFilter} onValueChange={setStaffFilter}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="All staff" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Staff & System</SelectItem>
                  {staffList.map((s) => (
                    <SelectItem key={s.auth_user_id} value={s.auth_user_id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Search */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Search
              </label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Name, ticket..."
                  className="h-9 text-sm pl-8"
                />
              </div>
            </div>
          </div>

          {/* Active filter badges */}
          {(startDate || endDate || eventTypeFilter !== "all" || staffFilter !== "all") && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <span className="text-xs text-muted-foreground">Active:</span>
              {startDate && (
                <Badge variant="secondary" className="text-xs gap-1">
                  From {formatDate(startDate + "T00:00")}
                  <button
                    onClick={() => setStartDate("")}
                    className="ml-1 hover:text-destructive"
                  >
                    x
                  </button>
                </Badge>
              )}
              {endDate && (
                <Badge variant="secondary" className="text-xs gap-1">
                  To {formatDate(endDate + "T00:00")}
                  <button
                    onClick={() => setEndDate("")}
                    className="ml-1 hover:text-destructive"
                  >
                    x
                  </button>
                </Badge>
              )}
              {eventTypeFilter !== "all" && (
                <Badge variant="secondary" className="text-xs gap-1">
                  {EVENT_TYPE_CONFIG[eventTypeFilter]?.label || eventTypeFilter}
                  <button
                    onClick={() => setEventTypeFilter("all")}
                    className="ml-1 hover:text-destructive"
                  >
                    x
                  </button>
                </Badge>
              )}
              {staffFilter !== "all" && (
                <Badge variant="secondary" className="text-xs gap-1">
                  {staffList.find((s) => s.auth_user_id === staffFilter)?.name || "Staff"}
                  <button
                    onClick={() => setStaffFilter("all")}
                    className="ml-1 hover:text-destructive"
                  >
                    x
                  </button>
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => {
                  setStartDate("");
                  setEndDate("");
                  setEventTypeFilter("all");
                  setStaffFilter("all");
                  setSearchTerm("");
                }}
              >
                Clear all
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Results Summary ── */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {totalCount} event{totalCount !== 1 ? "s" : ""} found
          {searchTerm && ` (${filteredEntries.length} matching search)`}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchAuditLog}
          disabled={loading}
          className="gap-1.5"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Clock className="h-3.5 w-3.5" />
          )}
          Refresh
        </Button>
      </div>

      {/* ── Table ── */}
      <Card>
        <CardContent className="p-0">
          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <ScrollText className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm">
                {searchTerm
                  ? "No events match your search"
                  : "No audit events recorded yet"}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-[160px]">Timestamp</TableHead>
                  <TableHead className="w-[130px]">Actor</TableHead>
                  <TableHead className="w-[140px]">Event</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Queue</TableHead>
                  <TableHead className="hidden lg:table-cell">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntries.map((entry) => {
                  const config =
                    EVENT_TYPE_CONFIG[entry.event_type] || {
                      label: entry.event_type,
                      color: "text-gray-600",
                      bgColor: "bg-gray-50 border-gray-200",
                    };
                  const isSystem = !entry.actor_id || entry.actor === "System";

                  return (
                    <TableRow key={entry.id} className="group">
                      {/* Timestamp */}
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {formatTimestamp(entry.timestamp)}
                      </TableCell>

                      {/* Actor */}
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {isSystem ? (
                            <Bot className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                          ) : (
                            <User className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                          )}
                          <span
                            className={`text-sm truncate max-w-[100px] ${
                              isSystem
                                ? "text-amber-600 dark:text-amber-400 font-medium"
                                : ""
                            }`}
                          >
                            {entry.actor}
                          </span>
                        </div>
                      </TableCell>

                      {/* Event type badge */}
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[0.65rem] px-2 py-0.5 font-medium border ${config.bgColor} ${config.color}`}
                        >
                          {config.label}
                        </Badge>
                      </TableCell>

                      {/* Customer */}
                      <TableCell>
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium truncate max-w-[150px]">
                            {entry.customer_name || "—"}
                          </p>
                          {entry.ticket_number && (
                            <p className="text-xs text-muted-foreground font-mono">
                              {entry.ticket_number}
                            </p>
                          )}
                        </div>
                      </TableCell>

                      {/* Queue type */}
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {entry.queue_type_name || "—"}
                        </span>
                      </TableCell>

                      {/* Details */}
                      <TableCell className="hidden lg:table-cell">
                        {entry.details ? (
                          <p className="text-xs text-muted-foreground truncate max-w-[250px]">
                            {entry.details}
                          </p>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">
                            —
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>

            {/* Page numbers */}
            <div className="hidden sm:flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i;
                } else if (page < 3) {
                  pageNum = i;
                } else if (page > totalPages - 4) {
                  pageNum = totalPages - 5 + i;
                } else {
                  pageNum = page - 2 + i;
                }

                return (
                  <Button
                    key={pageNum}
                    variant={page === pageNum ? "default" : "outline"}
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setPage(pageNum)}
                  >
                    {pageNum + 1}
                  </Button>
                );
              })}
            </div>

            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="gap-1"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
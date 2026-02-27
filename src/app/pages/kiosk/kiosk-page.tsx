/**
 * Kiosk Page — /kiosk/:locationSlug
 *
 * Fullscreen, tablet-optimized queue display board.
 * No auth required — loads via public location slug.
 *
 * Features:
 *   - Large touch-friendly UI
 *   - Now Serving banner with flash animation
 *   - Sound notifications (ascending chime) when new ticket called
 *   - Mute/unmute toggle with localStorage persistence
 *   - Waiting list display
 *   - Queue type stats
 *   - Dark/light toggle
 *   - Realtime polling
 *   - No side navigation
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "react-router";
import { api } from "../../lib/api";
import { useRealtime } from "../../lib/use-realtime";
import { useThemeStore } from "../../stores/theme-store";
import { useKioskSound } from "../../lib/use-kiosk-sound";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Separator } from "../../components/ui/separator";
import {
  Zap,
  Loader2,
  Clock,
  Users,
  Volume2,
  VolumeX,
  Sun,
  Moon,
  Maximize,
  Minimize,
  RefreshCw,
  Ticket,
  MapPin,
  Hash,
  Bell,
  BellOff,
} from "lucide-react";

interface QueueTypeInfo {
  id: string;
  name: string;
  prefix: string;
  estimated_service_time: number;
}

interface KioskEntry {
  id: string;
  ticket_number: string;
  status: string;
  customer_name: string | null;
  queue_type_name: string | null;
  queue_type_prefix: string | null;
  queue_type_id: string;
  called_at: string | null;
  joined_at: string;
}

export function KioskPage() {
  const { locationSlug } = useParams<{ locationSlug: string }>();
  const [searchParams] = useSearchParams();
  const locationIdParam = searchParams.get("location");
  const { theme, toggleTheme } = useThemeStore();
  const { isMuted, toggleMute, playChime, playBell } = useKioskSound();

  const [locationId, setLocationId] = useState(locationIdParam || "");
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [queueTypes, setQueueTypes] = useState<QueueTypeInfo[]>([]);
  const [serving, setServing] = useState<KioskEntry[]>([]);
  const [waiting, setWaiting] = useState<KioskEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [flashTicket, setFlashTicket] = useState<string | null>(null);
  const [flashAnimation, setFlashAnimation] = useState(false);
  const prevServingRef = useRef<string[]>([]);
  const initialLoadRef = useRef(true);

  // ── Resolve location ──
  useEffect(() => {
    if (!locationSlug && !locationIdParam) {
      setLoading(false);
      return;
    }

    (async () => {
      let data: any = null;

      if (locationSlug) {
        const res = await api<any>(`/public/location/${locationSlug}`);
        data = res.data;
      } else if (locationIdParam) {
        const res = await api<any>(`/public/location-by-id/${locationIdParam}`);
        data = res.data;
      }

      if (data) {
        setLocationId(data.location?.id || "");
        setLocationName(data.location?.name || "");
        setLocationAddress(data.location?.address || "");
        setBusinessName(data.business?.name || "");
        setQueueTypes(data.queueTypes || []);
      }
      setLoading(false);
    })();
  }, [locationSlug, locationIdParam]);

  // ── Fetch entries ──
  const fetchEntries = useCallback(async () => {
    if (!locationId) return;

    const { data } = await api<{
      waiting: KioskEntry[];
      serving: KioskEntry[];
    }>(`/public/queue/entries/${locationId}`);

    if (data) {
      // Detect newly called tickets for flash + sound
      const newServingIds = data.serving.map((s) => s.id);
      const prevIds = prevServingRef.current;

      if (!initialLoadRef.current) {
        const newlyCalledEntries = data.serving.filter(
          (s) => !prevIds.includes(s.id)
        );

        if (newlyCalledEntries.length > 0) {
          const firstNew = newlyCalledEntries[0];
          setFlashTicket(firstNew.ticket_number);
          setFlashAnimation(true);

          // Play sound notification
          if (newlyCalledEntries.length > 1) {
            playBell(); // Multiple new — use bell
          } else {
            playChime(); // Single new — use chime
          }

          // Clear flash after animation completes
          setTimeout(() => {
            setFlashAnimation(false);
            setFlashTicket(null);
          }, 6000);
        }
      }

      prevServingRef.current = newServingIds;
      initialLoadRef.current = false;

      setServing(data.serving);
      setWaiting(data.waiting);
    }
  }, [locationId, playChime, playBell]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  useRealtime(
    locationId,
    () => {
      fetchEntries();
    },
    2000
  );

  // ── Fullscreen toggle ──
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // ── Waiting counts per queue type ──
  const waitingCounts: Record<string, number> = {};
  for (const w of waiting) {
    waitingCounts[w.queue_type_id] = (waitingCounts[w.queue_type_id] || 0) + 1;
  }

  const currentTime = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary">
          <Zap className="h-8 w-8 text-primary-foreground" />
        </div>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground text-lg">Loading display...</p>
      </div>
    );
  }

  // ── No location ──
  if (!locationId) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-6 px-6">
        <Ticket className="h-16 w-16 text-muted-foreground/40" />
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground mb-2">
            Kiosk Display
          </h2>
          <p className="text-muted-foreground max-w-sm">
            Navigate to{" "}
            <code className="text-xs bg-muted px-2 py-1 rounded-md">
              /kiosk/your-location-slug
            </code>{" "}
            to activate the display.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* ── Top controls (floating) ── */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        {/* Sound toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleMute}
          className={`h-10 w-10 rounded-full backdrop-blur-sm shadow-sm border border-border transition-colors ${
            isMuted
              ? "bg-card/80 text-muted-foreground"
              : "bg-primary/10 text-primary border-primary/30"
          }`}
          title={isMuted ? "Enable sound" : "Disable sound"}
        >
          {isMuted ? (
            <VolumeX className="h-5 w-5" />
          ) : (
            <Volume2 className="h-5 w-5" />
          )}
        </Button>
        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="h-10 w-10 rounded-full bg-card/80 backdrop-blur-sm shadow-sm border border-border"
        >
          {theme === "dark" ? (
            <Sun className="h-5 w-5" />
          ) : (
            <Moon className="h-5 w-5" />
          )}
        </Button>
        {/* Fullscreen toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleFullscreen}
          className="h-10 w-10 rounded-full bg-card/80 backdrop-blur-sm shadow-sm border border-border"
        >
          {isFullscreen ? (
            <Minimize className="h-5 w-5" />
          ) : (
            <Maximize className="h-5 w-5" />
          )}
        </Button>
      </div>

      {/* ── Header ── */}
      <div className="shrink-0 bg-primary px-6 py-5 text-center">
        <div className="flex items-center justify-center gap-3 mb-1">
          <Zap className="h-7 w-7 text-primary-foreground" />
          <h1 className="text-3xl font-bold text-primary-foreground tracking-tight">
            {businessName || "EM Flow"}
          </h1>
        </div>
        <div className="flex items-center justify-center gap-3 text-primary-foreground/80">
          <MapPin className="h-4 w-4" />
          <span className="text-lg">{locationName}</span>
          {locationAddress && (
            <>
              <span className="text-primary-foreground/40">|</span>
              <span className="text-sm">{locationAddress}</span>
            </>
          )}
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* ── NOW SERVING — Hero section ── */}
        <div
          className={`rounded-2xl border-2 p-6 sm:p-8 transition-all duration-700 ${
            flashAnimation
              ? "border-primary bg-gradient-to-br from-primary/10 to-primary/20 shadow-xl shadow-primary/10"
              : "border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10"
          }`}
        >
          <div className="flex items-center justify-center gap-3 mb-6">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-500 ${
                flashAnimation ? "bg-primary" : "bg-primary/20"
              }`}
            >
              {flashAnimation ? (
                <Bell className={`h-5 w-5 text-primary-foreground ${flashAnimation ? "animate-bounce" : ""}`} />
              ) : (
                <Volume2 className="h-5 w-5 text-primary" />
              )}
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-primary tracking-tight">
              Now Serving
            </h2>
            <div className="flex items-center gap-1.5 ml-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
              </span>
            </div>
            {/* Sound indicator */}
            {!isMuted && (
              <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <Volume2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Sound on</span>
              </div>
            )}
          </div>

          {serving.length === 0 ? (
            <div className="text-center py-10">
              <Clock className="mx-auto h-14 w-14 text-muted-foreground/30 mb-4" />
              <p className="text-xl text-muted-foreground">
                No one being served right now
              </p>
              <p className="text-sm text-muted-foreground/60 mt-1">
                Next customer will appear here
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {serving.map((entry) => {
                const isFlashing = flashTicket === entry.ticket_number;
                return (
                  <div
                    key={entry.id}
                    className={`flex items-center gap-4 rounded-xl border-2 p-5 sm:p-6 transition-all duration-500 ${
                      isFlashing
                        ? "border-primary bg-primary/10 shadow-lg shadow-primary/20 scale-[1.03] ring-2 ring-primary/30"
                        : "border-primary/20 bg-card"
                    }`}
                  >
                    <div
                      className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl font-bold text-2xl transition-all duration-500 ${
                        isFlashing
                          ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30 scale-110"
                          : "bg-primary text-primary-foreground"
                      }`}
                    >
                      {entry.ticket_number}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-foreground text-xl truncate">
                          {entry.customer_name || "Customer"}
                        </p>
                        {isFlashing && (
                          <Badge
                            variant="default"
                            className="shrink-0 animate-pulse text-[0.6rem] px-1.5 py-0"
                          >
                            NEW
                          </Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-0.5">
                        {entry.queue_type_name || "General"}
                      </p>
                      {entry.called_at && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Called{" "}
                          {new Date(entry.called_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Queue Status Cards ── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {queueTypes.map((qt) => {
            const count = waitingCounts[qt.id] || 0;
            return (
              <Card key={qt.id} className="overflow-hidden transition-shadow hover:shadow-md">
                <CardContent className="p-0">
                  <div className="flex items-center gap-4 p-5">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold text-2xl">
                      {qt.prefix}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground text-lg truncate">
                        {qt.name}
                      </h3>
                      <div className="flex items-center gap-4 mt-1.5">
                        <div className="flex items-center gap-1.5">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <span className="text-lg font-bold text-foreground">
                            {count}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            waiting
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="bg-muted/30 px-5 py-2.5 flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    Est. wait: ~{count * qt.estimated_service_time} min
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* ── Waiting List ── */}
        {waiting.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <h3 className="text-xl font-semibold text-foreground">
                Waiting List
              </h3>
              <Badge variant="secondary" className="text-sm">
                {waiting.length}
              </Badge>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {waiting.slice(0, 20).map((entry, idx) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-sm"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted font-semibold text-sm text-foreground">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">
                      {entry.ticket_number}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {entry.queue_type_name} — {entry.customer_name || "Customer"}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(entry.joined_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
              {waiting.length > 20 && (
                <div className="flex items-center justify-center rounded-xl border border-dashed border-border p-4">
                  <p className="text-muted-foreground text-sm">
                    +{waiting.length - 20} more
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 border-t border-border bg-card/80 backdrop-blur-sm px-6 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3" />
          Auto-refreshing
        </div>
        <div className="flex items-center gap-3">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            Live
          </span>
          <span className="text-xs text-muted-foreground">{currentTime}</span>
          <Separator orientation="vertical" className="h-3" />
          <button
            onClick={toggleMute}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            title={isMuted ? "Enable sound notifications" : "Disable sound notifications"}
          >
            {isMuted ? (
              <>
                <BellOff className="h-3 w-3" />
                <span className="hidden sm:inline">Sound off</span>
              </>
            ) : (
              <>
                <Bell className="h-3 w-3" />
                <span className="hidden sm:inline">Sound on</span>
              </>
            )}
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Zap className="h-3 w-3" />
          EM Flow
        </div>
      </div>
    </div>
  );
}

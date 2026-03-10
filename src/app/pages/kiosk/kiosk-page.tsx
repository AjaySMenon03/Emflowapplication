/**
 * Kiosk Page — /kiosk/:locationSlug
 *
 * Enhanced tablet-optimized kiosk for queue management.
 *
 * Features:
 *   - Fullscreen, no header/nav (via KioskLayout)
 *   - NOW SERVING hero banner with flash animation + sound
 *   - Next 3 waiting entries display
 *   - Staff Mode with Call Next / Mark Served / Mark No-Show
 *   - 4-digit PIN lock to prevent exiting kiosk
 *   - Low Interaction Mode (debounce, cooldowns, loading states)
 *   - Supabase Realtime (broadcast + polling fallback)
 *   - Responsive for 10–12" tablets
 *   - Dark/light theme toggle
 *   - No admin routes accessible
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router";
import { api } from "../../lib/api";
import { API_BASE, supabase } from "../../lib/supabase";
import { useRealtime } from "../../lib/use-realtime";
import { useThemeStore } from "../../stores/theme-store";
import { useKioskSound } from "../../lib/use-kiosk-sound";
import { useLocaleStore } from "../../stores/locale-store";
import {
  useNetworkStatus,
  cacheSet,
  cacheGet,
} from "../../lib/use-network-status";
import { OfflineBanner } from "../../components/offline-banner";
import { enqueue } from "../../lib/offline-queue";
import { toast } from "sonner";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Separator } from "../../components/ui/separator";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { motion, AnimatePresence } from "motion/react";
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
  Ticket,
  MapPin,
  Bell,
  BellOff,
  Lock,
  Unlock,
  LogIn,
  LogOut,
  PhoneForwarded,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Eye,
  EyeOff,
  UserCheck,
  AlertTriangle,
  Hash,
  ChevronRight,
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
  session_id?: string;
  called_at: string | null;
  joined_at: string;
  customer_phone?: string | null;
}

// ── Constants ──
const CALL_NEXT_COOLDOWN = 3000; // 3s cooldown after call-next
const ACTION_COOLDOWN = 2000; // 2s cooldown for mark-served/noshow
const MAX_WAITING_DISPLAY = 3;
const PIN_LENGTH = 4;

export function KioskPage() {
  const { locationSlug } = useParams<{ locationSlug: string }>();
  const [searchParams] = useSearchParams();
  const locationIdParam = searchParams.get("location");
  const { theme, toggleTheme } = useThemeStore();
  const { isMuted, toggleMute, playChime, playBell } = useKioskSound();
  const { t } = useLocaleStore();
  const navigate = useNavigate();

  // ── Location state ──
  const [locationId, setLocationId] = useState(locationIdParam || "");
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [queueTypes, setQueueTypes] = useState<QueueTypeInfo[]>([]);
  const [kioskPin, setKioskPin] = useState<string | null>(null);

  // ── Queue state ──
  const [serving, setServing] = useState<KioskEntry[]>([]);
  const [waiting, setWaiting] = useState<KioskEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ── Flash / Sound state ──
  const [flashTicket, setFlashTicket] = useState<string | null>(null);
  const [flashAnimation, setFlashAnimation] = useState(false);
  const prevServingRef = useRef<string[]>([]);
  const initialLoadRef = useRef(true);

  // ── Staff Mode state ──
  const [staffMode, setStaffMode] = useState(false);
  const [staffToken, setStaffToken] = useState<string | null>(null);
  const [staffName, setStaffName] = useState("");
  const [staffRole, setStaffRole] = useState("");
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // ── Lock Mode state ──
  const [isLocked, setIsLocked] = useState(false);
  const [showPinEntry, setShowPinEntry] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinAction, setPinAction] = useState<"lock" | "unlock" | "exit">(
    "lock",
  );

  // ── Low Interaction Mode state ──
  const [callNextLoading, setCallNextLoading] = useState(false);
  const [callNextCooldown, setCooldown] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ── Controls visibility ──
  const [showControls, setShowControls] = useState(true);
  const controlsTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ── Offline Resilience ──
  const KIOSK_CACHE_KEY = `kiosk-queue:${locationId}`;
  const { isOnline, isReconnecting, lastSyncedAt, markSynced } =
    useNetworkStatus({
      onReconnect: () => {
        fetchEntries();
      },
    });

  // Cache queue state whenever it updates online
  useEffect(() => {
    if (!locationId || !isOnline) return;
    if (serving.length || waiting.length) {
      cacheSet(KIOSK_CACHE_KEY, { serving, waiting });
    }
  }, [serving, waiting, locationId, isOnline]);

  // Restore from cache if offline on mount
  useEffect(() => {
    if (!isOnline && locationId && !serving.length && !waiting.length) {
      const cached = cacheGet<{ serving: KioskEntry[]; waiting: KioskEntry[] }>(
        KIOSK_CACHE_KEY,
      );
      if (cached?.data) {
        setServing(cached.data.serving || []);
        setWaiting(cached.data.waiting || []);
      }
    }
  }, [isOnline, locationId]);

  // Auto-hide controls after inactivity
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (!staffMode) setShowControls(false);
    }, 10000);
  }, [staffMode]);

  useEffect(() => {
    resetControlsTimer();
    const handler = () => resetControlsTimer();
    window.addEventListener("touchstart", handler);
    window.addEventListener("mousemove", handler);
    return () => {
      window.removeEventListener("touchstart", handler);
      window.removeEventListener("mousemove", handler);
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [resetControlsTimer]);

  // ── Block navigation when locked ──
  useEffect(() => {
    if (!isLocked) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault();
      window.history.pushState(null, "", window.location.href);
    };

    window.history.pushState(null, "", window.location.href);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isLocked]);

  // Block keyboard shortcuts when locked
  useEffect(() => {
    if (!isLocked) return;
    const handler = (e: KeyboardEvent) => {
      // Block Ctrl+L, Ctrl+D, F5, Alt+Left/Right, etc.
      if (
        (e.ctrlKey &&
          ["l", "d", "t", "n", "w"].includes(e.key.toLowerCase())) ||
        e.key === "F5" ||
        (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight"))
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [isLocked]);

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
        setKioskPin(data.location?.kiosk_pin || null);
      }
      setLoading(false);
    })();
  }, [locationSlug, locationIdParam]);

  // ── Fetch entries ──
  const fetchEntries = useCallback(async () => {
    if (!locationId) return;

    const { data } = await api<{
      waiting: KioskEntry[];
      next: KioskEntry[];
      serving: KioskEntry[];
    }>(`/public/queue/entries/${locationId}`);

    if (data) {
      const allServing = [...(data.next || []), ...(data.serving || [])];

      // Detect newly called tickets for flash + sound
      const newServingIds = allServing.map((s) => s.id);
      const prevIds = prevServingRef.current;

      if (!initialLoadRef.current) {
        const newlyCalledEntries = allServing.filter(
          (s) => !prevIds.includes(s.id),
        );

        if (newlyCalledEntries.length > 0) {
          const firstNew = newlyCalledEntries[0];
          setFlashTicket(firstNew.ticket_number);
          setFlashAnimation(true);

          if (newlyCalledEntries.length > 1) {
            playBell();
          } else {
            playChime();
          }

          setTimeout(() => {
            setFlashAnimation(false);
            setFlashTicket(null);
          }, 6000);
        }
      }

      prevServingRef.current = newServingIds;
      initialLoadRef.current = false;

      setServing(allServing);
      setWaiting(data.waiting || []);
      markSynced();
    }
  }, [locationId, playChime, playBell, markSynced]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  useRealtime(
    locationId,
    () => {
      fetchEntries();
    },
    2000,
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

  // ── Staff Login ──
  const handleStaffLogin = async () => {
    if (!loginEmail || !loginPassword) {
      setLoginError(t("kiosk.loginEmailPasswordRequired"));
      return;
    }
    setLoginLoading(true);
    setLoginError("");

    const { data, error } = await api<{
      accessToken: string;
      staff: { name: string; role: string; email: string };
    }>("/kiosk/authenticate", {
      method: "POST",
      body: { email: loginEmail, password: loginPassword, locationId },
    });

    if (error || !data) {
      setLoginError(error || t("kiosk.loginFailed"));
      setLoginLoading(false);
      return;
    }

    setStaffToken(data.accessToken);
    setStaffName(data.staff.name);
    setStaffRole(data.staff.role);
    setStaffMode(true);
    setShowLoginForm(false);
    setLoginEmail("");
    setLoginPassword("");
    setLoginLoading(false);
  };

  const handleStaffLogout = () => {
    if (isLocked) {
      setPinAction("exit");
      setShowPinEntry(true);
      return;
    }
    setStaffMode(false);
    setStaffToken(null);
    setStaffName("");
    setStaffRole("");
  };

  // ── Call Next (with Low Interaction Mode) ──
  const handleCallNext = async () => {
    if (callNextLoading || callNextCooldown || !staffToken || !isOnline) return;

    setCallNextLoading(true);

    const { data, error } = await api<{
      entry: KioskEntry | null;
      message?: string;
    }>("/kiosk/call-next", {
      method: "POST",
      body: { locationId },
      accessToken: staffToken,
    });

    setCallNextLoading(false);

    if (error) {
      console.error("[kiosk/call-next] Error:", error);
      return;
    }

    if (data?.entry) {
      // Play sound for the call
      playChime();
      // Refresh entries
      fetchEntries();
    }

    // Cooldown to prevent double-clicks
    setCooldown(true);
    cooldownTimerRef.current = setTimeout(() => {
      setCooldown(false);
    }, CALL_NEXT_COOLDOWN);
  };

  // ── Mark Served (with Low Interaction Mode) ──
  const handleMarkServed = async (entryId: string) => {
    if (actionLoadingId || !staffToken) return;
    setActionLoadingId(entryId);

    // If offline → enqueue + optimistic UI
    if (!isOnline) {
      const entry = serving.find((e) => e.id === entryId);
      setServing((prev) => prev.filter((e) => e.id !== entryId));
      enqueue(`/kiosk/mark-served/${entryId}`, {
        method: "POST",
        label: `Mark served ${entry?.ticket_number || entryId}`,
      });
      toast.info(t("offline.actionQueued"));
      setActionLoadingId(null);
      return;
    }

    await api(`/kiosk/mark-served/${entryId}`, {
      method: "POST",
      accessToken: staffToken,
    });

    setTimeout(() => {
      setActionLoadingId(null);
      fetchEntries();
    }, ACTION_COOLDOWN);
  };

  // ── Mark No-Show (with Low Interaction Mode) ──
  const handleMarkNoShow = async (entryId: string) => {
    if (actionLoadingId || !staffToken) return;
    setActionLoadingId(entryId);

    // If offline → enqueue + optimistic UI
    if (!isOnline) {
      const entry = serving.find((e) => e.id === entryId);
      setServing((prev) => prev.filter((e) => e.id !== entryId));
      enqueue(`/kiosk/mark-noshow/${entryId}`, {
        method: "POST",
        label: `Mark no-show ${entry?.ticket_number || entryId}`,
      });
      toast.info(t("offline.actionQueued"));
      setActionLoadingId(null);
      return;
    }

    await api(`/kiosk/mark-noshow/${entryId}`, {
      method: "POST",
      accessToken: staffToken,
    });

    setTimeout(() => {
      setActionLoadingId(null);
      fetchEntries();
    }, ACTION_COOLDOWN);
  };

  // ── PIN Lock/Unlock ──
  const handlePinSubmit = async () => {
    if (pinInput.length !== PIN_LENGTH) return;

    if (pinAction === "lock") {
      // If no PIN is set on the location, use the entered PIN as the session PIN
      if (!kioskPin) {
        setPinError(t("kiosk.noPinConfigured"));
        return;
      }

      // Verify PIN server-side
      const { data, error } = await api<{ valid: boolean }>(
        "/kiosk/verify-pin",
        {
          method: "POST",
          body: { locationId, pin: pinInput },
        },
      );

      if (error || !data?.valid) {
        setPinError(t("kiosk.invalidPin"));
        setPinInput("");
        return;
      }

      setIsLocked(true);
      setShowPinEntry(false);
      setPinInput("");
      setPinError("");
    } else if (pinAction === "unlock" || pinAction === "exit") {
      // Verify PIN server-side to unlock
      const { data, error } = await api<{ valid: boolean }>(
        "/kiosk/verify-pin",
        {
          method: "POST",
          body: { locationId, pin: pinInput },
        },
      );

      if (error || !data?.valid) {
        setPinError(t("kiosk.invalidPin"));
        setPinInput("");
        return;
      }

      setIsLocked(false);
      setShowPinEntry(false);
      setPinInput("");
      setPinError("");

      if (pinAction === "exit") {
        setStaffMode(false);
        setStaffToken(null);
        setStaffName("");
        setStaffRole("");
      }
    }
  };

  const openPinDialog = (action: "lock" | "unlock" | "exit") => {
    setPinAction(action);
    setPinInput("");
    setPinError("");
    setShowPinEntry(true);
  };

  // ── Waiting counts ──
  const waitingCounts: Record<string, number> = {};
  for (const w of waiting) {
    waitingCounts[w.queue_type_id] = (waitingCounts[w.queue_type_id] || 0) + 1;
  }

  const currentTime = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const totalWaiting = waiting.length;
  const displayWaiting = waiting.slice(0, MAX_WAITING_DISPLAY);

  // Cleanup
  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    };
  }, []);

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary shadow-lg">
          <Zap className="h-10 w-10 text-primary-foreground" />
        </div>
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground text-xl">
          {t("kiosk.loadingDisplay")}
        </p>
      </div>
    );
  }

  // ── No location ──
  if (!locationId) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-8 px-8">
        <Ticket className="h-24 w-24 text-muted-foreground/30" />
        <div className="text-center">
          <h2 className="text-3xl font-bold text-foreground mb-3">
            {t("kiosk.title")}
          </h2>
          <p className="text-muted-foreground text-lg max-w-md">
            {t("kiosk.navigateHint")}{" "}
            <code className="text-sm bg-muted px-3 py-1.5 rounded-lg">
              /kiosk/your-location-slug
            </code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden relative"
      onClick={resetControlsTimer}
    >
      {/* ── PIN Entry Overlay ── */}
      <AnimatePresence>
        {showPinEntry && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-card rounded-3xl p-10 shadow-2xl max-w-md w-full mx-6 border border-border"
            >
              <div className="text-center mb-8">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mx-auto mb-4">
                  {pinAction === "lock" ? (
                    <Lock className="h-8 w-8 text-primary" />
                  ) : (
                    <Unlock className="h-8 w-8 text-primary" />
                  )}
                </div>
                <h3 className="text-2xl font-bold text-foreground">
                  {pinAction === "lock"
                    ? t("kiosk.enterPinToLock")
                    : pinAction === "exit"
                      ? t("kiosk.enterPinToExit")
                      : t("kiosk.enterPinToUnlock")}
                </h3>
                <p className="text-muted-foreground mt-2 text-lg">
                  {t("kiosk.enter4DigitPin")}
                </p>
              </div>

              {/* PIN Dots */}
              <div className="flex justify-center gap-4 mb-8">
                {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-5 w-5 rounded-full transition-all duration-200 ${
                      i < pinInput.length
                        ? "bg-primary scale-110"
                        : "bg-muted border-2 border-border"
                    }`}
                  />
                ))}
              </div>

              {pinError && (
                <div className="flex items-center gap-2 text-destructive text-center justify-center mb-4">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-medium">{pinError}</span>
                </div>
              )}

              {/* Number Pad */}
              <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, "del"].map((key, i) => {
                  if (key === null) return <div key={i} />;
                  if (key === "del") {
                    return (
                      <button
                        key={i}
                        onClick={() => setPinInput((p) => p.slice(0, -1))}
                        className="h-16 rounded-2xl bg-muted hover:bg-muted/80 active:scale-95 transition-all text-lg font-semibold text-foreground flex items-center justify-center"
                      >
                        ←
                      </button>
                    );
                  }
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        if (pinInput.length < PIN_LENGTH) {
                          const newPin = pinInput + key;
                          setPinInput(newPin);
                          // Auto-submit when all digits entered
                          if (newPin.length === PIN_LENGTH) {
                            setTimeout(() => handlePinSubmit(), 200);
                          }
                        }
                      }}
                      className="h-16 rounded-2xl bg-card border border-border hover:bg-accent active:scale-95 transition-all text-2xl font-bold text-foreground shadow-sm"
                    >
                      {key}
                    </button>
                  );
                })}
              </div>

              <Button
                variant="ghost"
                onClick={() => {
                  setShowPinEntry(false);
                  setPinInput("");
                  setPinError("");
                }}
                className="w-full mt-6 text-muted-foreground text-lg h-14"
              >
                {t("common.cancel")}
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Staff Login Overlay ── */}
      <AnimatePresence>
        {showLoginForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-card rounded-3xl p-10 shadow-2xl max-w-lg w-full mx-6 border border-border"
            >
              <div className="text-center mb-8">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mx-auto mb-4">
                  <ShieldCheck className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-2xl font-bold text-foreground">
                  {t("kiosk.staffLogin")}
                </h3>
                <p className="text-muted-foreground mt-2">
                  {t("kiosk.staffLoginDesc")}
                </p>
              </div>

              <div className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-base">{t("auth.email")}</Label>
                  <Input
                    type="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="staff@example.com"
                    className="h-14 text-lg rounded-xl"
                    autoComplete="email"
                    onKeyDown={(e) => e.key === "Enter" && handleStaffLogin()}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-base">{t("auth.password")}</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="••••••••"
                      className="h-14 text-lg rounded-xl pr-14"
                      autoComplete="current-password"
                      onKeyDown={(e) => e.key === "Enter" && handleStaffLogin()}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </div>

                {loginError && (
                  <div className="flex items-center gap-2 text-destructive bg-destructive/10 rounded-xl px-4 py-3">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span className="text-sm">{loginError}</span>
                  </div>
                )}

                <Button
                  onClick={handleStaffLogin}
                  disabled={loginLoading}
                  className="w-full h-14 text-lg rounded-xl gap-2"
                >
                  {loginLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <LogIn className="h-5 w-5" />
                  )}
                  {t("kiosk.signIn")}
                </Button>

                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowLoginForm(false);
                    setLoginError("");
                  }}
                  className="w-full text-muted-foreground text-lg h-12"
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Floating Controls (top-right) ── */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-4 right-4 z-20 flex items-center gap-2"
          >
            {/* Sound toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleMute}
              className={`h-12 w-12 rounded-full backdrop-blur-sm shadow-sm border border-border transition-colors ${
                isMuted
                  ? "bg-card/80 text-muted-foreground"
                  : "bg-primary/10 text-primary border-primary/30"
              }`}
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
              className="h-12 w-12 rounded-full bg-card/80 backdrop-blur-sm shadow-sm border border-border"
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
              className="h-12 w-12 rounded-full bg-card/80 backdrop-blur-sm shadow-sm border border-border"
            >
              {isFullscreen ? (
                <Minimize className="h-5 w-5" />
              ) : (
                <Maximize className="h-5 w-5" />
              )}
            </Button>
            {/* Lock/Unlock */}
            {staffMode && kioskPin && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  isLocked ? openPinDialog("unlock") : openPinDialog("lock")
                }
                className={`h-12 w-12 rounded-full backdrop-blur-sm shadow-sm border transition-colors ${
                  isLocked
                    ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                    : "bg-card/80 border-border"
                }`}
              >
                {isLocked ? (
                  <Lock className="h-5 w-5" />
                ) : (
                  <Unlock className="h-5 w-5" />
                )}
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Staff Mode Indicator (top-left) ── */}
      <AnimatePresence>
        {staffMode && showControls && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            className="absolute top-4 left-4 z-20 flex items-center gap-2"
          >
            <div className="flex items-center gap-3 bg-card/90 backdrop-blur-sm rounded-full pl-4 pr-2 py-2 shadow-sm border border-border">
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-emerald-500" />
                <span className="text-sm font-medium text-foreground">
                  {staffName}
                </span>
                <Badge
                  variant="outline"
                  className="text-[0.6rem] px-1.5 capitalize"
                >
                  {staffRole}
                </Badge>
              </div>
              {!isLocked && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleStaffLogout}
                  className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              )}
            </div>
            {isLocked && (
              <div className="flex items-center gap-1.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-3 py-1.5 rounded-full text-xs font-medium border border-amber-500/20">
                <Lock className="h-3 w-3" />
                {t("kiosk.locked")}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header Bar ── */}
      <div className="shrink-0 bg-primary px-6 py-5 md:py-6">
        <div className="flex items-center justify-center gap-3 mb-1">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
            <Zap className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-primary-foreground tracking-tight">
            {businessName || "Quecumber"}
          </h1>
        </div>
        <div className="flex items-center justify-center gap-3 text-primary-foreground/80">
          <MapPin className="h-4 w-4" />
          <span className="text-lg md:text-xl">{locationName}</span>
          {locationAddress && (
            <>
              <span className="text-primary-foreground/40">·</span>
              <span className="text-sm md:text-base">{locationAddress}</span>
            </>
          )}
        </div>
      </div>

      {/* ── Offline Banner ── */}
      <OfflineBanner
        isOnline={isOnline}
        isReconnecting={isReconnecting}
        lastSyncedAt={lastSyncedAt}
      />

      {/* ── Main Content ── */}
      <div className="flex-1 overflow-auto p-4 md:p-8 space-y-6 md:space-y-8">
        {/* ── NOW SERVING — Hero Section ── */}
        <div
          className={`rounded-3xl border-2 p-6 md:p-10 transition-all duration-700 ${
            flashAnimation
              ? "border-primary bg-gradient-to-br from-primary/10 to-primary/20 shadow-xl shadow-primary/10"
              : "border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10"
          }`}
        >
          <div className="flex items-center justify-center gap-3 mb-6 md:mb-8">
            <div
              className={`flex h-12 w-12 md:h-14 md:w-14 items-center justify-center rounded-full transition-colors duration-500 ${
                flashAnimation ? "bg-primary" : "bg-primary/20"
              }`}
            >
              {flashAnimation ? (
                <Bell className="h-6 w-6 md:h-7 md:w-7 text-primary-foreground animate-bounce" />
              ) : (
                <PhoneForwarded className="h-6 w-6 md:h-7 md:w-7 text-primary" />
              )}
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold text-primary tracking-tight uppercase">
              {t("kiosk.now_serving")}
            </h2>
            <span className="relative flex h-3.5 w-3.5 ml-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-emerald-500" />
            </span>
          </div>

          {serving.length === 0 ? (
            <div className="text-center py-12 md:py-16">
              <Clock className="mx-auto h-16 w-16 md:h-20 md:w-20 text-muted-foreground/20 mb-5" />
              <p className="text-xl md:text-2xl text-muted-foreground font-medium">
                {t("kiosk.no_one_serving")}
              </p>
              <p className="text-base md:text-lg text-muted-foreground/60 mt-2">
                {t("kiosk.nextUp")}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {serving.map((entry) => {
                const isFlashing = flashTicket === entry.ticket_number;
                const isActionLoading = actionLoadingId === entry.id;
                return (
                  <motion.div
                    key={entry.id}
                    layout
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className={`relative rounded-2xl border-2 p-5 md:p-7 transition-all duration-500 ${
                      isFlashing
                        ? "border-primary bg-primary/10 shadow-lg shadow-primary/20 ring-2 ring-primary/30"
                        : "border-primary/20 bg-card"
                    }`}
                  >
                    <div className="flex items-center gap-4 md:gap-5">
                      <div
                        className={`flex h-20 w-20 md:h-24 md:w-24 shrink-0 items-center justify-center rounded-2xl font-bold text-2xl md:text-3xl transition-all duration-500 ${
                          isFlashing
                            ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30 scale-105"
                            : "bg-primary text-primary-foreground"
                        }`}
                      >
                        {entry.ticket_number}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-foreground text-xl md:text-2xl truncate">
                            {entry.customer_name || "Customer"}
                          </p>
                          {isFlashing && (
                            <Badge
                              variant="default"
                              className="shrink-0 animate-pulse text-xs px-2"
                            >
                              NEW
                            </Badge>
                          )}
                        </div>
                        <p className="text-muted-foreground text-base md:text-lg mt-1">
                          {entry.queue_type_name || "General"}
                        </p>
                        {entry.called_at && (
                          <p className="text-sm text-muted-foreground/70 mt-1">
                            {t("kiosk.calledAt")}{" "}
                            {new Date(entry.called_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Staff Actions on serving entries */}
                    {staffMode && (
                      <div className="flex gap-2 mt-4">
                        <Button
                          onClick={() => handleMarkServed(entry.id)}
                          disabled={!!isActionLoading}
                          className="flex-1 h-12 md:h-14 text-base rounded-xl gap-2"
                          variant="default"
                        >
                          {isActionLoading ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-5 w-5" />
                          )}
                          {t("kiosk.markServed")}
                        </Button>
                        <Button
                          onClick={() => handleMarkNoShow(entry.id)}
                          disabled={!!isActionLoading}
                          className="h-12 md:h-14 text-base rounded-xl gap-2 px-5"
                          variant="destructive"
                        >
                          {isActionLoading ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <XCircle className="h-5 w-5" />
                          )}
                          {t("kiosk.noShow")}
                        </Button>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Next Up: Waiting Queue ── */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="text-xl md:text-2xl font-bold text-foreground">
                {t("kiosk.upNext")}
              </h3>
              <Badge
                variant="secondary"
                className="text-base md:text-lg px-3 py-1 h-auto"
              >
                {totalWaiting}
              </Badge>
            </div>
            {totalWaiting > MAX_WAITING_DISPLAY && (
              <span className="text-muted-foreground text-sm md:text-base">
                +{totalWaiting - MAX_WAITING_DISPLAY} {t("kiosk.moreWaiting")}
              </span>
            )}
          </div>

          {displayWaiting.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/30 py-10 md:py-14 text-center">
              <Users className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-lg text-muted-foreground">
                {t("kiosk.noCustomersWaiting")}
              </p>
            </div>
          ) : (
            <div className="grid gap-3 md:gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {displayWaiting.map((entry, idx) => (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 md:p-6 transition-shadow hover:shadow-md"
                >
                  <div className="flex h-14 w-14 md:h-16 md:w-16 shrink-0 items-center justify-center rounded-xl bg-muted font-bold text-lg md:text-xl text-foreground">
                    #{idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground text-lg md:text-xl truncate">
                      {entry.ticket_number}
                    </p>
                    <p className="text-muted-foreground text-sm md:text-base truncate">
                      {entry.queue_type_name} —{" "}
                      {entry.customer_name || "Customer"}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm md:text-base text-muted-foreground">
                      {new Date(entry.joined_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* ── Queue Type Stats ── */}
        <div className="grid gap-3 md:gap-4 grid-cols-2 lg:grid-cols-4">
          {queueTypes.map((qt) => {
            const count = waitingCounts[qt.id] || 0;
            return (
              <Card key={qt.id} className="overflow-hidden rounded-2xl">
                <CardContent className="p-0">
                  <div className="flex items-center gap-3 md:gap-4 p-4 md:p-5">
                    <div className="flex h-14 w-14 md:h-16 md:w-16 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold text-xl md:text-2xl">
                      {qt.prefix}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-foreground text-base md:text-lg truncate">
                        {qt.name}
                      </h4>
                      <div className="flex items-center gap-2 mt-1">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="text-lg md:text-xl font-bold text-foreground">
                          {count}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {t("kiosk.waiting")}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-muted/30 px-4 md:px-5 py-2 md:py-2.5 flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    {t("kiosk.estWait")}: ~{count * qt.estimated_service_time}{" "}
                    {t("queue.min")}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* ── Bottom Action Bar ── */}
      <div className="shrink-0 border-t border-border bg-card/95 backdrop-blur-sm px-4 md:px-8 py-3 md:py-4">
        <div className="flex items-center justify-between">
          {/* Left: Status indicators */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm md:text-base text-muted-foreground">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                {t("common.live")}
              </span>
            </div>
            <span className="text-sm md:text-base text-muted-foreground font-mono">
              {currentTime}
            </span>
            <button
              onClick={toggleMute}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {isMuted ? (
                <BellOff className="h-4 w-4" />
              ) : (
                <Bell className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Center: Call Next button (staff mode only) */}
          {staffMode ? (
            <Button
              onClick={handleCallNext}
              disabled={
                callNextLoading || callNextCooldown || totalWaiting === 0
              }
              size="lg"
              className={`h-14 md:h-16 px-8 md:px-12 text-lg md:text-xl font-bold rounded-2xl gap-3 shadow-lg transition-all duration-300 ${
                callNextCooldown
                  ? "opacity-60 cursor-not-allowed"
                  : "hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]"
              }`}
            >
              {callNextLoading ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : callNextCooldown ? (
                <Clock className="h-6 w-6" />
              ) : (
                <PhoneForwarded className="h-6 w-6" />
              )}
              {callNextLoading
                ? t("kiosk.calling")
                : callNextCooldown
                  ? t("kiosk.pleaseWait")
                  : `${t("kiosk.callNext")} (${totalWaiting})`}
            </Button>
          ) : (
            <Button
              onClick={() => setShowLoginForm(true)}
              variant="outline"
              className="h-12 md:h-14 px-6 md:px-8 text-base md:text-lg rounded-xl gap-2"
            >
              <ShieldCheck className="h-5 w-5" />
              {t("kiosk.enableStaffMode")}
            </Button>
          )}

          {/* Right: Branding */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Zap className="h-4 w-4" />
            <span className="hidden md:inline font-medium">Quecumber</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * EmergencyControlsPanel — Owner-only pilot emergency controls.
 *
 * Actions:
 *   1. Pause Queue  — prevent new joins
 *   2. Close Queue  — close session + cancel all WAITING
 *   3. Broadcast    — custom notice on join/status pages
 *
 * All actions require AlertDialog confirmation before executing.
 * All actions are logged to the audit trail.
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { useLocaleStore } from "../stores/locale-store";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Textarea } from "./ui/textarea";
import { Separator } from "./ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import {
  ShieldAlert,
  PauseCircle,
  PlayCircle,
  Power,
  Megaphone,
  Loader2,
  AlertTriangle,
  XCircle,
} from "lucide-react";

interface EmergencyState {
  paused: boolean;
  broadcast: string | null;
  paused_at: string | null;
  broadcast_at: string | null;
}

interface EmergencyControlsProps {
  locationId: string;
  accessToken: string;
  onStateChange?: () => void;
}

type ConfirmAction = "pause" | "resume" | "close" | "broadcast" | "clearBroadcast" | null;

export function EmergencyControlsPanel({
  locationId,
  accessToken,
  onStateChange,
}: EmergencyControlsProps) {
  const { t } = useLocaleStore();

  const [state, setState] = useState<EmergencyState>({
    paused: false,
    broadcast: null,
    paused_at: null,
    broadcast_at: null,
  });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [broadcastDraft, setBroadcastDraft] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!locationId || !accessToken) return;
    const { data } = await api<{ emergency: EmergencyState }>(
      `/emergency/status/${locationId}`,
      { accessToken }
    );
    if (data?.emergency) {
      setState(data.emergency);
      // Auto-expand if there are active emergency states
      if (data.emergency.paused || data.emergency.broadcast) {
        setExpanded(true);
      }
    }
    setLoading(false);
  }, [locationId, accessToken]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // ── Action handlers ──

  const executePause = async (shouldPause: boolean) => {
    setActionLoading("pause");
    const { data, error } = await api<{ emergency: EmergencyState }>(
      `/emergency/pause/${locationId}`,
      {
        method: "POST",
        accessToken,
        body: { pause: shouldPause },
      }
    );
    if (error) {
      toast.error(error);
    } else if (data?.emergency) {
      setState(data.emergency);
      toast.success(
        shouldPause
          ? t("emergency.pauseSuccess")
          : t("emergency.resumeSuccess")
      );
      onStateChange?.();
    }
    setActionLoading(null);
    setConfirmAction(null);
  };

  const executeClose = async () => {
    setActionLoading("close");
    const { data, error } = await api<{
      cancelledEntries: number;
      closedSessions: number;
      emergency: EmergencyState;
    }>(`/emergency/close/${locationId}`, {
      method: "POST",
      accessToken,
    });
    if (error) {
      toast.error(error);
    } else if (data) {
      setState(data.emergency);
      toast.success(
        t("emergency.closeSuccess")
          .replace("{cancelled}", String(data.cancelledEntries))
          .replace("{sessions}", String(data.closedSessions))
      );
      onStateChange?.();
    }
    setActionLoading(null);
    setConfirmAction(null);
  };

  const executeBroadcast = async (message: string | null) => {
    setActionLoading("broadcast");
    const { data, error } = await api<{ emergency: EmergencyState }>(
      `/emergency/broadcast/${locationId}`,
      {
        method: "POST",
        accessToken,
        body: { message },
      }
    );
    if (error) {
      toast.error(error);
    } else if (data?.emergency) {
      setState(data.emergency);
      if (message) {
        toast.success(t("emergency.broadcastSuccess"));
        setBroadcastDraft("");
      } else {
        toast.success(t("emergency.broadcastCleared"));
      }
      onStateChange?.();
    }
    setActionLoading(null);
    setConfirmAction(null);
  };

  const handleConfirm = () => {
    switch (confirmAction) {
      case "pause":
        executePause(true);
        break;
      case "resume":
        executePause(false);
        break;
      case "close":
        executeClose();
        break;
      case "broadcast":
        executeBroadcast(broadcastDraft.trim());
        break;
      case "clearBroadcast":
        executeBroadcast(null);
        break;
    }
  };

  const getConfirmTitle = (): string => {
    switch (confirmAction) {
      case "pause":
        return t("emergency.confirmPauseTitle");
      case "resume":
        return t("emergency.confirmResumeTitle");
      case "close":
        return t("emergency.confirmCloseTitle");
      case "broadcast":
        return t("emergency.confirmBroadcastTitle");
      case "clearBroadcast":
        return t("emergency.confirmClearBroadcastTitle");
      default:
        return "";
    }
  };

  const getConfirmDesc = (): string => {
    switch (confirmAction) {
      case "pause":
        return t("emergency.confirmPauseDesc");
      case "resume":
        return t("emergency.confirmResumeDesc");
      case "close":
        return t("emergency.confirmCloseDesc");
      case "broadcast":
        return t("emergency.confirmBroadcastDesc").replace(
          "{message}",
          broadcastDraft.trim()
        );
      case "clearBroadcast":
        return t("emergency.confirmClearBroadcastDesc");
      default:
        return "";
    }
  };

  const isDestructive =
    confirmAction === "close" || confirmAction === "clearBroadcast";

  if (loading) return null;

  const hasActiveState = state.paused || !!state.broadcast;

  return (
    <>
      <Card
        className={`transition-all border-2 ${
          hasActiveState
            ? "border-red-500/40 bg-red-50/30 dark:bg-red-950/10"
            : "border-amber-500/20 bg-amber-50/20 dark:bg-amber-950/10"
        }`}
      >
        <CardHeader className="p-3 pb-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShieldAlert
                className={`h-4 w-4 ${
                  hasActiveState ? "text-red-500" : "text-amber-500"
                }`}
              />
              {t("emergency.title")}
              {state.paused && (
                <Badge
                  variant="destructive"
                  className="text-[0.65rem] px-1.5 py-0"
                >
                  {t("emergency.paused")}
                </Badge>
              )}
              {state.broadcast && (
                <Badge className="text-[0.65rem] px-1.5 py-0 bg-blue-500 hover:bg-blue-600">
                  {t("emergency.broadcasting")}
                </Badge>
              )}
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="h-7 text-xs"
            >
              {expanded ? t("emergency.collapse") : t("emergency.expand")}
            </Button>
          </div>
        </CardHeader>

        {expanded && (
          <CardContent className="p-3 pt-2 space-y-3">
            {/* ── Active Status Indicators ── */}
            {state.paused && (
              <div className="flex items-center gap-2 rounded-lg bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-3 py-2 text-sm">
                <PauseCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                <div className="flex-1">
                  <span className="font-medium text-red-700 dark:text-red-300">
                    {t("emergency.queuePausedBanner")}
                  </span>
                  {state.paused_at && (
                    <span className="text-xs text-red-500 dark:text-red-400 ml-2">
                      {new Date(state.paused_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
              </div>
            )}

            {state.broadcast && (
              <div className="flex items-start gap-2 rounded-lg bg-blue-100 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 px-3 py-2 text-sm">
                <Megaphone className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-blue-700 dark:text-blue-300 text-xs uppercase tracking-wide">
                    {t("emergency.activeBroadcast")}
                  </span>
                  <p className="text-blue-800 dark:text-blue-200 mt-0.5 break-words">
                    {state.broadcast}
                  </p>
                </div>
                <button
                  onClick={() => setConfirmAction("clearBroadcast")}
                  className="p-0.5 rounded text-blue-400 hover:text-blue-600 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors shrink-0"
                >
                  <XCircle className="h-4 w-4" />
                </button>
              </div>
            )}

            <Separator />

            {/* ── Action Buttons ── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {/* Pause / Resume */}
              <Button
                variant={state.paused ? "default" : "outline"}
                size="sm"
                className={`gap-2 ${
                  state.paused
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                    : "border-amber-300 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                }`}
                onClick={() =>
                  setConfirmAction(state.paused ? "resume" : "pause")
                }
                disabled={!!actionLoading}
              >
                {actionLoading === "pause" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : state.paused ? (
                  <PlayCircle className="h-4 w-4" />
                ) : (
                  <PauseCircle className="h-4 w-4" />
                )}
                {state.paused
                  ? t("emergency.resumeQueue")
                  : t("emergency.pauseQueue")}
              </Button>

              {/* Close Queue */}
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-red-300 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30"
                onClick={() => setConfirmAction("close")}
                disabled={!!actionLoading}
              >
                {actionLoading === "close" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Power className="h-4 w-4" />
                )}
                {t("emergency.closeQueue")}
              </Button>

              {/* Broadcast */}
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-blue-300 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                onClick={() => {
                  if (broadcastDraft.trim()) {
                    setConfirmAction("broadcast");
                  }
                }}
                disabled={!!actionLoading || !broadcastDraft.trim()}
              >
                {actionLoading === "broadcast" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Megaphone className="h-4 w-4" />
                )}
                {t("emergency.sendBroadcast")}
              </Button>
            </div>

            {/* ── Broadcast draft input ── */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("emergency.broadcastMessage")}
              </label>
              <Textarea
                value={broadcastDraft}
                onChange={(e) => setBroadcastDraft(e.target.value)}
                placeholder={t("emergency.broadcastPlaceholder")}
                className="resize-none text-sm h-16"
                maxLength={280}
              />
              <p className="text-xs text-muted-foreground text-right">
                {broadcastDraft.length}/280
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ── Confirmation Dialog ── */}
      <AlertDialog
        open={!!confirmAction}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle
                className={`h-5 w-5 ${
                  isDestructive ? "text-red-500" : "text-amber-500"
                }`}
              />
              {getConfirmTitle()}
            </AlertDialogTitle>
            <AlertDialogDescription>{getConfirmDesc()}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!actionLoading}>
              {t("emergency.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={!!actionLoading}
              className={
                isDestructive
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : ""
              }
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {t("emergency.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

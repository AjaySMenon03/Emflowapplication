/**
 * OfflineQueueDrawer — Dismissible side-sheet showing pending offline mutations.
 *
 * Features:
 *   - Lists all queued actions with labels and timestamps
 *   - Remove individual items
 *   - Clear all
 *   - Replay now (if online)
 *   - Auto-refreshes on open
 */
import { useState, useEffect, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "./ui/sheet";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import {
  UploadCloud,
  Trash2,
  PlayCircle,
  X,
  Clock,
  CloudOff,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useLocaleStore } from "../stores/locale-store";
import {
  getPending,
  getPendingCount,
  clearAll,
  replay,
  type QueuedMutation,
} from "../lib/offline-queue";

interface OfflineQueueDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isOnline: boolean;
  accessToken?: string | null;
  /** Called after a successful replay so the page can refetch */
  onReplayComplete?: () => void;
}

export function OfflineQueueDrawer({
  open,
  onOpenChange,
  isOnline,
  accessToken,
  onReplayComplete,
}: OfflineQueueDrawerProps) {
  const { t } = useLocaleStore();
  const [items, setItems] = useState<QueuedMutation[]>([]);
  const [replaying, setReplaying] = useState(false);
  const [replayResult, setReplayResult] = useState<{
    succeeded: number;
    failed: number;
  } | null>(null);

  const refresh = useCallback(() => {
    setItems(getPending());
  }, []);

  // Refresh items when drawer opens
  useEffect(() => {
    if (open) {
      refresh();
      setReplayResult(null);
    }
  }, [open, refresh]);

  const handleRemove = (id: string) => {
    // Remove from localStorage by filtering
    const remaining = items.filter((item) => item.id !== id);
    // Re-save
    try {
      localStorage.setItem(
        "em-flow-offline-queue",
        JSON.stringify(remaining)
      );
    } catch {
      // ignore
    }
    setItems(remaining);
  };

  const handleClearAll = () => {
    clearAll();
    setItems([]);
  };

  const handleReplay = async () => {
    if (!accessToken) return;
    setReplaying(true);
    setReplayResult(null);

    const result = await replay(accessToken);
    setReplayResult({
      succeeded: result.succeeded,
      failed: result.failed,
    });

    refresh();
    setReplaying(false);

    if (result.succeeded > 0) {
      onReplayComplete?.();
    }
  };

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <UploadCloud className="h-5 w-5 text-amber-500" />
            {t("offline.drawerTitle")}
            {items.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {items.length}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            {t("offline.drawerDesc")}
          </SheetDescription>
        </SheetHeader>

        {/* Replay result banner */}
        {replayResult && (
          <div
            className={`mx-1 rounded-lg px-3 py-2.5 text-sm flex items-center gap-2 ${
              replayResult.failed > 0
                ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                : "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
            }`}
          >
            {replayResult.failed > 0 ? (
              <AlertCircle className="h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            )}
            <span>
              {replayResult.failed > 0
                ? t("offline.replayPartial")
                    .replace("{succeeded}", String(replayResult.succeeded))
                    .replace("{total}", String(replayResult.succeeded + replayResult.failed))
                    .replace("{failed}", String(replayResult.failed))
                : t("offline.replaySuccess").replace(
                    "{succeeded}",
                    String(replayResult.succeeded)
                  )}
            </span>
          </div>
        )}

        {/* Items list */}
        <ScrollArea className="flex-1 -mx-2 px-2">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CloudOff className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">
                {t("offline.noQueuedActions")}
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                {t("offline.noQueuedActionsDesc")}
              </p>
            </div>
          ) : (
            <div className="space-y-2 py-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5 group"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 shrink-0 mt-0.5">
                    <UploadCloud className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {item.label}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{formatTime(item.queuedAt)}</span>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="font-mono text-[0.65rem]">
                        {item.method} {item.path.split("/").slice(-2).join("/")}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemove(item.id)}
                    className="p-1 rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                    title="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer actions */}
        {items.length > 0 && (
          <SheetFooter className="flex-col gap-2 sm:flex-col">
            {isOnline && accessToken && (
              <Button
                className="w-full gap-2"
                onClick={handleReplay}
                disabled={replaying}
              >
                <PlayCircle className="h-4 w-4" />
                {replaying
                  ? t("offline.replayingActions").replace("{count}", String(items.length))
                  : `${t("offline.replayNow")} (${items.length})`}
              </Button>
            )}
            <Button
              variant="outline"
              className="w-full gap-2 text-destructive hover:bg-destructive/10"
              onClick={handleClearAll}
              disabled={replaying}
            >
              <Trash2 className="h-4 w-4" />
              {t("offline.clearAllActions")}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
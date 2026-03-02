/**
 * OfflineBanner — Animated top banner for offline / reconnect states.
 *
 * Shows:
 *   - Amber banner when offline (with "last synced X ago" + pending actions count)
 *   - Green "reconnected — replaying N actions" banner briefly after coming back online
 *   - Smooth slide-down animation via Motion
 */
import { useState, useEffect } from "react";
import { WifiOff, Wifi, Loader2, CloudOff, UploadCloud } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useLocaleStore } from "../stores/locale-store";
import { formatTimeAgo } from "../lib/use-network-status";
import { getPendingCount } from "../lib/offline-queue";

interface OfflineBannerProps {
  isOnline: boolean;
  isReconnecting: boolean;
  lastSyncedAt?: number | null;
  pendingCount?: number;
}

export function OfflineBanner({
  isOnline,
  isReconnecting,
  lastSyncedAt = null,
  pendingCount: pendingCountProp,
}: OfflineBannerProps) {
  const { t } = useLocaleStore();

  // Live-updating "X ago" string
  const [timeAgo, setTimeAgo] = useState(() => formatTimeAgo(lastSyncedAt));
  useEffect(() => {
    if (isOnline || !lastSyncedAt) return;
    // Update every 10s while offline
    setTimeAgo(formatTimeAgo(lastSyncedAt));
    const id = setInterval(() => setTimeAgo(formatTimeAgo(lastSyncedAt)), 10_000);
    return () => clearInterval(id);
  }, [isOnline, lastSyncedAt]);

  // Pending mutation count (use prop if provided, else read from queue)
  const pendingCount = pendingCountProp ?? (!isOnline ? getPendingCount() : 0);

  const showBanner = !isOnline || isReconnecting;

  return (
    <AnimatePresence>
      {showBanner && (
        <motion.div
          key={isOnline ? "reconnecting" : "offline"}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          className="overflow-hidden shrink-0 z-50"
        >
          {!isOnline ? (
            <div className="flex flex-col items-center gap-1 bg-amber-500 dark:bg-amber-600 px-4 py-2.5 text-white text-sm font-medium">
              <div className="flex items-center gap-2">
                <WifiOff className="h-4 w-4 shrink-0" />
                <span>{t("offline.banner")}</span>
              </div>
              {/* Last synced indicator + pending actions */}
              <div className="flex items-center gap-3 text-xs text-white/80 font-normal">
                {lastSyncedAt && timeAgo && (
                  <span className="flex items-center gap-1">
                    <CloudOff className="h-3 w-3" />
                    {t("offline.lastSynced")}: {timeAgo}
                  </span>
                )}
                {pendingCount > 0 && (
                  <span className="flex items-center gap-1">
                    <UploadCloud className="h-3 w-3" />
                    {pendingCount} {t("offline.pendingActions")}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 bg-emerald-500 dark:bg-emerald-600 px-4 py-2.5 text-white text-sm font-medium">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              >
                <Loader2 className="h-4 w-4 shrink-0" />
              </motion.div>
              <span>
                {pendingCount > 0
                  ? t("offline.replayingActions").replace("{count}", String(pendingCount))
                  : t("offline.reconnecting")}
              </span>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * PWA Install Banner — Prompts mobile users to install the app.
 *
 * Shows a dismissible banner at the bottom of the screen when:
 *  - The browser fires beforeinstallprompt (Chrome/Edge/Samsung)
 *  - The app is not already installed
 *  - The user hasn't dismissed the banner in this session
 *
 * Also shows a notification opt-in prompt for supported browsers.
 */
import { useState, useEffect } from "react";
import { useInstallPrompt, usePushNotifications } from "../lib/use-pwa";
import { Button } from "./ui/button";
import { X, Download, Bell, Smartphone, Zap } from "lucide-react";

const DISMISSED_KEY = "em-flow-install-dismissed";

export function PWAInstallBanner() {
  const { canInstall, isInstalled, promptInstall } = useInstallPrompt();
  const { permission, isSupported, requestPermission } = usePushNotifications();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return true;
    return sessionStorage.getItem(DISMISSED_KEY) === "true";
  });
  const [notifDismissed, setNotifDismissed] = useState(false);

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem(DISMISSED_KEY, "true");
  };

  const handleInstall = async () => {
    const accepted = await promptInstall();
    if (accepted) {
      handleDismiss();
    }
  };

  const handleEnableNotifications = async () => {
    await requestPermission();
    setNotifDismissed(true);
  };

  // Don't show if installed, dismissed, or can't install
  const showInstallBanner = canInstall && !isInstalled && !dismissed;
  const showNotifBanner =
    !showInstallBanner &&
    isSupported &&
    permission === "default" &&
    !notifDismissed &&
    !dismissed;

  if (!showInstallBanner && !showNotifBanner) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 p-3 sm:p-4 animate-slide-up">
      <div className="mx-auto max-w-lg">
        {showInstallBanner ? (
          <div className="relative rounded-2xl border border-border bg-card shadow-xl backdrop-blur-sm p-4 flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <Smartphone className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-foreground text-sm">
                Install Quecumber
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Add to home screen for the best experience — faster access,
                offline support & push notifications.
              </p>
              <div className="flex items-center gap-2 mt-2.5">
                <Button
                  size="sm"
                  onClick={handleInstall}
                  className="h-8 text-xs gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" />
                  Install App
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDismiss}
                  className="h-8 text-xs text-muted-foreground"
                >
                  Not now
                </Button>
              </div>
            </div>
            <button
              onClick={handleDismiss}
              className="absolute top-2 right-2 p-1 rounded-full text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : showNotifBanner ? (
          <div className="relative rounded-2xl border border-border bg-card shadow-xl backdrop-blur-sm p-4 flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-500/10">
              <Bell className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-foreground text-sm">
                Enable Notifications
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Get notified instantly when it's your turn — never miss your
                call.
              </p>
              <div className="flex items-center gap-2 mt-2.5">
                <Button
                  size="sm"
                  onClick={handleEnableNotifications}
                  className="h-8 text-xs gap-1.5"
                >
                  <Bell className="h-3.5 w-3.5" />
                  Enable
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setNotifDismissed(true)}
                  className="h-8 text-xs text-muted-foreground"
                >
                  Later
                </Button>
              </div>
            </div>
            <button
              onClick={() => setNotifDismissed(true)}
              className="absolute top-2 right-2 p-1 rounded-full text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

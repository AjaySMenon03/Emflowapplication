/**
 * usePWA — Progressive Web App hooks
 *
 * Features:
 *   - Service worker registration
 *   - Install prompt detection (beforeinstallprompt)
 *   - Push notification subscription
 *   - Notification permission management
 *   - Install state tracking
 */
import { useState, useEffect, useCallback, useRef } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// ── Service Worker Registration ──
export function useServiceWorker() {
  const [registered, setRegistered] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Only register in production (sw.js may not exist in dev/preview)
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        setRegistration(reg);
        setRegistered(true);
        console.log("[SW] Registered with scope:", reg.scope);
      })
      .catch((err) => {
        // Silently ignore — SW isn't critical for app functionality
        console.log("[SW] Registration skipped:", err.message || err);
      });
  }, []);

  return { registered, registration };
}

// ── Install Prompt ──
export function useInstallPrompt() {
  const [canInstall, setCanInstall] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
      return;
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setCanInstall(true);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setCanInstall(false);
      deferredPromptRef.current = null;
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPromptRef.current) return false;

    deferredPromptRef.current.prompt();
    const result = await deferredPromptRef.current.userChoice;
    deferredPromptRef.current = null;
    setCanInstall(false);

    return result.outcome === "accepted";
  }, []);

  return { canInstall, isInstalled, promptInstall };
}

// ── Push Notifications ──
export type NotificationPermission = "default" | "granted" | "denied";

export function usePushNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return "default";
    return Notification.permission as NotificationPermission;
  });
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported("Notification" in window && "serviceWorker" in navigator);
  }, []);

  const requestPermission = useCallback(async () => {
    if (!("Notification" in window)) return "denied" as NotificationPermission;

    const result = await Notification.requestPermission();
    setPermission(result as NotificationPermission);
    return result as NotificationPermission;
  }, []);

  /**
   * Show a local notification immediately.
   * Useful for foreground notifications (e.g. when the page is open).
   */
  const showNotification = useCallback(
    async (title: string, options?: NotificationOptions) => {
      if (permission !== "granted") {
        const newPerm = await requestPermission();
        if (newPerm !== "granted") return;
      }

      // Use service worker registration if available
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, {
          icon: "/icon-192.png",
          badge: "/icon-72.png",
          vibrate: [200, 100, 200],
          ...options,
        });
      } else {
        // Fallback to basic Notification API
        new Notification(title, options);
      }
    },
    [permission, requestPermission]
  );

  return { permission, isSupported, requestPermission, showNotification };
}

// ── Combined PWA hook ──
export function usePWA() {
  const sw = useServiceWorker();
  const install = useInstallPrompt();
  const push = usePushNotifications();

  return {
    ...sw,
    ...install,
    ...push,
  };
}
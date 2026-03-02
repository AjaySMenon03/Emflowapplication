/**
 * EM Flow - Enterprise Queue Management System
 * Main application entry point.
 */
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { AuthProvider } from "./components/auth-provider";
import { ErrorBoundary } from "./components/error-boundary";
import { Toaster } from "./components/ui/sonner";
import { PWAInstallBanner } from "./components/pwa-install-banner";
import { useServiceWorker } from "./lib/use-pwa";
import { useEffect } from "react";

function PWAInit() {
  useServiceWorker();

  // Inject manifest link into head
  useEffect(() => {
    if (!document.querySelector('link[rel="manifest"]')) {
      const link = document.createElement("link");
      link.rel = "manifest";
      link.href = "/manifest.json";
      document.head.appendChild(link);
    }
    // Set theme color meta tag
    if (!document.querySelector('meta[name="theme-color"]')) {
      const meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.content = "#6366f1";
      document.head.appendChild(meta);
    }
    // Set apple-mobile-web-app meta tags
    if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
      const capable = document.createElement("meta");
      capable.name = "apple-mobile-web-app-capable";
      capable.content = "yes";
      document.head.appendChild(capable);

      const statusBar = document.createElement("meta");
      statusBar.name = "apple-mobile-web-app-status-bar-style";
      statusBar.content = "black-translucent";
      document.head.appendChild(statusBar);
    }
  }, []);

  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <PWAInit />
        <RouterProvider router={router} />
        <Toaster position="bottom-right" richColors closeButton />
        <PWAInstallBanner />
      </AuthProvider>
    </ErrorBoundary>
  );
}
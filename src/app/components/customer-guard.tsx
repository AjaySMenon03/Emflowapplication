/**
 * CustomerGuard - Protects customer routes.
 * Redirects:
 * - Not authenticated -> /login
 * - Staff/admin users -> /admin
 * - Authenticated customer or no role -> allowed (auto-registers as customer)
 */
import { useEffect, useRef } from "react";
import { Navigate, Outlet } from "react-router";
import { useAuthStore } from "../stores/auth-store";
import { api } from "../lib/api";
import { Loader2, Zap } from "lucide-react";

export function CustomerGuard() {
  const { isAuthenticated, isLoading, role, hasOnboarded, session } = useAuthStore();
  const registeredRef = useRef(false);

  // Auto-register as customer if no role
  useEffect(() => {
    if (!isLoading && isAuthenticated && !role && hasOnboarded && session?.access_token && !registeredRef.current) {
      registeredRef.current = true;
      api("/customer/register", {
        method: "POST",
        body: {},
        accessToken: session.access_token,
      }).catch(() => {});
    }
  }, [isLoading, isAuthenticated, role, hasOnboarded, session]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Zap className="h-6 w-6 text-primary-foreground" />
          </div>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // New user who hasn't completed onboarding → send to onboarding
  if (!hasOnboarded && !role) {
    return <Navigate to="/onboarding" replace />;
  }

  // If user is staff/admin/owner, redirect to admin
  if (role === "owner" || role === "admin" || role === "staff") {
    return <Navigate to="/admin" replace />;
  }

  return <Outlet />;
}

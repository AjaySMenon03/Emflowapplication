/**
 * AuthGuard - Protects admin routes.
 * Redirects based on auth state and role:
 * - Not authenticated → /login
 * - Authenticated but no role (new user) → /onboarding
 * - Authenticated with role → allowed through
 */
import { Navigate, Outlet } from "react-router";
import { useAuthStore } from "../stores/auth-store";
import { Loader2, Zap } from "lucide-react";

export function AuthGuard() {
  const { isAuthenticated, isLoading, hasOnboarded, role } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Zap className="h-6 w-6 text-primary-foreground" />
          </div>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground text-sm">Loading EM Flow...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // New user with no role → onboarding
  if (!hasOnboarded && !role) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}

/**
 * OnboardingGuard - Requires authentication but NOT full role.
 * Used for the onboarding flow.
 */
import { Navigate, Outlet } from "react-router";
import { useAuthStore } from "../stores/auth-store";
import { Loader2, Zap } from "lucide-react";

export function OnboardingGuard() {
  const { isAuthenticated, isLoading, hasOnboarded, role } = useAuthStore();

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

  // Already onboarded? Go to admin
  if (hasOnboarded && role) {
    return <Navigate to="/admin" replace />;
  }

  return <Outlet />;
}

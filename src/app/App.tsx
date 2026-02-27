/**
 * EM Flow - Enterprise Queue Management System
 * Main application entry point.
 */
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { AuthProvider } from "./components/auth-provider";
import { ErrorBoundary } from "./components/error-boundary";
import { Toaster } from "./components/ui/sonner";

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" richColors closeButton />
      </AuthProvider>
    </ErrorBoundary>
  );
}

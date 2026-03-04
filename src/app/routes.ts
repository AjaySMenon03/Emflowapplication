/**
 * EM Flow Router Configuration
 *
 * Route groups:
 *   (public)      - / , /login, /join/:slug, /status/:id  → PublicLayout / standalone
 *   (onboarding)  - /onboarding                           → Standalone (auth required)
 *   (admin)       - /admin/*                               → AdminLayout (protected)
 *   (kiosk)       - /kiosk, /kiosk/:locationSlug           → KioskLayout (no chrome)
 *   (customer)    - /customer/*                            → CustomerLayout (authenticated customers)
 */
import { createBrowserRouter } from "react-router";
import { PublicLayout } from "./layouts/public-layout";
import { AdminLayout } from "./layouts/admin-layout";
import { KioskLayout } from "./layouts/kiosk-layout";
import { CustomerLayout } from "./layouts/customer-layout";
import { AuthGuard } from "./components/auth-guard";
import { CustomerGuard } from "./components/customer-guard";
import { OnboardingGuard } from "./components/onboarding-guard";
import { HomePage } from "./pages/public/home-page";
import { LoginPage } from "./pages/public/login-page";
import { JoinPage } from "./pages/public/join-page";
import { StatusPage } from "./pages/public/status-page";
import { OnboardingPage } from "./pages/onboarding/onboarding-page";
import { DashboardPage } from "./pages/admin/dashboard-page";
import { QueuesPage } from "./pages/admin/queues-page";
import { UsersPage } from "./pages/admin/users-page";
import { ReportsPage } from "./pages/admin/reports-page";
import { SettingsPage } from "./pages/admin/settings-page";
import { AuditPage } from "./pages/admin/audit-page";
import { AnalyticsPage } from "./pages/admin/analytics-page";
import { QRStandPage } from "./pages/admin/qr-stand-page";
import { ProfilePage } from "./pages/admin/profile-page";
import { KioskPage } from "./pages/kiosk/kiosk-page";
import { CustomerDashboard } from "./pages/customer/customer-dashboard";
import { CustomerHistory } from "./pages/customer/customer-history";
import { CustomerProfilePage } from "./pages/customer/customer-profile";
import { NotFoundPage } from "./pages/not-found-page";

export const router = createBrowserRouter([
  // ── (public) route group ──
  {
    path: "/",
    Component: PublicLayout,
    children: [
      { index: true, Component: HomePage },
      { path: "login", Component: LoginPage },
    ],
  },

  // ── Customer public flow (standalone, no chrome) ──
  {
    path: "/join/:locationSlug",
    Component: JoinPage,
  },
  {
    path: "/status/:entryId",
    Component: StatusPage,
  },

  // ── (onboarding) — requires auth only ──
  {
    path: "/onboarding",
    Component: OnboardingGuard,
    children: [{ index: true, Component: OnboardingPage }],
  },

  // ── (admin) route group — protected + onboarded ─
  {
    path: "/admin",
    Component: AuthGuard,
    children: [
      {
        Component: AdminLayout,
        children: [
          { index: true, Component: DashboardPage },
          { path: "queues", Component: QueuesPage },
          { path: "users", Component: UsersPage },
          { path: "reports", Component: ReportsPage },
          { path: "settings", Component: SettingsPage },
          { path: "audit", Component: AuditPage },
          { path: "audit/:locationId", Component: AuditPage },
          { path: "analytics", Component: AnalyticsPage },
          { path: "qr", Component: QRStandPage },
          { path: "qr/:locationId", Component: QRStandPage },
          { path: "profile", Component: ProfilePage },
        ],
      },
    ],
  },

  // ── (customer) route group — authenticated customers ──
  {
    path: "/customer",
    Component: CustomerGuard,
    children: [
      {
        Component: CustomerLayout,
        children: [
          { index: true, Component: CustomerDashboard },
          { path: "history", Component: CustomerHistory },
          { path: "profile", Component: CustomerProfilePage },
        ],
      },
    ],
  },

  // ── (kiosk) route group — fullscreen, no auth ──
  {
    path: "/kiosk",
    Component: KioskLayout,
    children: [
      { index: true, Component: KioskPage },
      { path: ":locationSlug", Component: KioskPage },
    ],
  },

  // ── Catch-all 404 ──
  {
    path: "*",
    Component: PublicLayout,
    children: [{ path: "*", Component: NotFoundPage }],
  },
]);
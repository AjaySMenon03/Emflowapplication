/**
 * Admin Layout - Navigation shell for authenticated admin routes.
 * Clean SaaS sidebar with smooth transitions, i18n, and offline queue badge.
 */
import { useState, useEffect } from "react";
import { Outlet, NavLink, useNavigate } from "react-router";
import {
  LayoutDashboard,
  Users,
  Settings,
  ListOrdered,
  BarChart3,
  Menu,
  X,
  LogOut,
  Zap,
  ScrollText,
  TrendingUp,
  QrCode,
  UploadCloud,
} from "lucide-react";
import { ThemeToggle } from "../components/theme-toggle";
import { LocaleSwitcher } from "../components/locale-switcher";
import { useLocaleStore } from "../stores/locale-store";
import { useAuthStore } from "../stores/auth-store";
import { supabase } from "../lib/supabase";
import { getPendingCount } from "../lib/offline-queue";
import { OfflineQueueDrawer } from "../components/offline-queue-drawer";
import { useNetworkStatus } from "../lib/use-network-status";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import { Badge } from "../components/ui/badge";

const navItems = [
  {
    path: "/admin",
    icon: LayoutDashboard,
    labelKey: "nav.dashboard",
    end: true,
  },
  { path: "/admin/queues", icon: ListOrdered, labelKey: "nav.queues" },
  { path: "/admin/users", icon: Users, labelKey: "nav.customers" },
  { path: "/admin/reports", icon: BarChart3, labelKey: "nav.reports" },
  {
    path: "/admin/analytics",
    icon: TrendingUp,
    labelKey: "nav.analytics",
    ownerOnly: true,
  },
  { path: "/admin/qr", icon: QrCode, labelKey: "nav.qrStand" },
  { path: "/admin/settings", icon: Settings, labelKey: "nav.settings" },
  {
    path: "/admin/audit",
    icon: ScrollText,
    labelKey: "nav.audit",
    ownerOnly: true,
  },
];

export function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { t } = useLocaleStore();
  const { user, session, staffRecord } = useAuthStore();
  const navigate = useNavigate();

  // ── Offline queue awareness ──
  const { isOnline } = useNetworkStatus();
  const [pendingCount, setPendingCount] = useState(() => getPendingCount());
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Poll pending count every 3s (localStorage doesn't have events)
  useEffect(() => {
    const id = setInterval(() => setPendingCount(getPendingCount()), 3000);
    return () => clearInterval(id);
  }, []);

  // Also refresh when drawer closes or online state changes
  useEffect(() => {
    setPendingCount(getPendingCount());
  }, [drawerOpen, isOnline]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <div className="flex h-screen w-full bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar
          transition-transform duration-300 ease-in-out
          lg:static lg:translate-x-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Brand */}
        <div className="flex h-16 items-center gap-2.5 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-sm">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sidebar-foreground tracking-tight">
            Quecumber
          </span>
          <button
            className="ml-auto lg:hidden p-1 rounded-md hover:bg-sidebar-accent transition-colors"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5 text-sidebar-foreground" />
          </button>
        </div>

        <Separator />

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {navItems
            .filter((item) => !item.ownerOnly || staffRecord?.role === "owner")
            .map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.end}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200 ${
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  }`
                }
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{t(item.labelKey)}</span>
                {/* Pending actions badge on Queues nav item */}
                {item.path === "/admin/queues" && pendingCount > 0 && (
                  <Badge
                    variant="destructive"
                    className="h-5 min-w-5 px-1.5 text-[0.6rem] flex items-center justify-center rounded-full animate-pulse"
                  >
                    {pendingCount}
                  </Badge>
                )}
              </NavLink>
            ))}

          {/* ── Offline Queue Button (visible when pending > 0) ── */}
          {pendingCount > 0 && (
            <>
              <Separator className="my-2" />
              <button
                onClick={() => setDrawerOpen(true)}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm w-full text-left transition-all duration-200 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 group"
              >
                <UploadCloud className="h-4 w-4 shrink-0" />
                <span className="flex-1">{t("offline.viewQueuedActions")}</span>
                <Badge
                  variant="outline"
                  className="h-5 min-w-5 px-1.5 text-[0.6rem] border-amber-500/30 text-amber-600 dark:text-amber-400"
                >
                  {pendingCount}
                </Badge>
              </button>
            </>
          )}
        </nav>

        <Separator />

        {/* User section */}
        <div className="p-3">
          <div
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition-all duration-200 hover:bg-sidebar-accent/50"
            onClick={() => {
              setSidebarOpen(false);
              navigate("/admin/profile");
            }}
            title="View profile settings"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 shrink-0 overflow-hidden">
              {user?.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt="Profile"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-sm font-semibold text-primary">
                  {(staffRecord?.name || user?.email || "U")
                    .charAt(0)
                    .toUpperCase()}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sidebar-foreground text-sm font-medium">
                {staffRecord?.name || user?.email || "Admin"}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Badge
                  variant="outline"
                  className="text-[0.6rem] h-[18px] px-1.5 capitalize border-sidebar-border"
                >
                  {staffRecord?.role
                    ? t(`role.${staffRecord.role}`) || staffRecord.role
                    : "User"}
                </Badge>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            className="mt-1 w-full justify-start gap-3 text-sidebar-foreground/70 hover:text-sidebar-foreground text-sm"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            {t("common.logout")}
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 items-center gap-4 border-b border-border bg-background/95 backdrop-blur-sm px-4 lg:px-6">
          <button
            className="lg:hidden p-1.5 rounded-md hover:bg-accent transition-colors"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5 text-foreground" />
          </button>

          <div className="flex-1" />

          {/* Pending actions indicator in top bar (mobile) */}
          {pendingCount > 0 && (
            <button
              onClick={() => setDrawerOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 px-3 py-1.5 text-xs font-medium hover:bg-amber-500/20 transition-colors"
            >
              <UploadCloud className="h-3.5 w-3.5" />
              <span>{pendingCount}</span>
            </button>
          )}

          <LocaleSwitcher />
          <ThemeToggle />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>

      {/* Offline Queue Drawer */}
      <OfflineQueueDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        isOnline={isOnline}
        accessToken={session?.access_token}
        onReplayComplete={() => {
          setPendingCount(getPendingCount());
        }}
      />
    </div>
  );
}

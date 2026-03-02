/**
 * Customer Layout - Navigation shell for authenticated customer routes.
 * Clean, modern, card-based SaaS design with soft gradients.
 */
import { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router";
import {
  LayoutDashboard,
  History,
  UserCircle,
  Menu,
  X,
  LogOut,
  Zap,
  ChevronRight,
} from "lucide-react";
import { ThemeToggle } from "../components/theme-toggle";
import { LocaleSwitcher } from "../components/locale-switcher";
import { useLocaleStore } from "../stores/locale-store";
import { useAuthStore } from "../stores/auth-store";
import { supabase } from "../lib/supabase";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";

const navItems = [
  { path: "/customer", icon: LayoutDashboard, labelKey: "customer.dashboard", end: true },
  { path: "/customer/history", icon: History, labelKey: "customer.history" },
  { path: "/customer/profile", icon: UserCircle, labelKey: "customer.profile" },
];

export function CustomerLayout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { t } = useLocaleStore();
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          {/* Brand */}
          <NavLink to="/customer" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-md shadow-primary/20">
              <Zap className="h-4.5 w-4.5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-foreground tracking-tight text-lg">
              EM Flow
            </span>
          </NavLink>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? "bg-primary/10 text-primary shadow-sm"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`
                }
              >
                <item.icon className="h-4 w-4" />
                <span>{t(item.labelKey)}</span>
              </NavLink>
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeToggle />
            <div className="hidden md:flex items-center gap-2 ml-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <span className="text-xs font-semibold text-primary">
                  {(user?.user_metadata?.name || user?.email || "C").charAt(0).toUpperCase()}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>

            {/* Mobile menu toggle */}
            <button
              className="md:hidden p-2 rounded-lg hover:bg-accent transition-colors"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5 text-foreground" />
              ) : (
                <Menu className="h-5 w-5 text-foreground" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Nav */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border/50 bg-background/95 backdrop-blur-xl">
            <nav className="flex flex-col p-3 gap-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.end}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center justify-between rounded-lg px-4 py-3 text-sm font-medium transition-all ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    }`
                  }
                >
                  <div className="flex items-center gap-3">
                    <item.icon className="h-4 w-4" />
                    <span>{t(item.labelKey)}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 opacity-40" />
                </NavLink>
              ))}
              <Separator className="my-2" />
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-all"
              >
                <LogOut className="h-4 w-4" />
                <span>{t("common.logout")}</span>
              </button>
            </nav>
          </div>
        )}
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}

/**
 * Public Layout - Minimal layout for public-facing pages (landing, login).
 * Clean, accessible header with smooth transitions.
 */
import { Outlet, Link } from "react-router";
import { Zap } from "lucide-react";
import { ThemeToggle } from "../components/theme-toggle";
import { LocaleSwitcher } from "../components/locale-switcher";
import { useLocaleStore } from "../stores/locale-store";

export function PublicLayout() {
  const { t } = useLocaleStore();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex h-14 items-center justify-between border-b border-border bg-background/95 backdrop-blur-sm px-6 sticky top-0 z-50">
        <Link
          to="/"
          className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-sm">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-foreground tracking-tight">
            EM Flow
          </span>
        </Link>

        <div className="flex items-center gap-1">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>

      {/* Content */}
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-4 bg-background">
        <p className="text-center text-xs text-muted-foreground">
          &copy; 2026 EM Flow. All rights reserved.
        </p>
      </footer>
    </div>
  );
}

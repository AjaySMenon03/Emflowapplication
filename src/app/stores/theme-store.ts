/**
 * Theme Store (Zustand)
 * Manages dark/light mode with localStorage persistence.
 */
import { create } from "zustand";

type Theme = "light" | "dark" | "system";

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "system";
  return (localStorage.getItem("em-flow-theme") as Theme) ?? "system";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  root.classList.toggle("dark", isDark);
  localStorage.setItem("em-flow-theme", theme);
}

export const useThemeStore = create<ThemeState>((set, get) => {
  // Apply initial theme
  const initial = getInitialTheme();
  if (typeof window !== "undefined") {
    applyTheme(initial);
  }

  return {
    theme: initial,
    setTheme: (theme) => {
      applyTheme(theme);
      set({ theme });
    },
    toggleTheme: () => {
      const current = get().theme;
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next);
      set({ theme: next });
    },
  };
});

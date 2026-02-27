/**
 * Locale Store (Zustand)
 * Manages i18n / multilingual state.
 *
 * Features:
 *   - Browser language auto-detection
 *   - Manual switching
 *   - Persistent preference in localStorage
 *   - 4 languages: English, Hindi, Tamil, Malayalam
 */
import { create } from "zustand";
import { en } from "../lib/translations/en";
import { hi } from "../lib/translations/hi";
import { ta } from "../lib/translations/ta";
import { ml } from "../lib/translations/ml";

export type Locale = "en" | "hi" | "ta" | "ml";

export const LOCALE_LABELS: Record<Locale, { label: string; nativeLabel: string; dir: "ltr" | "rtl" }> = {
  en: { label: "English", nativeLabel: "English", dir: "ltr" },
  hi: { label: "Hindi", nativeLabel: "हिन्दी", dir: "ltr" },
  ta: { label: "Tamil", nativeLabel: "தமிழ்", dir: "ltr" },
  ml: { label: "Malayalam", nativeLabel: "മലയാളം", dir: "ltr" },
};

const translations: Record<Locale, Record<string, string>> = {
  en,
  hi,
  ta,
  ml,
};

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, fallback?: string) => string;
}

/**
 * Auto-detect browser language, mapping to supported locales.
 * Priority: localStorage > navigator.languages > 'en'
 */
function detectBrowserLocale(): Locale {
  if (typeof window === "undefined") return "en";

  // Check localStorage first
  const stored = localStorage.getItem("em-flow-locale");
  if (stored && stored in translations) return stored as Locale;

  // Map browser languages to our supported locales
  const langMap: Record<string, Locale> = {
    en: "en",
    hi: "hi",
    ta: "ta",
    ml: "ml",
  };

  const browserLangs = navigator.languages || [navigator.language || "en"];
  for (const lang of browserLangs) {
    const primary = lang.split("-")[0].toLowerCase();
    if (primary in langMap) return langMap[primary];
  }

  return "en";
}

export const useLocaleStore = create<LocaleState>((set, get) => ({
  locale: detectBrowserLocale(),

  setLocale: (locale) => {
    localStorage.setItem("em-flow-locale", locale);
    set({ locale });
  },

  t: (key: string, fallback?: string) => {
    const { locale } = get();
    // Try current locale, then fallback to English, then key itself
    return translations[locale]?.[key] ?? translations.en?.[key] ?? fallback ?? key;
  },
}));

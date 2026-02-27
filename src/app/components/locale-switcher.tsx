import { Globe, Check } from "lucide-react";
import { useLocaleStore, LOCALE_LABELS, type Locale } from "../stores/locale-store";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function LocaleSwitcher() {
  const { locale, setLocale } = useLocaleStore();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 shrink-0 h-9 px-2.5">
          <Globe className="h-4 w-4" />
          <span className="text-xs font-medium hidden sm:inline">
            {LOCALE_LABELS[locale].nativeLabel}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {(Object.keys(LOCALE_LABELS) as Locale[]).map((loc) => (
          <DropdownMenuItem
            key={loc}
            onClick={() => setLocale(loc)}
            className="flex items-center justify-between gap-3"
          >
            <div className="flex flex-col">
              <span className="text-sm">{LOCALE_LABELS[loc].nativeLabel}</span>
              <span className="text-xs text-muted-foreground">
                {LOCALE_LABELS[loc].label}
              </span>
            </div>
            {locale === loc && (
              <Check className="h-4 w-4 text-primary shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * 404 Not Found Page
 */
import { Link } from "react-router";
import { useLocaleStore } from "../stores/locale-store";
import { Button } from "../components/ui/button";
import { Home, Search } from "lucide-react";

export function NotFoundPage() {
  const { t } = useLocaleStore();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center animate-fade-in">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-muted">
        <Search className="h-10 w-10 text-muted-foreground/50" />
      </div>
      <div>
        <h1 className="text-5xl font-bold text-foreground tracking-tight">404</h1>
        <p className="text-muted-foreground mt-2 text-lg">{t("error.notFound")}</p>
        <p className="text-muted-foreground text-sm mt-1 max-w-sm">
          {t("error.notFoundDesc")}
        </p>
      </div>
      <Button asChild className="gap-2 mt-2">
        <Link to="/">
          <Home className="h-4 w-4" />
          {t("error.goHome")}
        </Link>
      </Button>
    </div>
  );
}

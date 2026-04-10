/**
 * Public Home / Landing Page
 */
import { Link } from "react-router";
import { useLocaleStore } from "../../stores/locale-store";
import { useAuthStore } from "../../stores/auth-store";
import { Button } from "../../components/ui/button";
import { Zap, ArrowRight, Users, Globe, Bell, LayoutDashboard } from "lucide-react";

export function HomePage() {
  const { t } = useLocaleStore();
  const { isAuthenticated, role, hasOnboarded } = useAuthStore();

  const features = [
    {
      icon: Users,
      title: t("landing.feature1Title"),
      desc: t("landing.feature1Desc"),
    },
    {
      icon: Globe,
      title: t("landing.feature2Title"),
      desc: t("landing.feature2Desc"),
    },
    {
      icon: Bell,
      title: t("landing.feature3Title"),
      desc: t("landing.feature3Desc"),
    },
  ];

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12 text-center animate-fade-in">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/20">
        <Zap className="h-8 w-8 text-primary-foreground" />
      </div>

      <div className="space-y-3 max-w-lg">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          {t("common.welcome")}
        </h1>
        <p className="text-muted-foreground text-lg">
          {t("common.description")}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {isAuthenticated && !hasOnboarded && !role ? (
          <Button asChild size="lg" className="gap-2 font-semibold">
            <Link to="/onboarding">
              {t("landing.getStarted")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        ) : isAuthenticated && (role === "customer" || !role) ? (
          <Button asChild size="lg" className="gap-2 font-semibold">
            <Link to="/customer">
              <LayoutDashboard className="h-4 w-4" />
              {t("customer.dashboard")}
            </Link>
          </Button>
        ) : (
          <Button asChild size="lg" className="gap-2 font-semibold">
            <Link to="/login">
              {t("landing.getStarted")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        )}
        <Button variant="outline" size="lg" asChild>
          <Link to="/kiosk">{t("landing.kioskMode")}</Link>
        </Button>
      </div>

      <div className="mt-8 grid max-w-3xl gap-4 sm:grid-cols-3 w-full">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="rounded-xl border border-border bg-card p-5 text-left transition-shadow hover:shadow-md"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 mb-3">
              <feature.icon className="h-4 w-4 text-primary" />
            </div>
            <h3 className="text-card-foreground font-semibold">{feature.title}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {feature.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
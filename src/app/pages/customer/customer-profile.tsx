/**
 * Customer Profile — /customer/profile
 * Editable name, phone, preferred language. Email is read-only from Supabase auth.
 */
import { useState, useEffect } from "react";
import { motion } from "motion/react";
import {
  UserCircle,
  Mail,
  Phone,
  Globe,
  Save,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { Separator } from "../../components/ui/separator";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/auth-store";
import { useLocaleStore, type Locale, LOCALE_LABELS } from "../../stores/locale-store";

interface CustomerProfile {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  preferred_language: string;
  created_at: string;
}

export function CustomerProfilePage() {
  const { session, user } = useAuthStore();
  const { t, setLocale } = useLocaleStore();

  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState<Locale>("en");

  useEffect(() => {
    async function load() {
      if (!session?.access_token) return;
      setLoading(true);

      const { data, error: err } = await api<{ customer: CustomerProfile | null }>(
        "/customer/profile",
        { accessToken: session.access_token }
      );

      if (data?.customer) {
        setProfile(data.customer);
        setName(data.customer.name || "");
        setPhone(data.customer.phone || "");
        setPreferredLanguage((data.customer.preferred_language as Locale) || "en");
      } else {
        // No profile yet — pre-fill from auth
        setName(user?.user_metadata?.name || "");
        setPhone(user?.phone || "");
      }

      if (err) setError(err);
      setLoading(false);
    }
    load();
  }, [session?.access_token, user]);

  const handleSave = async () => {
    if (!session?.access_token) return;
    setSaving(true);
    setError("");
    setSaved(false);

    const { data, error: err } = await api<{ customer: CustomerProfile }>(
      "/customer/profile",
      {
        method: "PUT",
        body: {
          name: name.trim(),
          phone: phone.trim() || null,
          preferredLanguage,
        },
        accessToken: session.access_token,
      }
    );

    if (err) {
      setError(err);
    } else if (data?.customer) {
      setProfile(data.customer);
      setSaved(true);
      // Also update locale store
      setLocale(preferredLanguage);
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-2xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  const email = profile?.email || user?.email || "";
  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold text-foreground">{t("customer.profileTitle")}</h1>
        <p className="text-muted-foreground text-sm mt-0.5">{t("customer.profileSubtitle")}</p>
      </motion.div>

      {/* Avatar Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <Card className="border-0 shadow-md overflow-hidden">
          <div className="h-20 bg-gradient-to-r from-primary/20 via-primary/10 to-accent/20" />
          <CardContent className="-mt-10 pb-6">
            <div className="flex items-end gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 shadow-lg shadow-primary/20 border-4 border-background">
                <span className="text-2xl font-bold text-primary-foreground">
                  {(name || email || "C").charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="pb-1">
                <p className="text-lg font-semibold text-foreground">{name || t("customer.defaultName")}</p>
                {memberSince && (
                  <p className="text-xs text-muted-foreground">
                    {t("customer.memberSince")} {memberSince}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Profile Form */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <Card className="border-0 shadow-md">
          <CardHeader>
            <CardTitle className="text-base">{t("customer.personalInfo")}</CardTitle>
            <CardDescription className="text-xs">{t("customer.personalInfoDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="profile-name" className="text-xs flex items-center gap-1.5">
                <UserCircle className="h-3.5 w-3.5 text-muted-foreground" />
                {t("auth.name")}
              </Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("customer.namePlaceholder")}
              />
            </div>

            {/* Email (read-only) */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                {t("auth.email")}
                <span className="text-[10px] text-muted-foreground/60 ml-1">({t("customer.readOnly")})</span>
              </Label>
              <Input
                value={email}
                disabled
                className="bg-muted/50 cursor-not-allowed"
              />
            </div>

            {/* Phone */}
            <div className="space-y-1.5">
              <Label htmlFor="profile-phone" className="text-xs flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                {t("queue.phone")}
              </Label>
              <Input
                id="profile-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
              />
            </div>

            <Separator />

            {/* Preferred Language */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                {t("customer.preferredLanguage")}
              </Label>
              <Select value={preferredLanguage} onValueChange={(v) => setPreferredLanguage(v as Locale)}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(LOCALE_LABELS) as Locale[]).map((loc) => (
                    <SelectItem key={loc} value={loc}>
                      {LOCALE_LABELS[loc].nativeLabel} ({LOCALE_LABELS[loc].label})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                <p className="text-destructive text-sm">{error}</p>
              </div>
            )}

            {/* Save */}
            <div className="flex items-center justify-between pt-2">
              {saved && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-sm font-medium">{t("settings.saved")}</span>
                </motion.div>
              )}
              <div className="flex-1" />
              <Button
                onClick={handleSave}
                disabled={saving || !name.trim()}
                className="gap-2"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {t("common.save")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

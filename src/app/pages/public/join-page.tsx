/**
 * Customer Join Page — /join/:locationSlug
 *
 * Mobile-first responsive page where customers:
 * 1. See available queue types for the location
 * 2. Enter name, phone, email
 * 3. Select queue type
 * 4. Join the queue and get redirected to /status/:entryId
 */
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import { api } from "../../lib/api";
import { useLocaleStore, type Locale, LOCALE_LABELS } from "../../stores/locale-store";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Zap,
  Loader2,
  MapPin,
  Clock,
  Users,
  Ticket,
  Globe,
  CheckCircle2,
} from "lucide-react";

interface QueueTypeInfo {
  id: string;
  name: string;
  prefix: string;
  description: string | null;
  estimated_service_time: number;
}

interface LocationInfo {
  id: string;
  name: string;
  address: string | null;
  business_id: string;
}

export function JoinPage() {
  const { locationSlug } = useParams<{ locationSlug: string }>();
  const navigate = useNavigate();
  const { locale, setLocale, t } = useLocaleStore();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [location, setLocation] = useState<LocationInfo | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [queueTypes, setQueueTypes] = useState<QueueTypeInfo[]>([]);

  // Form
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [selectedQueueType, setSelectedQueueType] = useState("");

  // Language auto-detection is handled by the locale store on init

  // Load location data
  useEffect(() => {
    async function load() {
      if (!locationSlug) return;
      setLoading(true);
      setError("");

      const { data, error: apiErr } = await api<{
        location: LocationInfo;
        business: { name: string };
        queueTypes: QueueTypeInfo[];
      }>(`/public/location/${locationSlug}`);

      if (apiErr || !data) {
        setError(apiErr || "Location not found");
        setLoading(false);
        return;
      }

      setLocation(data.location);
      setBusinessName(data.business?.name || "");
      setQueueTypes(data.queueTypes || []);
      if (data.queueTypes?.length === 1) {
        setSelectedQueueType(data.queueTypes[0].id);
      }
      setLoading(false);
    }
    load();
  }, [locationSlug]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("Please enter your name");
      return;
    }
    if (!selectedQueueType) {
      setError("Please select a service");
      return;
    }

    setSubmitting(true);
    try {
      const { data, error: apiErr } = await api<{
        entry: { id: string; ticket_number: string };
        position: number;
        estimatedMinutes: number;
      }>("/public/queue/join", {
        method: "POST",
        body: {
          queueTypeId: selectedQueueType,
          locationId: location!.id,
          businessId: location!.business_id,
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          locale,
        },
      });

      if (apiErr || !data) {
        setError(apiErr || "Failed to join queue");
        return;
      }

      navigate(`/status/${data.entry.id}`);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
            <Zap className="h-7 w-7 text-primary-foreground" />
          </div>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // ── Location not found ──
  if (!location) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="py-12">
            <MapPin className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-foreground mb-2">Location Not Found</h2>
            <p className="text-muted-foreground text-sm">
              {error || "The location you're looking for doesn't exist."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background">
      {/* Top bar */}
      <div className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-sm font-medium text-foreground">
              {businessName || "EM Flow"}
            </span>
          </div>
          {/* Language switcher */}
          <div className="flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
              <SelectTrigger className="h-8 w-24 text-xs border-0 bg-transparent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(LOCALE_LABELS) as Locale[]).map((loc) => (
                  <SelectItem key={loc} value={loc} className="text-xs">
                    {LOCALE_LABELS[loc].nativeLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-lg px-4 py-6 sm:py-10">
        {/* Location header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-semibold text-foreground mb-1">
            {t("kiosk.title")}
          </h1>
          <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
            <MapPin className="h-3.5 w-3.5" />
            <span>{location.name}</span>
          </div>
          {location.address && (
            <p className="text-xs text-muted-foreground mt-1">
              {location.address}
            </p>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
            <p className="text-destructive text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleJoin} className="space-y-4">
          {/* Queue type selection */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("kiosk.select_service")}</CardTitle>
              <CardDescription className="text-xs">
                Choose the service you need
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {queueTypes.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No services available at this location
                </p>
              ) : (
                queueTypes.map((qt) => (
                  <button
                    key={qt.id}
                    type="button"
                    onClick={() => setSelectedQueueType(qt.id)}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                      selectedQueueType === qt.id
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                        : "border-border hover:border-primary/30 hover:bg-accent/30"
                    }`}
                  >
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-semibold text-sm ${
                        selectedQueueType === qt.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {qt.prefix}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-foreground">
                        {qt.name}
                      </p>
                      {qt.description && (
                        <p className="text-xs text-muted-foreground truncate">
                          {qt.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                      <Clock className="h-3 w-3" />
                      ~{qt.estimated_service_time}m
                    </div>
                    {selectedQueueType === qt.id && (
                      <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                    )}
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          {/* Customer details */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Your Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="join-name" className="text-xs">
                  Name *
                </Label>
                <Input
                  id="join-name"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="join-phone" className="text-xs">
                  Phone
                </Label>
                <Input
                  id="join-phone"
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="join-email" className="text-xs">
                  Email
                </Label>
                <Input
                  id="join-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Submit */}
          <Button
            type="submit"
            className="w-full h-12 text-base"
            disabled={submitting || !selectedQueueType || !name.trim()}
          >
            {submitting ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Ticket className="mr-2 h-5 w-5" />
            )}
            Join Queue
          </Button>
        </form>
      </div>
    </div>
  );
}
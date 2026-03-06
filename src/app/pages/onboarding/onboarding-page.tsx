/**
 * Multi-step Owner Onboarding Flow
 * Steps: Business Info → Location → Queue Types → Hours → WhatsApp → Staff
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuthStore } from "../../stores/auth-store";
import {
  useOnboardingStore,
  ONBOARDING_STEPS,
} from "../../stores/onboarding-store";
import { api } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import { COUNTRIES } from "../../lib/countries";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Separator } from "../../components/ui/separator";
import { Switch } from "../../components/ui/switch";
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
  Check,
  Plus,
  Trash2,
  Building2,
  MapPin,
  ListOrdered,
  Clock,
  MessageCircle,
  Users,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";

const STEP_ICONS = [
  Building2,
  MapPin,
  ListOrdered,
  Clock,
  MessageCircle,
  Users,
];

const INDUSTRIES = ["Healthcare", "Saloon", "Hospitality"];

const TIMEZONES = Intl.supportedValuesOf("timeZone");

export function OnboardingPage() {
  const navigate = useNavigate();
  const { session } = useAuthStore();
  const store = useOnboardingStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /** Always get a fresh access token — never trust the cached one */
  const getFreshToken = async (): Promise<string | null> => {
    // First try the current session
    const currentToken = session?.access_token;
    if (currentToken) {
      // Quick decode to check expiry
      try {
        const payload = JSON.parse(atob(currentToken.split(".")[1]));
        const expiresAt = payload.exp * 1000;
        // If token expires in more than 60s, it's fine
        if (expiresAt - Date.now() > 60_000) return currentToken;
      } catch {
        // decode failed — refresh
      }
    }

    // Guard: check if a session exists before calling refreshSession().
    // Without this, refreshSession() throws "Invalid Refresh Token: Refresh Token Not Found".
    const { data: existing } = await supabase.auth.getSession();
    if (!existing?.session) return null;

    // Token is missing or near-expiry — refresh
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        console.warn("[Onboarding] Token refresh failed:", error.message);
        return null;
      }
      return data?.session?.access_token ?? null;
    } catch (err: any) {
      console.warn("[Onboarding] Token refresh error:", err?.message);
      return null;
    }
  };

  const handleNext = async () => {
    setError("");

    // Guard: get a valid token or redirect
    const accessToken = await getFreshToken();
    if (!accessToken) {
      navigate("/login", { replace: true });
      return;
    }

    // Validate current step
    const validationError = validateStep(store.currentStep);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    try {
      // Save data progressively at each step
      if (store.currentStep === 1) {
        const { data, error: apiError } = await api<{
          business: { id: string };
          staffUser: any;
        }>("/onboarding/business", {
          method: "POST",
          accessToken,
          body: {
            name: store.businessName,
            industry: store.industry,
            phone: store.businessPhone,
            email: store.businessEmail,
            address: store.businessAddress,
            ownerName: store.ownerName,
          },
        });
        if (apiError) throw new Error(apiError);
        store.updateField("createdBusinessId", data!.business.id);
      }

      if (store.currentStep === 2) {
        const { data, error: apiError } = await api<{
          location: { id: string };
        }>("/onboarding/location", {
          method: "POST",
          accessToken,
          body: {
            businessId: store.createdBusinessId,
            name: store.locationName,
            address: store.locationAddress,
            city: store.locationCity,
            phone: store.locationPhone,
            timezone: store.timezone,
            country: store.country,
          },
        });
        if (apiError) throw new Error(apiError);
        store.updateField("createdLocationId", data!.location.id);
      }

      if (store.currentStep === 3) {
        const validQueues = store.queueTypes.filter((qt) => qt.name.trim());
        if (validQueues.length === 0)
          throw new Error("Add at least one queue type");
        const { error: apiError } = await api("/onboarding/queue-types", {
          method: "POST",
          accessToken,
          body: {
            businessId: store.createdBusinessId,
            locationId: store.createdLocationId,
            queueTypes: validQueues,
          },
        });
        if (apiError) throw new Error(apiError);
      }

      if (store.currentStep === 4) {
        const { error: apiError } = await api("/onboarding/business-hours", {
          method: "POST",
          accessToken,
          body: {
            businessId: store.createdBusinessId,
            locationId: store.createdLocationId,
            hours: store.businessHours,
          },
        });
        if (apiError) throw new Error(apiError);
      }

      if (store.currentStep === 5) {
        const { error: apiError } = await api("/onboarding/whatsapp", {
          method: "POST",
          accessToken,
          body: {
            businessId: store.createdBusinessId,
            enabled: store.whatsappEnabled,
            phoneNumber: store.whatsappPhone,
          },
        });
        if (apiError) throw new Error(apiError);
      }

      if (store.currentStep === 6) {
        // Staff is optional — only submit if there are entries
        const validStaff = store.staffMembers.filter(
          (s) => s.name.trim() && s.email.trim(),
        );
        if (validStaff.length > 0) {
          const { error: apiError } = await api("/onboarding/staff", {
            method: "POST",
            accessToken,
            body: {
              businessId: store.createdBusinessId,
              locationId: store.createdLocationId,
              staffMembers: validStaff,
            },
          });
          if (apiError) throw new Error(apiError);
        }

        // Complete onboarding
        await api("/onboarding/complete", {
          method: "POST",
          accessToken,
        });

        // Refresh session to pick up new role
        await supabase.auth.refreshSession();
        store.reset();
        navigate("/admin", { replace: true });
        return;
      }

      store.nextStep();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  function validateStep(step: number): string | null {
    switch (step) {
      case 1:
        if (!store.businessName.trim()) return "Business name is required";
        if (!store.ownerName.trim()) return "Your name is required";
        return null;
      case 2:
        if (!store.locationName.trim()) return "Location name is required";
        return null;
      case 3:
        if (store.queueTypes.length === 0) return "Add at least one queue type";
        if (store.queueTypes.some((qt) => !qt.name.trim()))
          return "All queue types need a name";
        return null;
      case 5:
        if (store.whatsappEnabled && !store.whatsappPhone.trim())
          return "WhatsApp phone number required when enabled";
        return null;
      default:
        return null;
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top brand bar */}
      <div className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-3 px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
            <Zap className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-lg text-foreground font-medium">EM Flow</span>
          <span className="text-muted-foreground text-sm ml-2">
            Setup Wizard
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-8">
        {/* Stepper */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {ONBOARDING_STEPS.map((step, i) => {
              const Icon = STEP_ICONS[i];
              const isCompleted = store.currentStep > step.id;
              const isCurrent = store.currentStep === step.id;
              return (
                <div key={step.id} className="flex flex-1 items-center">
                  <div className="flex flex-col items-center gap-1.5">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all ${isCompleted
                        ? "border-primary bg-primary text-primary-foreground"
                        : isCurrent
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-muted bg-muted/50 text-muted-foreground"
                        }`}
                    >
                      {isCompleted ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Icon className="h-4 w-4" />
                      )}
                    </div>
                    <span
                      className={`text-xs text-center hidden sm:block ${isCurrent
                        ? "text-primary font-medium"
                        : "text-muted-foreground"
                        }`}
                    >
                      {step.label}
                    </span>
                  </div>
                  {i < ONBOARDING_STEPS.length - 1 && (
                    <div
                      className={`mx-2 h-0.5 flex-1 rounded-full ${store.currentStep > step.id ? "bg-primary" : "bg-muted"
                        }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
            <p className="text-destructive text-sm">{error}</p>
          </div>
        )}

        {/* Step Content */}
        <Card className="mb-6">
          <CardContent className="p-6 sm:p-8">
            {store.currentStep === 1 && <StepBusiness />}
            {store.currentStep === 2 && <StepLocation />}
            {store.currentStep === 3 && <StepQueueTypes />}
            {store.currentStep === 4 && <StepBusinessHours />}
            {store.currentStep === 5 && <StepWhatsApp />}
            {store.currentStep === 6 && <StepStaff />}
          </CardContent>
        </Card>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={() => {
              setError("");
              store.prevStep();
            }}
            disabled={store.currentStep === 1 || loading}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>

          <span className="text-sm text-muted-foreground">
            Step {store.currentStep} of {ONBOARDING_STEPS.length}
          </span>

          <Button onClick={handleNext} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {store.currentStep === 6 ? "Complete Setup" : "Continue"}
            {store.currentStep < 6 && <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════ Step Components ═══════════ */

function StepBusiness() {
  const store = useOnboardingStore();
  return (
    <div className="space-y-6">
      <div>
        <h2>Business Information</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Tell us about your business to get started.
        </p>
      </div>
      <Separator />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label>Business Name *</Label>
          <Input
            placeholder="Acme Healthcare"
            value={store.businessName}
            onChange={(e) => store.updateField("businessName", e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label>Your Name *</Label>
          <Input
            placeholder="John Doe"
            value={store.ownerName}
            onChange={(e) => store.updateField("ownerName", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Industry</Label>
          <Select
            value={store.industry}
            onValueChange={(v) => store.updateField("industry", v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select industry" />
            </SelectTrigger>
            <SelectContent>
              {INDUSTRIES.map((ind) => (
                <SelectItem key={ind} value={ind}>
                  {ind}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Phone</Label>
          <Input
            type="tel"
            placeholder="+1 (555) 123-4567"
            value={store.businessPhone}
            onChange={(e) => store.updateField("businessPhone", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Email</Label>
          <Input
            type="email"
            placeholder="info@acme.com"
            value={store.businessEmail}
            onChange={(e) => store.updateField("businessEmail", e.target.value)}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Address</Label>
          <Input
            placeholder="123 Main Street, City"
            value={store.businessAddress}
            onChange={(e) =>
              store.updateField("businessAddress", e.target.value)
            }
          />
        </div>
      </div>
    </div>
  );
}

function StepLocation() {
  const store = useOnboardingStore();
  return (
    <div className="space-y-6">
      <div>
        <h2>First Location</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Set up your primary service location. You can add more later.
        </p>
      </div>
      <Separator />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label>Location Name *</Label>
          <Input
            placeholder="Main Branch"
            value={store.locationName}
            onChange={(e) => store.updateField("locationName", e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label>City</Label>
          <Input
            placeholder="Istanbul"
            value={store.locationCity}
            onChange={(e) => store.updateField("locationCity", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Phone</Label>
          <Input
            type="tel"
            placeholder="+90 212 555 1234"
            value={store.locationPhone}
            onChange={(e) => store.updateField("locationPhone", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Country</Label>
          <Select
            value={store.country}
            onValueChange={(v) => store.updateField("country", v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select country" />
            </SelectTrigger>
            <SelectContent>
              {COUNTRIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Address</Label>
          <Input
            placeholder="456 Branch Street"
            value={store.locationAddress}
            onChange={(e) =>
              store.updateField("locationAddress", e.target.value)
            }
          />
        </div>
        <div className="space-y-2">
          <Label>Timezone</Label>
          <Select
            value={store.timezone}
            onValueChange={(v) => store.updateField("timezone", v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

function StepQueueTypes() {
  const store = useOnboardingStore();
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2>Queue Types</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Define the service categories customers can queue for.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={store.addQueueType}>
          <Plus className="mr-1 h-3 w-3" />
          Add
        </Button>
      </div>
      <Separator />
      <div className="space-y-4">
        {store.queueTypes.map((qt, i) => (
          <div
            key={i}
            className="rounded-lg border border-border p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                Queue #{i + 1}
              </span>
              {store.queueTypes.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => store.removeQueueType(i)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Name *</Label>
                <Input
                  placeholder="General Inquiry"
                  value={qt.name}
                  onChange={(e) =>
                    store.updateQueueType(i, "name", e.target.value)
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Prefix</Label>
                <Input
                  placeholder="G"
                  maxLength={3}
                  value={qt.prefix}
                  onChange={(e) =>
                    store.updateQueueType(
                      i,
                      "prefix",
                      e.target.value.toUpperCase(),
                    )
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Est. Time (min)</Label>
                <Input
                  type="number"
                  min={1}
                  value={qt.estimatedServiceTime}
                  onChange={(e) =>
                    store.updateQueueType(
                      i,
                      "estimatedServiceTime",
                      parseInt(e.target.value) || 10,
                    )
                  }
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepBusinessHours() {
  const store = useOnboardingStore();
  return (
    <div className="space-y-6">
      <div>
        <h2>Business Hours</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Set your operating hours for each day of the week.
        </p>
      </div>
      <Separator />
      <div className="space-y-3">
        {store.businessHours.map((bh, i) => (
          <div
            key={bh.day}
            className="flex items-center gap-4 rounded-lg border border-border px-4 py-3"
          >
            <div className="flex items-center gap-3 w-32">
              <Switch
                checked={bh.enabled}
                onCheckedChange={(v) =>
                  store.updateBusinessHour(i, "enabled", v)
                }
              />
              <span
                className={`text-sm ${bh.enabled ? "text-foreground" : "text-muted-foreground"
                  }`}
              >
                {bh.day}
              </span>
            </div>
            {bh.enabled ? (
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  value={bh.open}
                  onChange={(e) =>
                    store.updateBusinessHour(i, "open", e.target.value)
                  }
                  className="w-28"
                />
                <span className="text-muted-foreground text-sm">to</span>
                <Input
                  type="time"
                  value={bh.close}
                  onChange={(e) =>
                    store.updateBusinessHour(i, "close", e.target.value)
                  }
                  className="w-28"
                />
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Closed</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StepWhatsApp() {
  const store = useOnboardingStore();
  return (
    <div className="space-y-6">
      <div>
        <h2>WhatsApp Notifications</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Optionally enable WhatsApp notifications for queue updates.
        </p>
      </div>
      <Separator />
      <div className="flex items-center gap-4 rounded-lg border border-border p-4">
        <Switch
          checked={store.whatsappEnabled}
          onCheckedChange={(v) => store.updateField("whatsappEnabled", v)}
        />
        <div>
          <p className="text-foreground text-sm font-medium">
            Enable WhatsApp Notifications
          </p>
          <p className="text-muted-foreground text-xs">
            Send queue position updates via WhatsApp
          </p>
        </div>
      </div>
      {store.whatsappEnabled && (
        <div className="space-y-2">
          <Label>WhatsApp Business Phone *</Label>
          <Input
            type="tel"
            placeholder="+1234567890"
            value={store.whatsappPhone}
            onChange={(e) => store.updateField("whatsappPhone", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            The phone number connected to your WhatsApp Business account.
          </p>
        </div>
      )}
    </div>
  );
}

function StepStaff() {
  const store = useOnboardingStore();
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2>Add Staff Members</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Invite team members. This step is optional — you can add staff
            later.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={store.addStaffMember}>
          <Plus className="mr-1 h-3 w-3" />
          Add
        </Button>
      </div>
      <Separator />
      {store.staffMembers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12">
          <Users className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-sm">
            No staff members added yet
          </p>
          <p className="text-muted-foreground text-xs mt-1">
            Click "Add" to invite team members, or skip this step
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {store.staffMembers.map((sm, i) => (
            <div
              key={i}
              className="rounded-lg border border-border p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Member #{i + 1}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => store.removeStaffMember(i)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Name</Label>
                  <Input
                    placeholder="Jane Smith"
                    value={sm.name}
                    onChange={(e) =>
                      store.updateStaffMember(i, "name", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Email</Label>
                  <Input
                    type="email"
                    placeholder="jane@example.com"
                    value={sm.email}
                    onChange={(e) =>
                      store.updateStaffMember(i, "email", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Role</Label>
                  <Select
                    value={sm.role}
                    onValueChange={(v) => store.updateStaffMember(i, "role", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="staff">Staff</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

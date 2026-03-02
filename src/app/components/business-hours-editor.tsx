/**
 * BusinessHoursEditor — Per-location business hours configuration.
 *
 * Features:
 *   - 7-day weekly schedule (Mon–Sun)
 *   - Toggle days open/closed
 *   - Set open and close times per day
 *   - Copy hours from one day to all
 *   - Save to server via PUT /settings/business-hours/:locationId
 *   - Load existing hours on mount
 */
import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Badge } from "./ui/badge";
import {
  CalendarClock,
  Save,
  Loader2,
  Copy,
  Sun,
  Moon,
} from "lucide-react";

interface DaySchedule {
  open: boolean;
  openTime: string; // HH:MM
  closeTime: string; // HH:MM
}

type WeekSchedule = Record<string, DaySchedule>;

const DAYS = [
  { key: "monday", label: "Monday", short: "Mon" },
  { key: "tuesday", label: "Tuesday", short: "Tue" },
  { key: "wednesday", label: "Wednesday", short: "Wed" },
  { key: "thursday", label: "Thursday", short: "Thu" },
  { key: "friday", label: "Friday", short: "Fri" },
  { key: "saturday", label: "Saturday", short: "Sat" },
  { key: "sunday", label: "Sunday", short: "Sun" },
];

const DEFAULT_SCHEDULE: WeekSchedule = {
  monday: { open: true, openTime: "09:00", closeTime: "18:00" },
  tuesday: { open: true, openTime: "09:00", closeTime: "18:00" },
  wednesday: { open: true, openTime: "09:00", closeTime: "18:00" },
  thursday: { open: true, openTime: "09:00", closeTime: "18:00" },
  friday: { open: true, openTime: "09:00", closeTime: "18:00" },
  saturday: { open: true, openTime: "10:00", closeTime: "16:00" },
  sunday: { open: false, openTime: "10:00", closeTime: "14:00" },
};

interface Props {
  locationId: string;
  locationName: string;
  businessId: string;
  accessToken: string;
}

export function BusinessHoursEditor({ locationId, locationName, businessId, accessToken }: Props) {
  const [schedule, setSchedule] = useState<WeekSchedule>(DEFAULT_SCHEDULE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Load existing hours
  useEffect(() => {
    if (!locationId || !accessToken) return;
    (async () => {
      const { data } = await api<{ hours: { hours: WeekSchedule } | null }>(
        `/settings/business-hours/${locationId}`,
        { accessToken }
      );
      if (data?.hours?.hours) {
        // Merge with defaults to handle missing days
        setSchedule({ ...DEFAULT_SCHEDULE, ...data.hours.hours });
      }
      setLoading(false);
    })();
  }, [locationId, accessToken]);

  const updateDay = (dayKey: string, updates: Partial<DaySchedule>) => {
    setSchedule((prev) => ({
      ...prev,
      [dayKey]: { ...prev[dayKey], ...updates },
    }));
    setHasChanges(true);
  };

  const copyToAll = (sourceDayKey: string) => {
    const source = schedule[sourceDayKey];
    setSchedule((prev) => {
      const updated = { ...prev };
      DAYS.forEach(({ key }) => {
        updated[key] = { ...source };
      });
      return updated;
    });
    setHasChanges(true);
    toast.success(`Copied ${DAYS.find((d) => d.key === sourceDayKey)?.label} hours to all days`);
  };

  const handleSave = async () => {
    setSaving(true);
    const { error } = await api(`/settings/business-hours/${locationId}`, {
      method: "PUT",
      accessToken,
      body: { businessId, hours: schedule },
    });
    if (error) {
      toast.error(error);
    } else {
      toast.success("Business hours saved");
      setHasChanges(false);
    }
    setSaving(false);
  };

  // Count open days
  const openDays = DAYS.filter((d) => schedule[d.key]?.open).length;

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Business Hours</CardTitle>
          </div>
          <Badge variant="secondary" className="text-xs">
            {locationName}
          </Badge>
        </div>
        <CardDescription>
          Set operating hours for this location. {openDays} of 7 days open.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {/* Header row */}
        <div className="hidden sm:grid grid-cols-[1fr_auto_1fr_1fr_auto] gap-3 items-center px-3 py-1.5 text-xs font-medium text-muted-foreground">
          <span>Day</span>
          <span className="w-12 text-center">Open</span>
          <span>Opens</span>
          <span>Closes</span>
          <span className="w-8" />
        </div>

        {DAYS.map(({ key, label, short }) => {
          const day = schedule[key];
          const isWeekend = key === "saturday" || key === "sunday";

          return (
            <div
              key={key}
              className={`grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_1fr_1fr_auto] gap-3 items-center rounded-lg px-3 py-2.5 transition-colors ${
                day.open
                  ? "bg-card hover:bg-accent/30"
                  : "bg-muted/30 opacity-60"
              }`}
            >
              {/* Day name */}
              <div className="flex items-center gap-2">
                {isWeekend ? (
                  <Sun className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                ) : (
                  <Moon className="h-3.5 w-3.5 text-blue-500 shrink-0 hidden sm:block" />
                )}
                <span className="text-sm font-medium text-foreground">
                  <span className="sm:hidden">{short}</span>
                  <span className="hidden sm:inline">{label}</span>
                </span>
              </div>

              {/* Toggle */}
              <Switch
                checked={day.open}
                onCheckedChange={(checked) => updateDay(key, { open: checked })}
                className="shrink-0"
              />

              {/* Time inputs — mobile: below; desktop: inline */}
              {day.open && (
                <>
                  <div className="col-span-2 sm:col-span-1 flex items-center gap-1.5">
                    <Input
                      type="time"
                      value={day.openTime}
                      onChange={(e) => updateDay(key, { openTime: e.target.value })}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1 flex items-center gap-1.5">
                    <Input
                      type="time"
                      value={day.closeTime}
                      onChange={(e) => updateDay(key, { closeTime: e.target.value })}
                      className="h-8 text-sm"
                    />
                  </div>
                </>
              )}

              {!day.open && (
                <>
                  <span className="text-xs text-muted-foreground hidden sm:block">—</span>
                  <span className="text-xs text-muted-foreground hidden sm:block">Closed</span>
                </>
              )}

              {/* Copy to all */}
              {day.open && (
                <button
                  onClick={() => copyToAll(key)}
                  className="hidden sm:flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title={`Copy ${label} hours to all days`}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              )}
              {!day.open && <span className="hidden sm:block w-8" />}
            </div>
          );
        })}

        {/* Save button */}
        <div className="flex justify-end pt-3">
          <Button onClick={handleSave} disabled={saving || !hasChanges} size="sm">
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Hours
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

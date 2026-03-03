/**
 * Admin Settings Page — /admin/settings
 *
 * Tabbed settings interface for managing:
 *   - Queue Types (CRUD, reorder, deactivate)
 *   - Staff & Permissions (invite, role change, deactivate)
 *   - Business Profile editing
 *   - WhatsApp notification settings
 *
 * Role-based: Only OWNER/ADMIN can access. Some actions OWNER-only.
 */
import { useState, useEffect, useCallback } from "react";
import { useLocaleStore } from "../../stores/locale-store";
import { useAuthStore } from "../../stores/auth-store";
import { api } from "../../lib/api";
import { toast } from "sonner";
import { BusinessHoursEditor } from "../../components/business-hours-editor";
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
import { Badge } from "../../components/ui/badge";
import { Separator } from "../../components/ui/separator";
import { Switch } from "../../components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../components/ui/alert-dialog";
import {
  Settings,
  Plus,
  Pencil,
  Trash2,
  Users,
  ListChecks,
  Building2,
  MessageSquare,
  Loader2,
  MapPin,
  Clock,
  Hash,
  UserPlus,
  Shield,
  ShieldCheck,
  Crown,
  Mail,
  Phone,
  Globe,
  CheckCircle2,
  AlertCircle,
  Save,
  X,
  CalendarClock,
  KeyRound,
  Eye,
  EyeOff,
} from "lucide-react";

// ── Types ──
interface QueueType {
  id: string;
  business_id: string;
  location_id: string;
  name: string;
  prefix: string;
  description: string | null;
  estimated_service_time: number;
  max_capacity: number;
  status: string;
  sort_order: number;
}

interface StaffMember {
  auth_user_id: string;
  name: string;
  email: string;
  role: string;
  locations: string[];
}

interface LocationInfo {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  slug: string;
}

interface BusinessInfo {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  industry: string | null;
}

interface WhatsAppSettings {
  enabled: boolean;
  phone_number: string | null;
  provider?: string;
}

// ── Role badge helper ──
function RoleBadge({ role }: { role: string }) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "outline"; icon: any }> = {
    owner: { label: "Owner", variant: "default", icon: Crown },
    admin: { label: "Admin", variant: "secondary", icon: ShieldCheck },
    staff: { label: "Staff", variant: "outline", icon: Shield },
  };
  const c = config[role] || config.staff;
  return (
    <Badge variant={c.variant} className="gap-1 text-xs">
      <c.icon className="h-3 w-3" />
      {c.label}
    </Badge>
  );
}

export function SettingsPage() {
  const { t } = useLocaleStore();
  const { session, staffRecord, businessId } = useAuthStore();
  const accessToken = session?.access_token;
  const isOwner = staffRecord?.role === "owner";
  const isAdmin = staffRecord?.role === "admin";
  const callerRole = staffRecord?.role || "staff";

  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<LocationInfo[]>([]);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [queueTypes, setQueueTypes] = useState<QueueType[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [whatsappSettings, setWhatsappSettings] = useState<WhatsAppSettings>({
    enabled: false,
    phone_number: null,
  });

  // ── Load initial data ──
  useEffect(() => {
    if (!businessId || !accessToken) return;
    (async () => {
      const [bizRes, locRes, staffRes, waRes] = await Promise.all([
        api<{ business: BusinessInfo }>(`/business/${businessId}`, { accessToken }),
        api<{ locations: LocationInfo[] }>(`/business/${businessId}/locations`, { accessToken }),
        api<{ staff: StaffMember[] }>(`/business/${businessId}/staff`, { accessToken }),
        api<{ settings: WhatsAppSettings }>(`/settings/whatsapp/${businessId}`, { accessToken }),
      ]);

      if (bizRes.data?.business) setBusiness(bizRes.data.business);
      if (locRes.data?.locations?.length) {
        setLocations(locRes.data.locations);
        const firstLoc = locRes.data.locations[0];
        setSelectedLocation(firstLoc.id);
      }
      if (staffRes.data?.staff) setStaff(staffRes.data.staff);
      if (waRes.data?.settings) setWhatsappSettings(waRes.data.settings);
      setLoading(false);
    })();
  }, [businessId, accessToken]);

  // ── Load queue types for selected location ──
  const loadQueueTypes = useCallback(async () => {
    if (!selectedLocation || !accessToken) return;
    const { data } = await api<{ queueTypes: QueueType[] }>(
      `/queue/types/${selectedLocation}`,
      { accessToken }
    );
    if (data?.queueTypes) setQueueTypes(data.queueTypes);
  }, [selectedLocation, accessToken]);

  useEffect(() => {
    loadQueueTypes();
  }, [loadQueueTypes]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("nav.settings")}</h1>
        <p className="text-muted-foreground text-sm">
          Manage queue types, staff permissions, and notifications
        </p>
      </div>

      <Tabs defaultValue="queues" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
          <TabsTrigger value="queues" className="gap-1.5 text-xs sm:text-sm">
            <ListChecks className="h-3.5 w-3.5 hidden sm:inline" />
            Queue Types
          </TabsTrigger>
          <TabsTrigger value="staff" className="gap-1.5 text-xs sm:text-sm">
            <Users className="h-3.5 w-3.5 hidden sm:inline" />
            Staff
          </TabsTrigger>
          <TabsTrigger value="business" className="gap-1.5 text-xs sm:text-sm">
            <Building2 className="h-3.5 w-3.5 hidden sm:inline" />
            Business
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="gap-1.5 text-xs sm:text-sm">
            <MessageSquare className="h-3.5 w-3.5 hidden sm:inline" />
            WhatsApp
          </TabsTrigger>
        </TabsList>

        {/* ════════════════════════════════════════════ */}
        {/* QUEUE TYPES TAB                             */}
        {/* ════════════════════════════════════════════ */}
        <TabsContent value="queues" className="space-y-4">
          {/* Location selector */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {locations.length > 1 && (
                <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                  <SelectTrigger className="w-48">
                    <MapPin className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <AddQueueTypeDialog
              locationId={selectedLocation}
              accessToken={accessToken || ""}
              onCreated={loadQueueTypes}
            />
          </div>

          {/* Queue type list */}
          {queueTypes.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                  <ListChecks className="h-7 w-7 text-muted-foreground/50" />
                </div>
                <div className="text-center">
                  <h3 className="font-semibold text-foreground">No queue types yet</h3>
                  <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                    Create queue types to organize your service lines (e.g. General, VIP, Appointments).
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {queueTypes
                .filter((qt) => qt.status === "active")
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((qt) => (
                  <QueueTypeCard
                    key={qt.id}
                    qt={qt}
                    isOwner={!!isOwner}
                    accessToken={accessToken || ""}
                    onUpdated={loadQueueTypes}
                  />
                ))}
            </div>
          )}
        </TabsContent>

        {/* ════════════════════════════════════════════ */}
        {/* STAFF TAB                                   */}
        {/* ════════════════════════════════════════════ */}
        <TabsContent value="staff" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-foreground">{t("settings.staffMembers")}</h3>
              <p className="text-xs text-muted-foreground">
                {staff.length} {t("settings.staffMemberCount", staff.length !== 1 ? "members" : "member")}
              </p>
            </div>
            {isOwner && (
              <InviteStaffDialog
                accessToken={accessToken || ""}
                locations={locations}
                onInvited={() => {
                  api<{ staff: StaffMember[] }>(
                    `/business/${businessId}/staff`,
                    { accessToken: accessToken || "" }
                  ).then(({ data }) => {
                    if (data?.staff) setStaff(data.staff);
                  });
                }}
              />
            )}
          </div>

          {staff.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
                <Users className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">{t("settings.noStaffFound")}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {staff.map((member) => (
                <StaffMemberRow
                  key={member.auth_user_id}
                  member={member}
                  callerRole={callerRole}
                  currentUserId={staffRecord?.auth_user_id || ""}
                  accessToken={accessToken || ""}
                  locations={locations}
                  onUpdated={() => {
                    api<{ staff: StaffMember[] }>(
                      `/business/${businessId}/staff`,
                      { accessToken: accessToken || "" }
                    ).then(({ data }) => {
                      if (data?.staff) setStaff(data.staff);
                    });
                  }}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ════════════════════════════════════════════ */}
        {/* BUSINESS PROFILE TAB                        */}
        {/* ════════════════════════════════════════════ */}
        <TabsContent value="business" className="space-y-4">
          {business && (
            <BusinessProfileForm
              business={business}
              accessToken={accessToken || ""}
              onSaved={(updated) => setBusiness(updated)}
            />
          )}

          <Separator />

          {/* Location settings */}
          <div>
            <h3 className="font-semibold text-foreground mb-3">Locations</h3>
            <div className="space-y-3">
              {locations.map((loc) => (
                <Card key={loc.id} className="transition-shadow hover:shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <MapPin className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <h4 className="font-medium text-foreground">{loc.name}</h4>
                          {loc.address && (
                            <p className="text-xs text-muted-foreground mt-0.5">{loc.address}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Slug: <code className="bg-muted px-1 rounded text-[0.65rem]">{loc.slug}</code>
                          </p>
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-xs shrink-0">
                        Active
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <Separator />

          {/* Business Hours per location */}
          <div>
            <h3 className="font-semibold text-foreground mb-3">Business Hours</h3>
            <div className="space-y-4">
              {locations.map((loc) => (
                <BusinessHoursEditor
                  key={loc.id}
                  locationId={loc.id}
                  locationName={loc.name}
                  businessId={businessId || ""}
                  accessToken={accessToken || ""}
                />
              ))}
            </div>
          </div>
        </TabsContent>

        {/* ════════════════════════════════════════════ */}
        {/* WHATSAPP TAB                                */}
        {/* ════════════════════════════════════════════ */}
        <TabsContent value="whatsapp" className="space-y-4">
          <WhatsAppSettingsForm
            businessId={businessId || ""}
            settings={whatsappSettings}
            accessToken={accessToken || ""}
            onSaved={setWhatsappSettings}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════

// ── Queue Type Card ──
function QueueTypeCard({
  qt,
  isOwner,
  accessToken,
  onUpdated,
}: {
  qt: QueueType;
  isOwner: boolean;
  accessToken: string;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(qt.name);
  const [prefix, setPrefix] = useState(qt.prefix);
  const [estTime, setEstTime] = useState(String(qt.estimated_service_time));
  const [maxCap, setMaxCap] = useState(String(qt.max_capacity));
  const [desc, setDesc] = useState(qt.description || "");

  const handleSave = async () => {
    setSaving(true);
    const { error } = await api(`/settings/queue-type/${qt.id}`, {
      method: "PUT",
      accessToken,
      body: {
        name,
        prefix,
        description: desc || null,
        estimatedServiceTime: parseInt(estTime) || 10,
        maxCapacity: parseInt(maxCap) || 100,
      },
    });
    if (error) {
      toast.error(error);
    } else {
      toast.success("Queue type updated");
      setEditing(false);
      onUpdated();
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    const { error } = await api(`/settings/queue-type/${qt.id}`, {
      method: "DELETE",
      accessToken,
    });
    if (error) {
      toast.error(error);
    } else {
      toast.success("Queue type deactivated");
      onUpdated();
    }
  };

  return (
    <Card className="transition-all hover:shadow-md">
      <CardContent className="p-4">
        {editing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Prefix</Label>
                <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} className="h-8 text-sm" maxLength={3} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Est. Time (min)</Label>
                <Input type="number" value={estTime} onChange={(e) => setEstTime(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max Capacity</Label>
                <Input type="number" value={maxCap} onChange={(e) => setMaxCap(e.target.value)} className="h-8 text-sm" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional" className="h-8 text-sm" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold text-lg">
                {qt.prefix}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-foreground truncate">{qt.name}</h4>
                {qt.description && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{qt.description}</p>
                )}
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {qt.estimated_service_time}m
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    Max {qt.max_capacity}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(true)}
                className="h-7 text-xs gap-1 flex-1"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </Button>
              {isOwner && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-destructive hover:text-destructive">
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete "{qt.name}"?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will deactivate the queue type. Existing entries won't be affected, but new customers can no longer join this queue.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Add Queue Type Dialog ──
function AddQueueTypeDialog({
  locationId,
  accessToken,
  onCreated,
}: {
  locationId: string;
  accessToken: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [estTime, setEstTime] = useState("10");
  const [maxCap, setMaxCap] = useState("100");
  const [desc, setDesc] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) return toast.error("Name is required");
    setSaving(true);
    const { error } = await api("/settings/queue-type", {
      method: "POST",
      accessToken,
      body: {
        locationId,
        name: name.trim(),
        prefix: prefix.trim() || name.charAt(0).toUpperCase(),
        description: desc.trim() || null,
        estimatedServiceTime: parseInt(estTime) || 10,
        maxCapacity: parseInt(maxCap) || 100,
      },
    });
    if (error) {
      toast.error(error);
    } else {
      toast.success(`Queue type "${name}" created`);
      setOpen(false);
      setName("");
      setPrefix("");
      setEstTime("10");
      setMaxCap("100");
      setDesc("");
      onCreated();
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add Queue Type
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Queue Type</DialogTitle>
          <DialogDescription>
            Add a new service queue for customers to join.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. General" />
            </div>
            <div className="space-y-1.5">
              <Label>Prefix</Label>
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="G" maxLength={3} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Est. Service Time (min)</Label>
              <Input type="number" value={estTime} onChange={(e) => setEstTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Max Capacity</Label>
              <Input type="number" value={maxCap} onChange={(e) => setMaxCap(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional description" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Staff Member Row ──
function StaffMemberRow({
  member,
  callerRole,
  currentUserId,
  accessToken,
  locations,
  onUpdated,
}: {
  member: StaffMember;
  callerRole: string;
  currentUserId: string;
  accessToken: string;
  locations: LocationInfo[];
  onUpdated: () => void;
}) {
  const { t } = useLocaleStore();
  const isSelf = member.auth_user_id === currentUserId;
  const isOwner = callerRole === "owner";
  const isAdmin = callerRole === "admin";

  // Admins can edit staff-role members; owners can edit anyone except themselves and other owners
  const canEdit =
    !isSelf &&
    member.role !== "owner" &&
    (isOwner || (isAdmin && member.role === "staff"));

  const [updating, setUpdating] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(member.name);
  const [editLocations, setEditLocations] = useState<string[]>(member.locations || []);
  const [editSaving, setEditSaving] = useState(false);

  // Reset password state
  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resetPwSaving, setResetPwSaving] = useState(false);

  const handleRoleChange = async (newRole: string) => {
    setUpdating(true);
    const { error } = await api(`/settings/staff/${member.auth_user_id}`, {
      method: "PUT",
      accessToken,
      body: { role: newRole },
    });
    if (error) {
      toast.error(error);
    } else {
      toast.success(`${member.name}'s role updated to ${newRole}`);
      onUpdated();
    }
    setUpdating(false);
  };

  const handleDeactivate = async () => {
    const { error } = await api(`/settings/staff/${member.auth_user_id}`, {
      method: "DELETE",
      accessToken,
    });
    if (error) {
      toast.error(error);
    } else {
      toast.success(`${member.name} ${t("settings.deactivated")}`);
      onUpdated();
    }
  };

  const handleEditSave = async () => {
    if (!editName.trim()) return toast.error(t("settings.editStaffNameRequired"));
    setEditSaving(true);
    const { error } = await api(`/settings/staff/${member.auth_user_id}`, {
      method: "PUT",
      accessToken,
      body: { name: editName.trim(), locations: editLocations },
    });
    if (error) {
      toast.error(error);
    } else {
      toast.success(t("settings.editStaffSuccess"));
      setEditOpen(false);
      onUpdated();
    }
    setEditSaving(false);
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      return toast.error(t("settings.resetPwMinLength"));
    }
    setResetPwSaving(true);
    const { error } = await api(
      `/settings/staff/${member.auth_user_id}/reset-password`,
      {
        method: "POST",
        accessToken,
        body: { password: newPassword },
      }
    );
    if (error) {
      toast.error(error);
    } else {
      toast.success(t("settings.resetPwSuccess"));
      setResetPwOpen(false);
      setNewPassword("");
      setShowPassword(false);
    }
    setResetPwSaving(false);
  };

  const toggleLocation = (locId: string) => {
    setEditLocations((prev) =>
      prev.includes(locId) ? prev.filter((l) => l !== locId) : [...prev, locId]
    );
  };

  return (
    <Card className="transition-shadow hover:shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          {/* Avatar */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
            {member.name
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground text-sm truncate">
                {member.name}
              </span>
              {isSelf && (
                <Badge variant="outline" className="text-[0.6rem] px-1 py-0">
                  {t("settings.editStaffYou")}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{member.email}</p>
            {member.locations && member.locations.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {member.locations.map((locId) => {
                  const loc = locations.find((l) => l.id === locId);
                  return loc ? (
                    <Badge key={locId} variant="outline" className="text-[0.6rem] px-1.5 py-0 gap-0.5">
                      <MapPin className="h-2.5 w-2.5" />
                      {loc.name}
                    </Badge>
                  ) : null;
                })}
              </div>
            )}
          </div>

          {/* Role badge */}
          <RoleBadge role={member.role} />

          {/* Actions */}
          {canEdit && (
            <div className="flex items-center gap-1 shrink-0">
              {/* Edit button */}
              <Dialog open={editOpen} onOpenChange={(o) => {
                setEditOpen(o);
                if (o) {
                  setEditName(member.name);
                  setEditLocations(member.locations || []);
                  setResetPwOpen(false);
                  setNewPassword("");
                  setShowPassword(false);
                }
              }}>
                <DialogTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t("settings.editStaffTitle")}</DialogTitle>
                    <DialogDescription>
                      {t("settings.editStaffDesc")} {member.name}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                      <Label>{t("settings.editStaffFullName")} *</Label>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder={t("settings.editStaffNamePlaceholder")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{t("settings.editStaffEmail")}</Label>
                      <Input
                        value={member.email}
                        disabled
                        className="opacity-60"
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("settings.editStaffEmailReadonly")}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>{t("settings.editStaffCurrentRole")}</Label>
                      <div className="flex items-center gap-2">
                        <RoleBadge role={member.role} />
                        {isOwner && (
                          <span className="text-xs text-muted-foreground">
                            {t("settings.editStaffRoleHint")}
                          </span>
                        )}
                      </div>
                    </div>
                    {locations.length > 0 && (
                      <div className="space-y-2">
                        <Label>{t("settings.editStaffLocations")}</Label>
                        <div className="space-y-2 rounded-lg border border-border p-3 max-h-48 overflow-y-auto">
                          {locations.map((loc) => (
                            <label
                              key={loc.id}
                              className="flex items-center gap-3 cursor-pointer hover:bg-muted/50 rounded-md p-1.5 -m-1.5 transition-colors"
                            >
                              <input
                                type="checkbox"
                                checked={editLocations.includes(loc.id)}
                                onChange={() => toggleLocation(loc.id)}
                                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                              />
                              <div className="flex items-center gap-2 min-w-0">
                                <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <div className="min-w-0">
                                  <span className="text-sm font-medium text-foreground block truncate">
                                    {loc.name}
                                  </span>
                                  {loc.address && (
                                    <span className="text-xs text-muted-foreground block truncate">
                                      {loc.address}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                        {editLocations.length === 0 && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            {t("settings.editStaffNoLocWarning")}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Reset Password Section */}
                    <Separator />
                    <div className="space-y-2">
                      <button
                        type="button"
                        className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
                        onClick={() => {
                          setResetPwOpen(!resetPwOpen);
                          if (!resetPwOpen) {
                            setNewPassword("");
                            setShowPassword(false);
                          }
                        }}
                      >
                        <KeyRound className="h-4 w-4" />
                        {t("settings.resetPwTitle")}
                        <span className="text-xs text-muted-foreground ml-auto">
                          {resetPwOpen ? "▲" : "▼"}
                        </span>
                      </button>
                      {resetPwOpen && (
                        <div className="space-y-3 pl-6 animate-fade-in">
                          <p className="text-xs text-muted-foreground">
                            {t("settings.resetPwDesc")}
                          </p>
                          <div className="space-y-1.5">
                            <Label>{t("settings.resetPwNewLabel")}</Label>
                            <div className="relative">
                              <Input
                                type={showPassword ? "text" : "password"}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder={t("settings.resetPwPlaceholder")}
                                className="pr-10"
                              />
                              <button
                                type="button"
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                onClick={() => setShowPassword(!showPassword)}
                              >
                                {showPassword ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </button>
                            </div>
                            {newPassword.length > 0 && newPassword.length < 6 && (
                              <p className="text-xs text-destructive flex items-center gap-1">
                                <AlertCircle className="h-3 w-3" />
                                {t("settings.resetPwMinLength")}
                              </p>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleResetPassword}
                            disabled={resetPwSaving || newPassword.length < 6}
                            className="gap-1.5"
                          >
                            {resetPwSaving ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <KeyRound className="h-3.5 w-3.5" />
                            )}
                            {t("settings.resetPwAction")}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setEditOpen(false)}>
                      {t("common.cancel")}
                    </Button>
                    <Button onClick={handleEditSave} disabled={editSaving}>
                      {editSaving ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      {t("settings.editStaffSave")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Role dropdown — owner only */}
              {isOwner && (
                <Select
                  value={member.role}
                  onValueChange={handleRoleChange}
                  disabled={updating}
                >
                  <SelectTrigger className="h-7 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="staff">Staff</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {/* Deactivate — owner only */}
              {isOwner && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("settings.deactivateTitle")} {member.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("settings.deactivateDesc")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDeactivate} className="bg-destructive text-destructive-foreground">
                        {t("settings.deactivateAction")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Invite Staff Dialog ──
function InviteStaffDialog({
  accessToken,
  locations,
  onInvited,
}: {
  accessToken: string;
  locations: LocationInfo[];
  onInvited: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  const [password, setPassword] = useState("");

  const handleInvite = async () => {
    if (!name.trim() || !email.trim())
      return toast.error("Name and email are required");

    setSaving(true);
    const { error } = await api("/settings/staff/invite", {
      method: "POST",
      accessToken,
      body: {
        name: name.trim(),
        email: email.trim(),
        role,
        password: password.trim() || undefined,
        locationIds: locations.map((l) => l.id),
      },
    });

    if (error) {
      toast.error(error);
    } else {
      toast.success(`${name} invited as ${role}`);
      setOpen(false);
      setName("");
      setEmail("");
      setRole("staff");
      setPassword("");
      onInvited();
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <UserPlus className="h-4 w-4" />
          Invite Staff
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Staff Member</DialogTitle>
          <DialogDescription>
            Create an account for a new team member. They'll be able to sign in immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Full Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" />
          </div>
          <div className="space-y-1.5">
            <Label>Email *</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="staff">Staff</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Default: EMFlow2026!"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleInvite} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Send Invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Business Profile Form ──
function BusinessProfileForm({
  business,
  accessToken,
  onSaved,
}: {
  business: BusinessInfo;
  accessToken: string;
  onSaved: (b: BusinessInfo) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(business.name);
  const [phone, setPhone] = useState(business.phone || "");
  const [email, setEmail] = useState(business.email || "");
  const [address, setAddress] = useState(business.address || "");
  const [industry, setIndustry] = useState(business.industry || "");

  const handleSave = async () => {
    setSaving(true);
    const { data, error } = await api<{ business: BusinessInfo }>(
      `/settings/business/${business.id}`,
      {
        method: "PUT",
        accessToken,
        body: { name, phone: phone || null, email: email || null, address: address || null, industry: industry || null },
      }
    );
    if (error) {
      toast.error(error);
    } else if (data?.business) {
      toast.success("Business profile updated");
      onSaved(data.business);
    }
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Business Profile</CardTitle>
        </div>
        <CardDescription>Update your business information</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Business Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Industry</Label>
            <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Healthcare" />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save Changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── WhatsApp Settings Form ──
function WhatsAppSettingsForm({
  businessId,
  settings,
  accessToken,
  onSaved,
}: {
  businessId: string;
  settings: WhatsAppSettings;
  accessToken: string;
  onSaved: (s: WhatsAppSettings) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [phoneNumber, setPhoneNumber] = useState(settings.phone_number || "");
  const [provider, setProvider] = useState(settings.provider || "twilio");

  const handleSave = async () => {
    setSaving(true);
    const { data, error } = await api<{ settings: WhatsAppSettings }>(
      `/settings/whatsapp/${businessId}`,
      {
        method: "PUT",
        accessToken,
        body: { enabled, phoneNumber: phoneNumber || null, provider },
      }
    );
    if (error) {
      toast.error(error);
    } else if (data?.settings) {
      toast.success("WhatsApp settings updated");
      onSaved(data.settings);
    }
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">WhatsApp Notifications</CardTitle>
        </div>
        <CardDescription>
          Configure automated WhatsApp messages for queue confirmations and turn notifications
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Enable WhatsApp</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Send automatic notifications when customers join or are called
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        {enabled && (
          <>
            <Separator />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>WhatsApp Phone Number</Label>
                <Input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+1234567890"
                />
                <p className="text-xs text-muted-foreground">
                  The number used to send messages (Twilio/provider number)
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Provider</Label>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="twilio">Twilio</SelectItem>
                    <SelectItem value="meta">Meta Business API</SelectItem>
                    <SelectItem value="messagebird">MessageBird</SelectItem>
                    <SelectItem value="custom">Custom Webhook</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <div className="text-xs text-blue-700 dark:text-blue-300">
                  <p className="font-medium">Provider Setup Required</p>
                  <p className="mt-0.5">
                    You'll need to configure your WhatsApp API credentials in your provider's dashboard.
                    Messages are sent using multilingual templates (EN, HI, TA, ML).
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save Settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
/**
 * User Profile Page — /admin/profile
 *
 * Allows the logged-in user (owner/staff) to:
 * - Upload & save a profile photo to Supabase Storage
 * - Edit their name and view their email
 * - Change their password with current-password verification
 */
import { useState, useRef } from "react";
import { useAuthStore } from "../../stores/auth-store";
import { api } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import { toast } from "sonner";
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
import { Separator } from "../../components/ui/separator";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "../../components/ui/avatar";
import {
  User,
  Mail,
  Camera,
  Save,
  Loader2,
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  KeyRound,
} from "lucide-react";

export function ProfilePage() {
  const { user, session, staffRecord, setRole, businessId, hasOnboarded } =
    useAuthStore();
  const accessToken = session?.access_token;

  // ── Avatar state ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Initialize with the existing avatar URL if it exists in the user's metadata
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    user?.user_metadata?.avatar_url || null,
  );
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  // ── Personal info state ──
  const [name, setName] = useState(staffRecord?.name || "");
  const [nameError, setNameError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // ── Password state ──
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  const PW_STRONG_RE =
    /^(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;

  const userEmail = user?.email || staffRecord?.email || "";
  const userInitial = (staffRecord?.name || user?.email || "U")
    .charAt(0)
    .toUpperCase();

  // ── Avatar Handlers ──
  const handleAvatarClick = () => {
    if (!isUploadingAvatar) {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be less than 5MB");
      return;
    }

    // 1. Show local preview immediately for snappy UX
    const url = URL.createObjectURL(file);
    setAvatarPreview(url);

    setIsUploadingAvatar(true);

    try {
      // 2. Generate a unique file path
      const fileExt = file.name.split(".").pop();
      const filePath = `${user?.id || "avatar"}-${Date.now()}.${fileExt}`;

      // 3. Upload the file to the Supabase 'avatars' bucket
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // 4. Get the permanent public URL
      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(filePath);

      // 5. Save that public URL to the user's auth metadata
      const { error: updateError } = await supabase.auth.updateUser({
        data: { avatar_url: publicUrl },
      });

      if (updateError) throw updateError;

      toast.success("Profile photo uploaded successfully!");
    } catch (error: any) {
      console.error("Upload error:", error);
      toast.error(error.message || "Failed to upload photo");
      // Revert to the original avatar if the upload fails
      setAvatarPreview(user?.user_metadata?.avatar_url || null);
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  // ── Save Profile ──
  const handleSaveProfile = async () => {
    if (!name.trim()) {
      setNameError("Name is required");
      return;
    }
    if (name.trim().length < 2) {
      setNameError("Name must be at least 2 characters");
      return;
    }
    setNameError("");

    setSavingProfile(true);
    const { data, error } = await api<{ staff: any }>("/settings/profile", {
      method: "PUT",
      accessToken: accessToken || "",
      body: { name: name.trim() },
    });

    if (error) {
      toast.error(error);
    } else {
      toast.success("Profile updated successfully");
      // Update the auth store with the new staff record
      if (data?.staff) {
        setRole(staffRecord?.role as any, businessId, hasOnboarded, data.staff);
      }
    }
    setSavingProfile(false);
  };

  // ── Password Validation & Update ──
  const handleUpdatePassword = async () => {
    setPasswordError("");

    if (!currentPassword) {
      setPasswordError("Current password is required");
      return;
    }

    if (!newPassword) {
      setPasswordError("New password is required");
      return;
    }

    if (!PW_STRONG_RE.test(newPassword)) {
      setPasswordError(
        "New password must be ≥8 characters and include a number and special character",
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirm password do not match");
      return;
    }

    if (currentPassword === newPassword) {
      setPasswordError("New password must be different from current password");
      return;
    }

    setSavingPassword(true);

    try {
      // Step 1: Verify current password by attempting to sign in
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: currentPassword,
      });

      if (signInError) {
        setPasswordError("Current password is incorrect");
        setSavingPassword(false);
        return;
      }

      // Step 2: Update to new password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        setPasswordError(`Failed to update password: ${updateError.message}`);
        setSavingPassword(false);
        return;
      }

      toast.success("Password updated successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordError("");
    } catch (err: any) {
      setPasswordError(err.message || "An unexpected error occurred");
    }

    setSavingPassword(false);
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>
        <p className="text-muted-foreground text-sm">
          Manage your account details and security settings
        </p>
      </div>

      {/* ════════════════════════════════════════════ */}
      {/* PROFILE PHOTO SECTION                      */}
      {/* ════════════════════════════════════════════ */}
      <Card>
        <CardContent className="flex flex-col items-center py-8 gap-4">
          <div
            className={`relative group ${isUploadingAvatar ? "cursor-not-allowed" : "cursor-pointer"}`}
            onClick={handleAvatarClick}
          >
            <Avatar
              className={`h-28 w-28 ring-4 ring-primary/10 transition-all duration-300 ${!isUploadingAvatar && "group-hover:ring-primary/30"}`}
            >
              {avatarPreview ? (
                <AvatarImage
                  src={avatarPreview}
                  alt="Profile photo"
                  className={isUploadingAvatar ? "opacity-50" : ""}
                />
              ) : null}
              <AvatarFallback className="text-3xl font-bold bg-primary/10 text-primary">
                {userInitial}
              </AvatarFallback>
            </Avatar>

            {/* Camera/Loading overlay */}
            <div
              className={`absolute inset-0 flex items-center justify-center rounded-full bg-black/40 transition-opacity duration-200 ${isUploadingAvatar ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            >
              {isUploadingAvatar ? (
                <Loader2 className="h-7 w-7 text-white animate-spin" />
              ) : (
                <Camera className="h-7 w-7 text-white" />
              )}
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
            id="profile-photo-input"
            disabled={isUploadingAvatar}
          />

          <div className="text-center">
            <p className="font-semibold text-foreground">
              {staffRecord?.name || "User"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{userEmail}</p>
            {staffRecord?.role && (
              <span className="inline-flex items-center gap-1 mt-2 px-2.5 py-0.5 rounded-full text-[0.65rem] font-medium bg-primary/10 text-primary capitalize">
                <ShieldCheck className="h-3 w-3" />
                {staffRecord.role}
              </span>
            )}
          </div>

          <button
            onClick={handleAvatarClick}
            disabled={isUploadingAvatar}
            className="text-xs text-primary hover:text-primary/80 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploadingAvatar ? "Uploading..." : "Click to upload a photo"}
          </button>
        </CardContent>
      </Card>

      {/* ════════════════════════════════════════════ */}
      {/* PERSONAL INFORMATION                        */}
      {/* ════════════════════════════════════════════ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="h-5 w-5 text-primary" />
            Personal Information
          </CardTitle>
          <CardDescription>
            Update your name and view your account email
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-name">Full Name</Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError("");
                }}
                onBlur={() => {
                  if (!name.trim()) setNameError("Name is required");
                  else if (name.trim().length < 2)
                    setNameError("Name must be at least 2 characters");
                }}
                placeholder="Enter your full name"
                className="pl-10"
                aria-invalid={!!nameError}
              />
            </div>
            {nameError && (
              <p className="text-xs text-destructive mt-1">{nameError}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-email">Email Address</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="profile-email"
                value={userEmail}
                readOnly
                disabled
                className="pl-10 opacity-60 cursor-not-allowed"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Email is managed by your authentication provider and cannot be
              changed here.
            </p>
          </div>

          <div className="pt-2">
            <Button
              onClick={handleSaveProfile}
              disabled={savingProfile || !name.trim()}
              className="gap-2"
              id="save-profile-btn"
            >
              {savingProfile ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ════════════════════════════════════════════ */}
      {/* PASSWORD UPDATE                             */}
      {/* ════════════════════════════════════════════ */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="h-5 w-5 text-primary" />
            Update Password
          </CardTitle>
          <CardDescription>
            Change your password to keep your account secure
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current Password */}
          <div className="space-y-2">
            <Label htmlFor="current-password">Current Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="current-password"
                type={showCurrentPw ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  setPasswordError("");
                }}
                placeholder="Enter current password"
                className="pl-10 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPw(!showCurrentPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showCurrentPw ? "Hide password" : "Show password"}
              >
                {showCurrentPw ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <Separator />

          {/* New Password */}
          <div className="space-y-2">
            <Label htmlFor="new-password">New Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="new-password"
                type={showNewPw ? "text" : "password"}
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setPasswordError("");
                }}
                placeholder="Enter new password"
                className="pl-10 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowNewPw(!showNewPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showNewPw ? "Hide password" : "Show password"}
              >
                {showNewPw ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Confirm Password */}
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="confirm-password"
                type={showConfirmPw ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setPasswordError("");
                }}
                placeholder="Confirm new password"
                className="pl-10 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPw(!showConfirmPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showConfirmPw ? "Hide password" : "Show password"}
              >
                {showConfirmPw ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Mismatch / error indicator */}
          {confirmPassword && newPassword !== confirmPassword && (
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive" />
              Passwords do not match
            </p>
          )}

          {passwordError && (
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive" />
              {passwordError}
            </p>
          )}

          <div className="pt-2">
            <Button
              onClick={handleUpdatePassword}
              disabled={
                savingPassword ||
                !currentPassword ||
                !newPassword ||
                !confirmPassword
              }
              variant="default"
              className="gap-2"
              id="update-password-btn"
            >
              {savingPassword ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              Update Password
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

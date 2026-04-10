/**
 * Login Page - Full authentication with multiple methods.
 * Supports: Email/Password, Google, Phone OTP, Magic Link
 */
import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router";
import { useLocaleStore } from "../../stores/locale-store";
import { useAuthStore } from "../../stores/auth-store";
import { supabase } from "../../lib/supabase";
import { api } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Separator } from "../../components/ui/separator";
import {
  Zap,
  Loader2,
  Mail,
  Phone,
  KeyRound,
  ArrowLeft,
  CheckCircle2,
} from "lucide-react";

type AuthMode =
  | "select"
  | "email"
  | "signup"
  | "magic"
  | "phone"
  | "otp-verify";

export function LoginPage() {
  const { t } = useLocaleStore();
  const navigate = useNavigate();
  const { isAuthenticated, role, hasOnboarded } = useAuthStore();

  const [mode, setMode] = useState<AuthMode>("select");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PW_STRONG_RE =
    /^(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
  const PHONE_RE = /^\+?[\d\s\-()]{10,15}$/;

  const fe = (field: string, msg: string) =>
    setFieldErrors((p) => ({ ...p, [field]: msg }));
  const clearFe = (field: string) =>
    setFieldErrors((p) => {
      const n = { ...p };
      delete n[field];
      return n;
    });

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      if (!hasOnboarded && !role) {
        navigate("/onboarding", { replace: true });
      } else if (role === "customer") {
        navigate("/", { replace: true });
      } else {
        navigate("/admin", { replace: true });
      }
    }
  }, [isAuthenticated, role, hasOnboarded, navigate]);

  const resetMessages = () => {
    setError("");
    setSuccess("");
    setFieldErrors({});
  };

  // ── Email/Password Login ──
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    const errs: Record<string, string> = {};
    if (!email.trim()) errs.email = "Email is required";
    else if (!EMAIL_RE.test(email)) errs.email = "Enter a valid email address";
    if (!password) errs.password = "Password is required";
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) setError(error.message);
    } catch {
      setError("An unexpected error occurred during login");
    } finally {
      setLoading(false);
    }
  };

  // ── Email/Password Signup ──
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    const errs: Record<string, string> = {};
    if (!name.trim() || name.trim().length < 2)
      errs.signupName = "Full name must be at least 2 characters";
    if (!email.trim()) errs.signupEmail = "Email is required";
    else if (!EMAIL_RE.test(email))
      errs.signupEmail = "Enter a valid email address";
    if (!password) errs.signupPassword = "Password is required";
    else if (!PW_STRONG_RE.test(password))
      errs.signupPassword =
        "Must be ≥8 characters and include a number and special character";
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }
    setLoading(true);
    try {
      const { error: signupErr } = await api("/auth/signup", {
        method: "POST",
        body: { email, password, name },
      });
      if (signupErr) {
        // If user already exists, show error instead of auto-signing in
        if (
          signupErr.toLowerCase().includes("already") ||
          signupErr.toLowerCase().includes("registered") ||
          signupErr.toLowerCase().includes("exists")
        ) {
          setError("User already exists. Please try with another email.");
          return;
        }
        setError(signupErr);
        return;
      }
      // Auto sign-in after successful signup
      const { error: loginErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (loginErr) setError(loginErr.message);
    } catch {
      setError("An unexpected error occurred during signup");
    } finally {
      setLoading(false);
    }
  };

  // ── Google OAuth ──
  const handleGoogleLogin = async () => {
    setLoading(true);
    resetMessages();
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin + "/admin",
        },
      });
      if (error) setError(error.message);
    } catch {
      setError("Google login failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Magic Link ──
  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    const errs: Record<string, string> = {};
    if (!email.trim()) errs.magicEmail = "Email is required";
    else if (!EMAIL_RE.test(email))
      errs.magicEmail = "Enter a valid email address";
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin + "/admin",
        },
      });
      if (error) {
        setError(error.message);
      } else {
        setSuccess("Magic link sent! Check your email inbox.");
      }
    } catch {
      setError("Failed to send magic link");
    } finally {
      setLoading(false);
    }
  };

  // ── Phone OTP ──
  const handlePhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    const errs: Record<string, string> = {};
    if (!phone.trim()) errs.phone = "Phone number is required";
    else if (!PHONE_RE.test(phone))
      errs.phone =
        "Enter a valid phone number (10–15 digits, with optional + prefix)";
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone });
      if (error) {
        setError(error.message);
      } else {
        setMode("otp-verify");
        setSuccess("OTP sent to your phone.");
      }
    } catch {
      setError("Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  // ── Verify Phone OTP ──
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    const errs: Record<string, string> = {};
    if (!otpCode.trim()) errs.otpCode = "Verification code is required";
    else if (!/^\d{6}$/.test(otpCode))
      errs.otpCode = "Enter the 6-digit code sent to your phone";
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone,
        token: otpCode,
        type: "sms",
      });
      if (error) setError(error.message);
    } catch {
      setError("OTP verification failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md animate-fade-in">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
            <Zap className="h-7 w-7 text-primary-foreground" />
          </div>
          <CardTitle className="text-xl">Quecumber</CardTitle>
          <CardDescription>
            {mode === "signup"
              ? "Create your account"
              : mode === "select"
                ? t("common.description")
                : "Sign in to your account"}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
              <p className="text-destructive text-sm">{error}</p>
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <p className="text-emerald-700 dark:text-emerald-400 text-sm">
                {success}
              </p>
            </div>
          )}

          {/* ── Method Selection ── */}
          {mode === "select" && (
            <div className="space-y-3">
              <Button
                className="w-full justify-start gap-3"
                variant="outline"
                onClick={() => {
                  resetMessages();
                  setMode("email");
                }}
              >
                <Mail className="h-4 w-4" />
                Continue with Email
              </Button>

              <Button
                className="w-full justify-start gap-3"
                variant="outline"
                onClick={handleGoogleLogin}
                disabled={loading}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Continue with Google
              </Button>

              <Button
                className="w-full justify-start gap-3"
                variant="outline"
                onClick={() => {
                  resetMessages();
                  setMode("magic");
                }}
              >
                <KeyRound className="h-4 w-4" />
                Magic Link
              </Button>

              <Button
                className="w-full justify-start gap-3"
                variant="outline"
                onClick={() => {
                  resetMessages();
                  setMode("phone");
                }}
              >
                <Phone className="h-4 w-4" />
                Phone OTP
              </Button>

              <Separator />

              <p className="text-center text-sm text-muted-foreground">
                Don't have an account?{" "}
                <button
                  className="text-primary underline-offset-4 hover:underline font-medium"
                  onClick={() => {
                    resetMessages();
                    setMode("signup");
                  }}
                >
                  Sign up
                </button>
              </p>
            </div>
          )}

          {/* ── Email/Password Login ── */}
          {mode === "email" && (
            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearFe("email");
                  }}
                  onBlur={() => {
                    if (!email.trim()) fe("email", "Email is required");
                    else if (!EMAIL_RE.test(email))
                      fe("email", "Enter a valid email address");
                  }}
                  aria-invalid={!!fieldErrors.email}
                  autoFocus
                />
                {fieldErrors.email && (
                  <p className="text-xs text-destructive mt-1">
                    {fieldErrors.email}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearFe("password");
                  }}
                  onBlur={() => {
                    if (!password) fe("password", "Password is required");
                  }}
                  aria-invalid={!!fieldErrors.password}
                />
                {fieldErrors.password && (
                  <p className="text-xs text-destructive mt-1">
                    {fieldErrors.password}
                  </p>
                )}
                <div className="text-right">
                  <Link
                    to="/forgot-password"
                    className="text-sm text-primary underline-offset-4 hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign In
              </Button>
              <BackButton onClick={() => setMode("select")} />
            </form>
          )}

          {/* ── Signup ── */}
          {mode === "signup" && (
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signup-name">Full Name</Label>
                <Input
                  id="signup-name"
                  type="text"
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    clearFe("signupName");
                  }}
                  onBlur={() => {
                    if (!name.trim() || name.trim().length < 2)
                      fe(
                        "signupName",
                        "Full name must be at least 2 characters",
                      );
                  }}
                  aria-invalid={!!fieldErrors.signupName}
                  autoFocus
                />
                {fieldErrors.signupName && (
                  <p className="text-xs text-destructive mt-1">
                    {fieldErrors.signupName}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-email">Email</Label>
                <Input
                  id="signup-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearFe("signupEmail");
                  }}
                  onBlur={() => {
                    if (!email.trim()) fe("signupEmail", "Email is required");
                    else if (!EMAIL_RE.test(email))
                      fe("signupEmail", "Enter a valid email address");
                  }}
                  aria-invalid={!!fieldErrors.signupEmail}
                />
                {fieldErrors.signupEmail && (
                  <p className="text-xs text-destructive mt-1">
                    {fieldErrors.signupEmail}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password">Password</Label>
                <Input
                  id="signup-password"
                  type="password"
                  placeholder="Min. 8 chars, 1 number, 1 special"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearFe("signupPassword");
                  }}
                  onBlur={() => {
                    if (!password) fe("signupPassword", "Password is required");
                    else if (!PW_STRONG_RE.test(password))
                      fe(
                        "signupPassword",
                        "Must be ≥8 characters and include a number and special character",
                      );
                  }}
                  aria-invalid={!!fieldErrors.signupPassword}
                />
                {fieldErrors.signupPassword && (
                  <p className="text-xs text-destructive mt-1">
                    {fieldErrors.signupPassword}
                  </p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Account
              </Button>
              <BackButton onClick={() => setMode("select")} />
            </form>
          )}

          {/* ── Magic Link ── */}
          {mode === "magic" && (
            <form onSubmit={handleMagicLink} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="magic-email">Email</Label>
                <Input
                  id="magic-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearFe("magicEmail");
                  }}
                  onBlur={() => {
                    if (!email.trim()) fe("magicEmail", "Email is required");
                    else if (!EMAIL_RE.test(email))
                      fe("magicEmail", "Enter a valid email address");
                  }}
                  aria-invalid={!!fieldErrors.magicEmail}
                  autoFocus
                />
                {fieldErrors.magicEmail && (
                  <p className="text-xs text-destructive mt-1">
                    {fieldErrors.magicEmail}
                  </p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send Magic Link
              </Button>
              <BackButton onClick={() => setMode("select")} />
            </form>
          )}

          {/* ── Phone OTP ── */}
          {mode === "phone" && (
            <form onSubmit={handlePhoneOtp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+1234567890"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    clearFe("phone");
                  }}
                  onBlur={() => {
                    if (!phone.trim()) fe("phone", "Phone number is required");
                    else if (!PHONE_RE.test(phone))
                      fe(
                        "phone",
                        "Enter a valid phone number (10–15 digits, with optional + prefix)",
                      );
                  }}
                  aria-invalid={!!fieldErrors.phone}
                  autoFocus
                />
                {fieldErrors.phone ? (
                  <p className="text-xs text-destructive mt-1">
                    {fieldErrors.phone}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Include country code (e.g. +1 for US)
                  </p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send OTP
              </Button>
              <BackButton onClick={() => setMode("select")} />
            </form>
          )}

          {/* ── OTP Verify ── */}
          {mode === "otp-verify" && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="otp">Verification Code</Label>
                <Input
                  id="otp"
                  type="text"
                  placeholder="Enter 6-digit code"
                  value={otpCode}
                  onChange={(e) => {
                    setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                    clearFe("otpCode");
                  }}
                  onBlur={() => {
                    if (!otpCode)
                      fe("otpCode", "Verification code is required");
                    else if (!/^\d{6}$/.test(otpCode))
                      fe(
                        "otpCode",
                        "Enter the 6-digit code sent to your phone",
                      );
                  }}
                  aria-invalid={!!fieldErrors.otpCode}
                  maxLength={6}
                  autoFocus
                />
                {fieldErrors.otpCode ? (
                  <p className="text-xs text-destructive mt-1">
                    {fieldErrors.otpCode}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Sent to {phone}
                  </p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verify Code
              </Button>
              <BackButton
                onClick={() => setMode("phone")}
                label="Change number"
              />
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BackButton({
  onClick,
  label = "Back to all options",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      onClick={onClick}
    >
      <ArrowLeft className="h-3 w-3" />
      {label}
    </button>
  );
}

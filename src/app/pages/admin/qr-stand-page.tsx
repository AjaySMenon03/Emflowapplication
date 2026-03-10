/**
 * QR Stand Generator — /admin/qr/:locationId
 *
 * Premium printable QR stand for hospitality / queue management.
 * Features:
 *   - A4 vertical preview (1080×1920 aspect ratio)
 *   - Light & Dark theme variants
 *   - Brand accent color picker
 *   - Business logo placeholder
 *   - Multi-language instruction text
 *   - Download as PNG (html2canvas) & PDF (jspdf)
 *   - Location-specific QR code linking to /join/:slug
 */
import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { QRCodeSVG } from "qrcode.react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { useLocaleStore } from "../../stores/locale-store";
import { useAuthStore } from "../../stores/auth-store";
import { api } from "../../lib/api";
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
import { Textarea } from "../../components/ui/textarea";
import { Badge } from "../../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Separator } from "../../components/ui/separator";
import { Switch } from "../../components/ui/switch";
import {
  ArrowLeft,
  Download,
  FileImage,
  FileText,
  Loader2,
  QrCode,
  Palette,
  Sun,
  Moon,
  Globe,
  Zap,
  Smartphone,
  Clock,
  CheckCircle,
  Copy,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

// ── Multilingual stand text ──
const STAND_TEXT: Record<
  string,
  {
    scanTitle: string;
    scanSubtitle: string;
    instructionDefault: string;
    poweredBy: string;
    liveUpdates: string;
    step1: string;
    step2: string;
    step3: string;
  }
> = {
  en: {
    scanTitle: "Scan to Join the Queue",
    scanSubtitle: "Live wait time updates",
    instructionDefault:
      "Point your phone camera at the QR code to join instantly.",
    poweredBy: "Powered by Quecumber",
    liveUpdates: "Real-time updates on your phone",
    step1: "Scan QR Code",
    step2: "Enter Your Details",
    step3: "Track Your Position",
  },
  hi: {
    scanTitle: "कतार में शामिल होने के लिए स्कैन करें",
    scanSubtitle: "लाइव प्रतीक्षा समय अपडेट",
    instructionDefault:
      "तुरंत शामिल होने के ��िए अपने फ़ोन कैमरे को QR कोड पर इंगित करें।",
    poweredBy: "Quecumber द्वारा संचालित",
    liveUpdates: "आपके फ़ोन पर रियल-टाइम अपडेट",
    step1: "QR कोड स्कैन करें",
    step2: "अपना विवरण दर्ज करें",
    step3: "अपनी स्थिति ट्रैक करें",
  },
  ta: {
    scanTitle: "வரிசையில் சேர ஸ்கேன் செய்யுங்கள்",
    scanSubtitle: "நேரடி காத்திருப்பு நேர புதுப்பிப்புகள்",
    instructionDefault:
      "உடனடியாக சேர உங்கள் தொலைபேசி கேமராவை QR குறியீட்டில் காட்டுங்கள்.",
    poweredBy: "Quecumber மூலம் இயக்கப்படுகிறது",
    liveUpdates: "உங்கள் தொலைபேசியில் நிகழ்நேர புதுப்பிப்புகள்",
    step1: "QR குறியீட்டை ஸ்கேன் செய்யுங்கள்",
    step2: "உங்கள் விவரங்களை உள்ளிடுங்கள்",
    step3: "உங்கள் நிலையை கண்காணியுங்கள்",
  },
  ml: {
    scanTitle: "ക്യൂവില്‍ ചേരാന്‍ സ്കാന്‍ ചെയ്യുക",
    scanSubtitle: "ലൈവ് കാത്തിരിപ്പ് സമയ അപ്ഡേറ്റുകള്‍",
    instructionDefault:
      "ഉടനടി ചേരാന്‍ നിങ്ങളുടെ ഫോണ്‍ ക്യാമറ QR കോഡിലേക്ക് ചൂണ്ടുക.",
    poweredBy: "Quecumber നല്‍കുന്നത്",
    liveUpdates: "നിങ്ങളുടെ ഫോണില്‍ തത്സമയ അപ്ഡേറ്റുകള്‍",
    step1: "QR കോഡ് സ്കാന്‍ ചെയ്യുക",
    step2: "നിങ്ങളുടെ വിവരങ്ങള്‍ നല്‍കുക",
    step3: "നിങ്ങളുടെ സ്ഥാനം ട്രാക്ക് ചെയ്യുക",
  },
};

const ACCENT_PRESETS = [
  { name: "Emerald", value: "#10b981" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Purple", value: "#8b5cf6" },
  { name: "Rose", value: "#f43f5e" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Indigo", value: "#6366f1" },
  { name: "Coral", value: "#ff6b6b" },
];

// ── The printable stand component ──
function QRStandPreview({
  locationName,
  businessName,
  joinUrl,
  accentColor,
  isDark,
  language,
  customInstruction,
  showSteps,
}: {
  locationName: string;
  businessName: string;
  joinUrl: string;
  accentColor: string;
  isDark: boolean;
  language: string;
  customInstruction: string;
  showSteps: boolean;
}) {
  const texts = STAND_TEXT[language] || STAND_TEXT.en;
  const bg = isDark ? "#0f172a" : "#ffffff";
  const cardBg = isDark ? "#1e293b" : "#f8fafc";
  const textPrimary = isDark ? "#f1f5f9" : "#0f172a";
  const textSecondary = isDark ? "#94a3b8" : "#64748b";
  const textMuted = isDark ? "#64748b" : "#94a3b8";
  const qrBg = "#ffffff";
  const qrFg = "#0f172a";
  const borderColor = isDark ? "#334155" : "#e2e8f0";
  const stepBg = isDark ? "#0f172a" : "#ffffff";

  return (
    <div
      style={{
        width: "1080px",
        height: "1920px",
        background: bg,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "80px 72px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Decorative accent top bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "8px",
          background: `linear-gradient(90deg, ${accentColor}, ${accentColor}cc, ${accentColor}88)`,
        }}
      />

      {/* Subtle decorative circles */}
      <div
        style={{
          position: "absolute",
          top: "-120px",
          right: "-120px",
          width: "400px",
          height: "400px",
          borderRadius: "50%",
          background: `${accentColor}08`,
          border: `1px solid ${accentColor}15`,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "-80px",
          left: "-80px",
          width: "300px",
          height: "300px",
          borderRadius: "50%",
          background: `${accentColor}06`,
          border: `1px solid ${accentColor}10`,
        }}
      />

      {/* ── Top: Logo & Business Name ── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "24px",
          zIndex: 1,
        }}
      >
        {/* Logo placeholder */}
        <div
          style={{
            width: "100px",
            height: "100px",
            borderRadius: "24px",
            background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 8px 32px ${accentColor}40`,
          }}
        >
          <svg
            width="52"
            height="52"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </div>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: "42px",
              fontWeight: 800,
              color: textPrimary,
              letterSpacing: "-1px",
              lineHeight: 1.2,
            }}
          >
            {businessName}
          </div>
          <div
            style={{
              fontSize: "26px",
              fontWeight: 500,
              color: textSecondary,
              marginTop: "8px",
              letterSpacing: "0.5px",
            }}
          >
            {locationName}
          </div>
        </div>
      </div>

      {/* ── Center: QR Code Card ── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "40px",
          zIndex: 1,
        }}
      >
        {/* Title */}
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: "52px",
              fontWeight: 800,
              color: textPrimary,
              letterSpacing: "-1.5px",
              lineHeight: 1.15,
              maxWidth: "800px",
            }}
          >
            {texts.scanTitle}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              marginTop: "20px",
            }}
          >
            <div
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: "#10b981",
                animation: "pulse 2s infinite",
              }}
            />
            <span
              style={{
                fontSize: "24px",
                fontWeight: 500,
                color: accentColor,
                letterSpacing: "0.5px",
              }}
            >
              {texts.scanSubtitle}
            </span>
          </div>
        </div>

        {/* QR Code */}
        <div
          style={{
            background: qrBg,
            borderRadius: "32px",
            padding: "40px",
            boxShadow: isDark
              ? `0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px ${borderColor}`
              : `0 20px 60px rgba(0,0,0,0.08), 0 0 0 1px ${borderColor}`,
            position: "relative",
          }}
        >
          {/* Accent corner decorations */}
          <div
            style={{
              position: "absolute",
              top: "12px",
              left: "12px",
              width: "40px",
              height: "40px",
              borderTop: `4px solid ${accentColor}`,
              borderLeft: `4px solid ${accentColor}`,
              borderRadius: "8px 0 0 0",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "12px",
              right: "12px",
              width: "40px",
              height: "40px",
              borderTop: `4px solid ${accentColor}`,
              borderRight: `4px solid ${accentColor}`,
              borderRadius: "0 8px 0 0",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: "12px",
              left: "12px",
              width: "40px",
              height: "40px",
              borderBottom: `4px solid ${accentColor}`,
              borderLeft: `4px solid ${accentColor}`,
              borderRadius: "0 0 0 8px",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: "12px",
              right: "12px",
              width: "40px",
              height: "40px",
              borderBottom: `4px solid ${accentColor}`,
              borderRight: `4px solid ${accentColor}`,
              borderRadius: "0 0 8px 0",
            }}
          />
          <QRCodeSVG
            value={joinUrl}
            size={380}
            level="H"
            includeMargin={false}
            bgColor={qrBg}
            fgColor={qrFg}
          />
        </div>

        {/* Instruction */}
        {customInstruction && (
          <div
            style={{
              fontSize: "22px",
              color: textSecondary,
              textAlign: "center",
              maxWidth: "700px",
              lineHeight: 1.6,
              fontWeight: 400,
            }}
          >
            {customInstruction}
          </div>
        )}
      </div>

      {/* ── Bottom: Steps + Branding ── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "40px",
          width: "100%",
          zIndex: 1,
        }}
      >
        {/* Steps */}
        {showSteps && (
          <div
            style={{
              display: "flex",
              gap: "24px",
              width: "100%",
              justifyContent: "center",
            }}
          >
            {[
              { num: "1", icon: "📱", label: texts.step1 },
              { num: "2", icon: "✏️", label: texts.step2 },
              { num: "3", icon: "📍", label: texts.step3 },
            ].map((step, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  maxWidth: "260px",
                  background: stepBg,
                  borderRadius: "20px",
                  padding: "28px 20px",
                  textAlign: "center",
                  border: `1px solid ${borderColor}`,
                }}
              >
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "50%",
                    background: `${accentColor}15`,
                    color: accentColor,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 14px",
                    fontSize: "20px",
                    fontWeight: 800,
                    border: `2px solid ${accentColor}30`,
                  }}
                >
                  {step.num}
                </div>
                <div
                  style={{
                    fontSize: "18px",
                    fontWeight: 600,
                    color: textPrimary,
                    lineHeight: 1.4,
                  }}
                >
                  {step.label}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Powered by */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            opacity: 0.5,
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill={accentColor}
            stroke="none"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span
            style={{
              fontSize: "18px",
              fontWeight: 500,
              color: textMuted,
              letterSpacing: "1px",
              textTransform: "uppercase",
            }}
          >
            {texts.poweredBy}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──
export function QRStandPage() {
  const { t } = useLocaleStore();
  const { session, staffRecord, businessId } = useAuthStore();
  const accessToken = session?.access_token;
  const { locationId } = useParams<{ locationId: string }>();
  const navigate = useNavigate();
  const standRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<"png" | "pdf" | null>(null);
  const [location, setLocation] = useState<any>(null);
  const [business, setBusiness] = useState<any>(null);
  const [locations, setLocations] = useState<any[]>([]);

  // Customization state
  const [accentColor, setAccentColor] = useState("#10b981");
  const [isDark, setIsDark] = useState(false);
  const [standLanguage, setStandLanguage] = useState("en");
  const [customInstruction, setCustomInstruction] = useState("");
  const [showSteps, setShowSteps] = useState(true);

  // Selected location for when no locationId in URL
  const [selectedLocationId, setSelectedLocationId] = useState(
    locationId || "",
  );

  // Load data
  useEffect(() => {
    if (!businessId || !accessToken) return;
    (async () => {
      // Fetch business
      const { data: bizData } = await api<{ business: any }>(
        `/business/${businessId}`,
        { accessToken },
      );
      if (bizData?.business) setBusiness(bizData.business);

      // Fetch all locations
      const { data: locData } = await api<{ locations: any[] }>(
        `/business/${businessId}/locations`,
        { accessToken },
      );
      if (locData?.locations) {
        setLocations(locData.locations);
        if (locationId) {
          const loc = locData.locations.find((l: any) => l.id === locationId);
          if (loc) {
            setLocation(loc);
            setSelectedLocationId(loc.id);
          }
        } else if (locData.locations.length > 0) {
          setLocation(locData.locations[0]);
          setSelectedLocationId(locData.locations[0].id);
        }
      }
      setLoading(false);
    })();
  }, [businessId, accessToken, locationId]);

  // Update location when selector changes
  useEffect(() => {
    if (selectedLocationId && locations.length > 0) {
      const loc = locations.find((l) => l.id === selectedLocationId);
      if (loc) setLocation(loc);
    }
  }, [selectedLocationId, locations]);

  // Set default instruction based on language
  useEffect(() => {
    const texts = STAND_TEXT[standLanguage] || STAND_TEXT.en;
    setCustomInstruction(texts.instructionDefault);
  }, [standLanguage]);

  // Build join URL
  const joinUrl = location?.slug
    ? `${window.location.origin}/join/${location.slug}`
    : "";

  /**
   * html2canvas does not support oklch() colors (used by shadcn/Tailwind CSS
   * variables). This callback strips them from the cloned DOM before rendering.
   */
  const sanitizeClone = useCallback((_doc: Document, element: HTMLElement) => {
    // Remove oklch values from CSS custom properties on all elements
    const walker = element.querySelectorAll("*");
    const fixElement = (el: HTMLElement) => {
      const style = el.style;
      for (let i = style.length - 1; i >= 0; i--) {
        const prop = style[i];
        const val = style.getPropertyValue(prop);
        if (val && val.includes("oklch(")) {
          style.setProperty(prop, "transparent");
        }
      }
    };
    fixElement(element);
    walker.forEach((el) => fixElement(el as HTMLElement));

    // Also strip oklch from all <style> tags and stylesheets in the cloned doc
    _doc.querySelectorAll("style").forEach((styleEl) => {
      if (styleEl.textContent && styleEl.textContent.includes("oklch(")) {
        styleEl.textContent = styleEl.textContent.replace(
          /oklch\([^)]*\)/g,
          "transparent",
        );
      }
    });
  }, []);

  // ── Export as PNG ──
  const exportPNG = useCallback(async () => {
    if (!standRef.current) return;
    setExporting("png");
    try {
      const canvas = await html2canvas(standRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        logging: false,
        width: 1080,
        height: 1920,
        onclone: sanitizeClone,
      });
      const link = document.createElement("a");
      link.download = `qr-stand-${location?.slug || "emflow"}-${isDark ? "dark" : "light"}.png`;
      link.href = canvas.toDataURL("image/png", 1.0);
      link.click();
      toast.success(t("qr.downloadSuccess"));
    } catch (err) {
      console.error("PNG export error:", err);
      toast.error(t("qr.downloadError"));
    }
    setExporting(null);
  }, [location, isDark, t, sanitizeClone]);

  // ── Export as PDF ──
  const exportPDF = useCallback(async () => {
    if (!standRef.current) return;
    setExporting("pdf");
    try {
      const canvas = await html2canvas(standRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        logging: false,
        width: 1080,
        height: 1920,
        onclone: sanitizeClone,
      });
      const imgData = canvas.toDataURL("image/png", 1.0);
      // A4 portrait in mm: 210 x 297
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();
      pdf.addImage(imgData, "PNG", 0, 0, pdfW, pdfH);
      pdf.save(
        `qr-stand-${location?.slug || "emflow"}-${isDark ? "dark" : "light"}.pdf`,
      );
      toast.success(t("qr.downloadSuccess"));
    } catch (err) {
      console.error("PDF export error:", err);
      toast.error(t("qr.downloadError"));
    }
    setExporting(null);
  }, [location, isDark, t, sanitizeClone]);

  // Copy join URL
  const copyUrl = useCallback(() => {
    if (joinUrl) {
      navigator.clipboard.writeText(joinUrl);
      toast.success(t("common.copiedToClipboard"));
    }
  }, [joinUrl, t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/admin/settings")}
            className="h-9 w-9"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <QrCode className="h-6 w-6 text-primary" />
              {t("qr.title")}
            </h1>
            <p className="text-muted-foreground text-sm">{t("qr.subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={exportPNG}
            disabled={!!exporting || !location}
            className="gap-2"
          >
            {exporting === "png" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileImage className="h-4 w-4" />
            )}
            {t("qr.downloadPNG")}
          </Button>
          <Button
            onClick={exportPDF}
            disabled={!!exporting || !location}
            className="gap-2"
          >
            {exporting === "pdf" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            {t("qr.downloadPDF")}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* ── Left: Controls ── */}
        <div className="space-y-5">
          {/* Location Selector */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                {t("qr.location")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select
                value={selectedLocationId}
                onValueChange={setSelectedLocationId}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("queue.selectLocation")} />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {joinUrl && (
                <div className="flex items-center gap-2">
                  <Input
                    value={joinUrl}
                    readOnly
                    className="text-xs font-mono"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={copyUrl}
                    className="shrink-0 h-9 w-9"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => window.open(joinUrl, "_blank")}
                    className="shrink-0 h-9 w-9"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Theme Toggle */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                {isDark ? (
                  <Moon className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Sun className="h-4 w-4 text-muted-foreground" />
                )}
                {t("qr.theme")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3">
                <button
                  onClick={() => setIsDark(false)}
                  className={`flex-1 rounded-xl border-2 p-3 transition-all ${
                    !isDark
                      ? "border-primary ring-2 ring-primary/20"
                      : "border-border hover:border-muted-foreground/50"
                  }`}
                >
                  <div className="h-16 rounded-lg bg-white border border-gray-200 mb-2 flex items-center justify-center">
                    <Sun className="h-5 w-5 text-amber-500" />
                  </div>
                  <span className="text-xs font-medium">{t("qr.light")}</span>
                </button>
                <button
                  onClick={() => setIsDark(true)}
                  className={`flex-1 rounded-xl border-2 p-3 transition-all ${
                    isDark
                      ? "border-primary ring-2 ring-primary/20"
                      : "border-border hover:border-muted-foreground/50"
                  }`}
                >
                  <div className="h-16 rounded-lg bg-slate-900 border border-slate-700 mb-2 flex items-center justify-center">
                    <Moon className="h-5 w-5 text-slate-300" />
                  </div>
                  <span className="text-xs font-medium">{t("qr.dark")}</span>
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Accent Color */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Palette className="h-4 w-4 text-muted-foreground" />
                {t("qr.accentColor")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                {ACCENT_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => setAccentColor(preset.value)}
                    className={`group flex flex-col items-center gap-1.5 rounded-lg p-2 transition-all ${
                      accentColor === preset.value
                        ? "ring-2 ring-primary bg-accent"
                        : "hover:bg-accent/50"
                    }`}
                  >
                    <div
                      className="h-8 w-8 rounded-full shadow-sm transition-transform group-hover:scale-110"
                      style={{ backgroundColor: preset.value }}
                    />
                    <span className="text-[0.6rem] text-muted-foreground font-medium">
                      {preset.name}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground shrink-0">
                  {t("qr.customColor")}
                </Label>
                <Input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="h-8 w-12 p-0.5 cursor-pointer"
                />
                <Input
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="font-mono text-xs h-8 flex-1"
                  placeholder="#10b981"
                />
              </div>
            </CardContent>
          </Card>

          {/* Language */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                {t("qr.standLanguage")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={standLanguage} onValueChange={setStandLanguage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="hi">हिन्दी (Hindi)</SelectItem>
                  <SelectItem value="ta">தமிழ் (Tamil)</SelectItem>
                  <SelectItem value="ml">മലയാളം (Malayalam)</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Custom Instruction */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                {t("qr.instruction")}
              </CardTitle>
              <CardDescription className="text-xs">
                {t("qr.instructionDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={customInstruction}
                onChange={(e) => setCustomInstruction(e.target.value)}
                rows={2}
                className="text-sm resize-none"
                placeholder={
                  (STAND_TEXT[standLanguage] || STAND_TEXT.en)
                    .instructionDefault
                }
              />
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">
                  {t("qr.showSteps")}
                </Label>
                <Switch checked={showSteps} onCheckedChange={setShowSteps} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Right: Preview ── */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">
                {t("qr.preview")}
              </CardTitle>
              <Badge variant="secondary" className="text-[0.6rem]">
                1080 × 1920
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center">
              <div
                className="border border-border rounded-2xl shadow-2xl overflow-hidden"
                style={{
                  width: "360px",
                  height: "640px",
                }}
              >
                <div
                  style={{
                    width: "360px",
                    height: "640px",
                    overflow: "hidden",
                  }}
                >
                  {/* Scaled preview */}
                  <div
                    style={{
                      transform: "scale(0.3333)",
                      transformOrigin: "top left",
                      width: "1080px",
                      height: "1920px",
                    }}
                  >
                    <QRStandPreview
                      locationName={location?.name || "Location"}
                      businessName={business?.name || "Business"}
                      joinUrl={joinUrl || "https://emflow.app/join/demo"}
                      accentColor={accentColor}
                      isDark={isDark}
                      language={standLanguage}
                      customInstruction={customInstruction}
                      showSteps={showSteps}
                    />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Hidden: Full-size render target for export ── */}
      <div
        style={{
          position: "absolute",
          left: "-9999px",
          top: "-9999px",
          overflow: "hidden",
        }}
        aria-hidden="true"
      >
        <div ref={standRef}>
          <QRStandPreview
            locationName={location?.name || "Location"}
            businessName={business?.name || "Business"}
            joinUrl={joinUrl || "https://emflow.app/join/demo"}
            accentColor={accentColor}
            isDark={isDark}
            language={standLanguage}
            customInstruction={customInstruction}
            showSteps={showSteps}
          />
        </div>
      </div>
    </div>
  );
}

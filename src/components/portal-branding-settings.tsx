import * as React from "react";
import {
  Building2,
  Image as ImageIcon,
  Loader2,
  Palette,
  Save,
  Type,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BRAND_FONT_CSS,
  BRAND_FONT_OPTIONS,
  DEFAULT_PORTAL_BRANDING,
  ensureGoogleFontLoaded,
  isValidHexColor,
  normalizeHexColor,
  resolveEffectiveLogoSrc,
  sanitizeSvgMarkup,
} from "@/lib/branding";
import { MAX_IMAGE_INPUT_BYTES, validateAndNormalizeImage } from "@/lib/security";
import { useApp } from "@/lib/store";
import type { BrandFontFamily } from "@/lib/types";
import { cn } from "@/lib/utils";

async function processLogoFile(file: File): Promise<string> {
  if (file.size <= 0 || file.size > MAX_IMAGE_INPUT_BYTES) {
    throw new Error("Logo must be between 1 byte and 2 MB.");
  }

  const lowerName = file.name.toLowerCase();
  if (file.type === "image/svg+xml" || lowerName.endsWith(".svg")) {
    const rawSvg = await file.text();
    const cleaned = sanitizeSvgMarkup(rawSvg);
    const bytes = new TextEncoder().encode(cleaned);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]!);
    }
    const encoded = `data:image/svg+xml;base64,${btoa(binary)}`;
    if (encoded.length > 700_000) {
      throw new Error("SVG logo is too large after processing. Please use a simpler file.");
    }
    return encoded;
  }

  return validateAndNormalizeImage(file, { maxDim: 640, squareCrop: false, quality: 0.92 });
}

export function PortalBrandingSettings() {
  const { branding, savePortalBranding, log } = useApp();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [logoUrl, setLogoUrl] = React.useState<string | null>(branding.logoUrl);
  const [organisationName, setOrganisationName] = React.useState(branding.organisationName);
  const [tagline, setTagline] = React.useState(branding.tagline);
  const [primaryColor, setPrimaryColor] = React.useState(branding.primaryColor);
  const [accentColor, setAccentColor] = React.useState(branding.accentColor);
  const [fontFamily, setFontFamily] = React.useState<BrandFontFamily>(branding.fontFamily);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setLogoUrl(branding.logoUrl);
    setOrganisationName(branding.organisationName);
    setTagline(branding.tagline);
    setPrimaryColor(branding.primaryColor);
    setAccentColor(branding.accentColor);
    setFontFamily(branding.fontFamily);
  }, [branding]);

  React.useEffect(() => {
    for (const font of BRAND_FONT_OPTIONS) {
      ensureGoogleFontLoaded(font);
    }
  }, []);

  const effectiveLogoSrc = resolveEffectiveLogoSrc(logoUrl);
  const previewPrimary = normalizeHexColor(primaryColor, DEFAULT_PORTAL_BRANDING.primaryColor);
  const previewAccent = normalizeHexColor(accentColor, DEFAULT_PORTAL_BRANDING.accentColor);

  async function handleLogoUpload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const processed = await processLogoFile(file);
      setLogoUrl(processed);
      toast.success("Logo ready — click Save Branding to apply.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not process logo file.");
    } finally {
      setBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = organisationName.trim();
    if (!cleanName) {
      toast.error("Organisation Name is required.");
      return;
    }
    if (!isValidHexColor(primaryColor)) {
      toast.error("Primary Colour must be a valid 6-digit hex code (e.g. #520380).");
      return;
    }
    if (!isValidHexColor(accentColor)) {
      toast.error("Accent Colour must be a valid 6-digit hex code (e.g. #0ea5e9).");
      return;
    }

    setBusy(true);
    const res = await savePortalBranding({
      logoUrl,
      organisationName: cleanName,
      tagline: tagline.trim(),
      primaryColor: normalizeHexColor(primaryColor, DEFAULT_PORTAL_BRANDING.primaryColor),
      accentColor: normalizeHexColor(accentColor, DEFAULT_PORTAL_BRANDING.accentColor),
      fontFamily,
    });
    setBusy(false);

    if (!res.ok) {
      toast.error(res.error ?? "Could not save portal branding.");
      return;
    }
    log("portal_branding_updated", `Updated branding for ${cleanName}`);
    toast.success("Portal branding saved and applied.");
  }

  return (
    <form className="max-w-3xl space-y-5" onSubmit={handleSubmit}>
      {/* 1. Organisation Logo */}
      <Card className="rounded-2xl border-border">
        <CardContent className="space-y-4 p-6">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <ImageIcon className="h-4 w-4 text-primary" />
              Organisation Logo
            </h3>
            <p className="text-xs text-muted-foreground">
              Displayed on the portal header, sign-in screen, and shared pages. PNG, JPG, SVG or
              WebP — max 2 MB.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-5">
            <div className="flex h-[76px] w-[156px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-white p-2.5">
              {effectiveLogoSrc ? (
                <img
                  src={effectiveLogoSrc}
                  alt={organisationName || "Organisation logo"}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-xs font-medium text-muted-foreground">No logo</span>
              )}
            </div>

            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => void handleLogoUpload(e.target.files?.[0])}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-1.5"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload Logo
                </Button>
                {logoUrl === "" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setLogoUrl(null)}
                    className="text-xs font-medium text-primary hover:underline cursor-pointer"
                  >
                    Restore default logo
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setLogoUrl("")}
                    className="inline-flex items-center gap-1 text-xs font-medium text-destructive hover:underline cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                    Remove logo
                  </button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Recommended: transparent background, at least 200 × 60 px
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. Organisation Identity */}
      <Card className="rounded-2xl border-border">
        <CardContent className="space-y-4 p-6">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Building2 className="h-4 w-4 text-primary" />
              Organisation Identity
            </h3>
            <p className="text-xs text-muted-foreground">
              Shown in the portal header, sign-in screen, and shared pages.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="brand-org-name">
                Organisation Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="brand-org-name"
                value={organisationName}
                onChange={(e) => setOrganisationName(e.target.value)}
                placeholder="South Australian College of English"
                maxLength={120}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="brand-tagline">Tagline</Label>
              <Input
                id="brand-tagline"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="The Australian Experience of a Lifetime"
                maxLength={180}
              />
              <p className="text-[11px] text-muted-foreground">
                Optional short descriptor displayed under the logo
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. Brand Colours */}
      <Card className="rounded-2xl border-border">
        <CardContent className="space-y-5 p-6">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Palette className="h-4 w-4 text-primary" />
              Brand Colours
            </h3>
            <p className="text-xs text-muted-foreground">
              Used for buttons, links, and highlights across the portal.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="brand-primary-hex" className="text-xs font-medium">
                Primary Colour
              </Label>
              <div className="flex items-center gap-2.5">
                <input
                  type="color"
                  aria-label="Primary Colour Picker"
                  value={previewPrimary}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-border bg-background p-0.5"
                />
                <Input
                  id="brand-primary-hex"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  placeholder="#520380"
                  maxLength={7}
                  className="w-36 font-mono text-sm"
                />
                <span
                  className="h-7 w-7 shrink-0 rounded-lg border border-black/10"
                  style={{ backgroundColor: previewPrimary }}
                  aria-hidden
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="brand-accent-hex" className="text-xs font-medium">
                Accent Colour
              </Label>
              <div className="flex items-center gap-2.5">
                <input
                  type="color"
                  aria-label="Accent Colour Picker"
                  value={previewAccent}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-border bg-background p-0.5"
                />
                <Input
                  id="brand-accent-hex"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  placeholder="#0ea5e9"
                  maxLength={7}
                  className="w-36 font-mono text-sm"
                />
                <span
                  className="h-7 w-7 shrink-0 rounded-lg border border-black/10"
                  style={{ backgroundColor: previewAccent }}
                  aria-hidden
                />
              </div>
            </div>
          </div>

          <div className="space-y-2.5 border-t border-border pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Preview
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="rounded-lg px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-opacity hover:opacity-90"
                style={{ backgroundColor: previewPrimary }}
              >
                Primary Button
              </button>
              <button
                type="button"
                className="rounded-lg border-2 bg-transparent px-3.5 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ borderColor: previewPrimary, color: previewPrimary }}
              >
                Outline Button
              </button>
              <span
                className="text-xs font-semibold cursor-pointer hover:underline"
                style={{ color: previewAccent }}
              >
                Accent link
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: previewPrimary }}
                />
                Primary
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: previewAccent }} />
                Accent
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 4. Font Family */}
      <Card className="rounded-2xl border-border">
        <CardContent className="space-y-4 p-6">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Type className="h-4 w-4 text-primary" />
              Font Family
            </h3>
            <p className="text-xs text-muted-foreground">
              Applied across the portal workspace and sign-in experience.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {BRAND_FONT_OPTIONS.map((font) => {
              const selected = fontFamily === font;
              return (
                <button
                  key={font}
                  type="button"
                  onClick={() => setFontFamily(font)}
                  style={{ fontFamily: BRAND_FONT_CSS[font] }}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-center text-sm transition-all cursor-pointer",
                    selected
                      ? "border-2 border-primary bg-primary/5 font-semibold text-foreground shadow-xs"
                      : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                  )}
                >
                  {font}
                </button>
              );
            })}
          </div>

          <div className="rounded-xl border border-border/70 bg-muted/35 p-4 space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground">
              Preview in <span className="font-semibold text-foreground">{fontFamily}</span>
            </p>
            <p
              className="text-sm text-foreground"
              style={{ fontFamily: BRAND_FONT_CSS[fontFamily] }}
            >
              Welcome to {organisationName.trim() || "our portal"} — unified team operations and
              excellence.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3 pt-1">
        {branding.updatedAt ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            Last updated {new Date(branding.updatedAt).toLocaleString()}
          </p>
        ) : (
          <span />
        )}

        <Button
          type="submit"
          disabled={busy}
          className="gap-2 px-5 text-white shadow-sm"
          style={{ backgroundColor: previewPrimary }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {busy ? "Saving…" : "Save Branding"}
        </Button>
      </div>
    </form>
  );
}

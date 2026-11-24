import type { BrandFontFamily, PortalBrandingConfig } from "./types";

export const DEFAULT_BRAND_LOGO_PATH = "/assets/aistudio/SACE_Group_Logo_e04b9e3b.png";

export const BRAND_FONT_OPTIONS = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Poppins",
  "Lato",
  "Nunito",
  "Raleway",
  "Montserrat",
] as const;

export const BRAND_FONT_CSS: Record<BrandFontFamily, string> = {
  Inter: '"Inter", "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif',
  Roboto: '"Roboto", ui-sans-serif, system-ui, sans-serif',
  "Open Sans": '"Open Sans", ui-sans-serif, system-ui, sans-serif',
  Poppins: '"Poppins", ui-sans-serif, system-ui, sans-serif',
  Lato: '"Lato", ui-sans-serif, system-ui, sans-serif',
  Nunito: '"Nunito", ui-sans-serif, system-ui, sans-serif',
  Raleway: '"Raleway", ui-sans-serif, system-ui, sans-serif',
  Montserrat: '"Montserrat", ui-sans-serif, system-ui, sans-serif',
};

const BRAND_FONT_GOOGLE_URLS: Record<BrandFontFamily, string> = {
  Inter: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
  Roboto: "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap",
  "Open Sans":
    "https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&display=swap",
  Poppins: "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap",
  Lato: "https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&display=swap",
  Nunito: "https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap",
  Raleway: "https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700&display=swap",
  Montserrat:
    "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap",
};

export const DEFAULT_PORTAL_BRANDING: PortalBrandingConfig = {
  logoUrl: null,
  organisationName: "South Australian College of English",
  tagline: "The Australian Experience of a Lifetime",
  primaryColor: "#520380",
  accentColor: "#0ea5e9",
  fontFamily: "Inter",
};

export function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

export function normalizeHexColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  return isValidHexColor(trimmed) ? trimmed.toLowerCase() : fallback;
}

export function resolveEffectiveLogoSrc(logoUrl: string | null | undefined): string | null {
  if (logoUrl === "") return null;
  if (typeof logoUrl === "string" && logoUrl.trim().length > 0) {
    return logoUrl.trim();
  }
  return DEFAULT_BRAND_LOGO_PATH;
}

/**
 * Strip dangerous scriptable SVG elements/attributes before encoding as an SVG data URI.
 */
export function sanitizeSvgMarkup(rawSvg: string): string {
  const cleaned = rawSvg
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script[^>]*\/>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/<(iframe|object|embed|applet|meta|link|base)[\s\S]*?>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(iframe|object|embed|applet|meta|link|base)[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /\s(?:href|xlink:href)\s*=\s*(?:"\s*(?:javascript:|data:|https?:|\/\/)[^"]*"|'\s*(?:javascript:|data:|https?:|\/\/)[^']*')/gi,
      "",
    );

  if (!/<svg[\s>]/i.test(cleaned)) {
    throw new Error("Invalid SVG file: missing root <svg> element.");
  }
  return cleaned.trim();
}

export function ensureGoogleFontLoaded(font: BrandFontFamily): void {
  if (typeof document === "undefined") return;
  const href = BRAND_FONT_GOOGLE_URLS[font];
  if (!href) return;
  const id = `sace-font-${font.toLowerCase().replace(/\s+/g, "-")}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

export function applyPortalBrandingToDocument(branding: PortalBrandingConfig): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const primary = normalizeHexColor(branding.primaryColor, DEFAULT_PORTAL_BRANDING.primaryColor);
  const accent = normalizeHexColor(branding.accentColor, DEFAULT_PORTAL_BRANDING.accentColor);
  const fontFamily = BRAND_FONT_OPTIONS.includes(branding.fontFamily)
    ? branding.fontFamily
    : DEFAULT_PORTAL_BRANDING.fontFamily;

  ensureGoogleFontLoaded(fontFamily);

  // Only override CSS variables when customized or explicitly applying branding
  if (primary !== DEFAULT_PORTAL_BRANDING.primaryColor) {
    root.style.setProperty("--primary", primary);
    root.style.setProperty("--ring", primary);
    root.style.setProperty("--brand-purple", primary);
  } else {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--ring");
    root.style.removeProperty("--brand-purple");
  }

  root.style.setProperty("--brand-accent", accent);
  root.style.setProperty("--font-sans", BRAND_FONT_CSS[fontFamily]);
  document.body.style.fontFamily = BRAND_FONT_CSS[fontFamily];
}

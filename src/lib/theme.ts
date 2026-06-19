/**
 * THEME — shared design tokens (single source of truth for inline-styled
 * components). Mirrors the CSS tokens in app/globals.css; the /watch reskin is
 * the visual reference. Import this instead of re-declaring local palettes so
 * every surface looks like one product.
 */
export const THEME = {
  appBg: "#0E1117",
  surface: "#171B23",
  border: "rgba(255,255,255,0.08)",
  text: "#E6E8EC",
  text2: "#9BA1AD",
  text3: "#6B7280",
  teal: "#2DD4A7", // primary accent
  gold: "#E0A93B", // chips / values
  /** Action colours for logs/tags. */
  action: { fold: "#6B93D6", check: "#21B07A", call: "#21B07A", bet: "#E0913B", raise: "#E0913B" },
  /** Refined felt. */
  felt: { a: "#1E4A3C", b: "#163A2F", edge: "#2A5446" },
  /** Discreet position chips. */
  pos: { BTN: "#E0A93B", SB: "#2DD4A7", BB: "#2F86E0", UTG: "#6B7280", HJ: "#6B7280", CO: "#6B7280" } as Record<string, string>,
  /** 4-colour deck. */
  suits: {
    s: { glyph: "♠", color: "#1A1A1A", label: "pique" },
    h: { glyph: "♥", color: "#E23B3B", label: "cœur" },
    d: { glyph: "♦", color: "#2F86E0", label: "carreau" },
    c: { glyph: "♣", color: "#21B07A", label: "trèfle" },
  } as Record<string, { glyph: string; color: string; label: string }>,
  radius: 16,
} as const;

export type ThemeMode = "light";

/**
 * Semantic, platform-neutral design tokens. Consumers must refer to these
 * roles rather than embedding a brand colour in a feature screen.
 */
export const tokens = {
  theme: { mode: "light" as ThemeMode },
  color: {
    canvas: "#F5F7FA",
    surface: "#FFFFFF",
    surfaceMuted: "#EEF3F7",
    surfaceElevated: "#FFFFFF",
    textPrimary: "#13202B",
    textSecondary: "#526170",
    textDisabled: "#82909D",
    borderDefault: "#D8E0E8",
    borderStrong: "#AAB8C5",
    actionPrimary: "#163A5F",
    actionPrimaryHover: "#0F2D4A",
    actionSecondary: "#E7EEF5",
    actionSecondaryHover: "#D7E3EE",
    accent: "#0F766E",
    focus: "#2563EB",
    info: "#1D4ED8",
    success: "#166534",
    warning: "#A15C00",
    danger: "#B42318",
    onDark: "#FFFFFF",
    onLight: "#13202B",
    chart: ["#163A5F", "#0F766E", "#2563EB", "#A15C00", "#9F2B6D", "#526170"],
  },
  typography: {
    family: {
      sans: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    },
    size: { xs: 12, sm: 14, md: 16, lg: 20, xl: 28, "2xl": 36 },
    lineHeight: { tight: 1.2, normal: 1.5, relaxed: 1.65 },
    weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
  },
  space: { "0": 0, "1": 4, "2": 8, "3": 12, "4": 16, "5": 20, "6": 24, "8": 32, "10": 40, "12": 48 },
  radius: { sm: 6, md: 10, lg: 16, xl: 24, pill: 999 },
  shadow: {
    sm: "0 1px 2px rgba(15, 38, 61, 0.08)",
    md: "0 8px 24px rgba(15, 38, 61, 0.12)",
    lg: "0 20px 48px rgba(15, 38, 61, 0.16)",
  },
  border: { thin: 1, thick: 2 },
  zIndex: { base: 0, sticky: 20, dropdown: 40, modal: 60, toast: 80 },
  motion: { fast: 120, normal: 180, slow: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  breakpoint: { mobile: 0, tablet: 768, desktop: 1200 },
  container: { content: 1280, reading: 760, wide: 1600 },
  density: { standard: 1, compact: 0.875 },
  touchTarget: { minimum: 44 },
} as const;

export type NailsoftTokens = typeof tokens;
export type SemanticColor = keyof typeof tokens.color;

/** CSS variables consumed by the Web shell. Native consumers use `tokens` directly. */
export const cssVariables = Object.entries(tokens.color).flatMap(([key, value]) =>
  typeof value === "string" ? [[`--ns-color-${kebab(key)}`, value] as const] : [],
);

function kebab(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

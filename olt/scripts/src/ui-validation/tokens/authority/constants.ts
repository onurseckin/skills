import { HarnessError } from "../../../core/errors/index.ts";

/**
 * ============================================================================
 * 1. Design System Token Sovereign Constants & Specifications
 * ============================================================================
 */

/**
 * Canonical Spacing Scale (in pixels)
 */
export const SPACING_TOKENS = {
  none: 0,
  "3xs": 2,
  "2xs": 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  "2xl": 48,
  "3xl": 64,
  "4xl": 96,
  "5xl": 128,
} as const;

export type SpacingTokenName = keyof typeof SPACING_TOKENS;
export type SpacingTokenValue = (typeof SPACING_TOKENS)[SpacingTokenName];
export const VALID_SPACING_VALUES: readonly number[] = Object.values(SPACING_TOKENS);

/**
 * Canonical Typography Tokens
 */
export const TYPOGRAPHY_TOKENS = {
  fontFamilies: {
    sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    serif: '"Playfair Display", Georgia, "Times New Roman", serif',
    mono: '"JetBrains Mono", "Fira Code", Menlo, Monaco, Consolas, monospace',
  },
  fontSizes: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    "2xl": 24,
    "3xl": 30,
    "4xl": 36,
    "5xl": 48,
  },
  fontWeights: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeights: {
    none: 1.0,
    tight: 1.25,
    snug: 1.375,
    normal: 1.5,
    relaxed: 1.625,
    loose: 2.0,
  },
  letterSpacings: {
    tighter: "-0.05em",
    tight: "-0.025em",
    normal: "0em",
    wide: "0.025em",
    wider: "0.05em",
  },
} as const;

export type FontFamilyToken = keyof typeof TYPOGRAPHY_TOKENS.fontFamilies;
export type FontSizeToken = keyof typeof TYPOGRAPHY_TOKENS.fontSizes;
export type FontWeightToken = keyof typeof TYPOGRAPHY_TOKENS.fontWeights;
export type LineHeightToken = keyof typeof TYPOGRAPHY_TOKENS.lineHeights;
export type LetterSpacingToken = keyof typeof TYPOGRAPHY_TOKENS.letterSpacings;

export const VALID_FONT_SIZES: readonly number[] = Object.values(TYPOGRAPHY_TOKENS.fontSizes);
export const VALID_FONT_WEIGHTS: readonly number[] = Object.values(TYPOGRAPHY_TOKENS.fontWeights);
export const VALID_LINE_HEIGHTS: readonly number[] = Object.values(TYPOGRAPHY_TOKENS.lineHeights);

/**
 * Canonical Color Palettes across Themes
 */
export type ThemeMode = "light" | "dark" | "high-contrast";

export interface ColorRoleTokens {
  readonly primary: string;
  readonly secondary: string;
  readonly accent: string;
  readonly neutral: string;
  readonly success: string;
  readonly warning: string;
  readonly error: string;
  readonly info: string;
  readonly background: string;
  readonly surface: string;
  readonly surfaceElevated: string;
  readonly border: string;
  readonly borderSubtle: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly ring: string;
  readonly interactive: string;
  readonly interactiveHover: string;
}

export const COLOR_PALETTES: Record<ThemeMode, ColorRoleTokens> = {
  light: {
    primary: "#2563eb",
    secondary: "#4f46e5",
    accent: "#06b6d4",
    neutral: "#64748b",
    success: "#16a34a",
    warning: "#d97706",
    error: "#dc2626",
    info: "#0284c7",
    background: "#ffffff",
    surface: "#f8fafc",
    surfaceElevated: "#ffffff",
    border: "#e2e8f0",
    borderSubtle: "#f1f5f9",
    textPrimary: "#0f172a",
    textSecondary: "#475569",
    textMuted: "#94a3b8",
    ring: "#3b82f6",
    interactive: "#2563eb",
    interactiveHover: "#1d4ed8",
  },
  dark: {
    primary: "#3b82f6",
    secondary: "#6366f1",
    accent: "#22d3ee",
    neutral: "#94a3b8",
    success: "#22c55e",
    warning: "#f59e0b",
    error: "#ef4444",
    info: "#38bdf8",
    background: "#0b0f19",
    surface: "#111827",
    surfaceElevated: "#1f2937",
    border: "#374151",
    borderSubtle: "#1f2937",
    textPrimary: "#f9fafb",
    textSecondary: "#cbd5e1",
    textMuted: "#64748b",
    ring: "#60a5fa",
    interactive: "#3b82f6",
    interactiveHover: "#60a5fa",
  },
  "high-contrast": {
    primary: "#0000ee",
    secondary: "#551a8b",
    accent: "#0066cc",
    neutral: "#000000",
    success: "#006600",
    warning: "#804000",
    error: "#cc0000",
    info: "#004080",
    background: "#ffffff",
    surface: "#ffffff",
    surfaceElevated: "#ffffff",
    border: "#000000",
    borderSubtle: "#000000",
    textPrimary: "#000000",
    textSecondary: "#000000",
    textMuted: "#333333",
    ring: "#000000",
    interactive: "#0000ee",
    interactiveHover: "#000099",
  },
} as const;

export type ColorRole = keyof ColorRoleTokens;

/**
 * Shadow Elevations
 */
export const SHADOW_ELEVATIONS = {
  none: "none",
  xs: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
  sm: "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)",
  md: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
  lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
  xl: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
  "2xl": "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
  inner: "inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)",
} as const;

export type ShadowElevationToken = keyof typeof SHADOW_ELEVATIONS;

/**
 * Border Radii (in pixels)
 */
export const BORDER_RADII = {
  none: 0,
  xs: 2,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  "2xl": 24,
  full: 9999,
} as const;

export type BorderRadiiToken = keyof typeof BORDER_RADII;
export const VALID_BORDER_RADII_VALUES: readonly number[] = Object.values(BORDER_RADII);

/**
 * Transition Tokens
 */
export const TRANSITION_TOKENS = {
  durations: {
    instant: 0,
    fast: 150,
    normal: 250,
    slow: 400,
    deliberate: 700,
  },
  easings: {
    linear: "linear",
    easeIn: "cubic-bezier(0.4, 0, 1, 1)",
    easeOut: "cubic-bezier(0, 0, 0.2, 1)",
    easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)",
    spring: "cubic-bezier(0.175, 0.885, 0.32, 1.275)",
  },
} as const;

export type TransitionDurationToken = keyof typeof TRANSITION_TOKENS.durations;
export type TransitionEasingToken = keyof typeof TRANSITION_TOKENS.easings;
export const VALID_TRANSITION_DURATIONS: readonly number[] = Object.values(
  TRANSITION_TOKENS.durations,
);

/**
 * ============================================================================
 * 2. Zero Raw Value Policy & AST / Style Inspector
 * ============================================================================
 */


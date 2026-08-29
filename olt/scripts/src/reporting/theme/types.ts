/**
 * @file types.ts
 * Multi-Theme Contrast Matrix & Dynamic Color Scheme Visual Reporting Types
 */

export const THEME_MODES = ["light", "dark", "high-contrast-light", "high-contrast-dark"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

export const CONTRAST_STANDARDS = ["wcag-aa", "wcag-aaa", "apca"] as const;

export type ContrastStandard = (typeof CONTRAST_STANDARDS)[number];

export interface RgbaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface ElementThemePair {
  readonly selector: string;
  readonly theme: ThemeMode;
  readonly foregroundColor: string;
  readonly backgroundColor: string;
  readonly element?: string | undefined;
  readonly id?: string | undefined;
  readonly fontSize?: number | undefined;
  readonly fontWeight?: number | string | undefined;
  readonly isLargeText?: boolean | undefined;
  readonly component?: string | undefined;
}

export interface ContrastEvaluation {
  readonly standard: ContrastStandard;
  readonly contrastRatio: number;
  readonly requiredThreshold: number;
  readonly passed: boolean;
  readonly score?: number | undefined;
  readonly note?: string | undefined;
}

export interface ThemeContrastElementResult {
  readonly foregroundColor: string;
  readonly backgroundColor: string;
  readonly effectiveForeground: RgbaColor;
  readonly effectiveBackground: RgbaColor;
  readonly wcagRatio: number;
  readonly apcaLc: number;
  readonly evaluations: readonly ContrastEvaluation[];
  readonly passed: boolean;
}

export interface ThemeContrastMatrix {
  readonly selector: string;
  readonly element?: string | undefined;
  readonly themes: Partial<Record<ThemeMode, ThemeContrastElementResult>>;
  readonly overallPassed: boolean;
  readonly isLargeText: boolean;
}

export type RegressionSeverity = "critical" | "serious" | "moderate" | "minor";

export interface ThemeRegressionFinding {
  readonly id: string;
  readonly selector: string;
  readonly theme: ThemeMode;
  readonly standard: ContrastStandard;
  readonly severity: RegressionSeverity;
  readonly message: string;
  readonly foregroundColor: string;
  readonly backgroundColor: string;
  readonly contrastRatio: number;
  readonly requiredThreshold: number;
  readonly details?: string | undefined;
}

export interface MultiThemeComparisonReport {
  readonly timestamp: string;
  readonly totalElements: number;
  readonly evaluatedThemes: readonly ThemeMode[];
  readonly evaluatedStandards: readonly ContrastStandard[];
  readonly matrices: readonly ThemeContrastMatrix[];
  readonly findings: readonly ThemeRegressionFinding[];
  readonly summary: {
    readonly totalChecks: number;
    readonly passedChecks: number;
    readonly failedChecks: number;
    readonly passRate: number;
    readonly themePassRates: Partial<Record<ThemeMode, number>>;
  };
  readonly overallPassed: boolean;
}

import { HarnessError } from "../../core/errors/index.ts";

export type ThemeMode = "light" | "dark" | "high-contrast";

export interface ContrastAuditTarget {
  readonly elementId: string;
  readonly role?: string;
  readonly foregroundColor: string;
  readonly backgroundColor: string;
  readonly isLargeText?: boolean;
  readonly fontSizePx?: number;
  readonly isBold?: boolean;
}

export interface ContrastAuditResult {
  readonly elementId: string;
  readonly role?: string;
  readonly foregroundColor: string;
  readonly backgroundColor: string;
  readonly wcagRatio: number;
  readonly apcaLc: number;
  readonly wcagAaPassed: boolean;
  readonly wcagAaaPassed: boolean;
  readonly apcaPassed: boolean;
}

export interface SurfaceContrastReport {
  readonly permutationId?: string;
  readonly auditedElementsCount?: number;
  readonly totalAudited?: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly allPassed: boolean;
  readonly results: readonly ContrastAuditResult[];
}

export interface DarkDepthInput {
  readonly backgroundHex: string;
  readonly surfaceHex: string;
  readonly elevatedHex: string;
  readonly overlayHex?: string;
}

export interface DarkDepthReport {
  readonly monotonicProgression: boolean;
  readonly backgroundLuminance: number;
  readonly surfaceLuminance: number;
  readonly elevatedLuminance: number;
  readonly overlayLuminance?: number;
  readonly issues: readonly string[];
}

export interface HighContrastBoundaryInput {
  readonly borderStyle: string;
  readonly borderWidthPx: number;
  readonly borderColor: string;
  readonly backgroundColor: string;
}

export interface HighContrastBoundaryReport {
  readonly boundarySharp: boolean;
  readonly contrastRatio: number;
  readonly issues: readonly string[];
}

/**
 * ============================================================================
 * 1. 12-Permutation Surface Grid Architecture
 * ============================================================================
 */

export const PERMUTATION_THEMES: readonly ThemeMode[] = ["light", "dark", "high-contrast"] as const;

export type ViewportProfileName =
  | "ultra-wide"
  | "standard-desktop"
  | "tablet-portrait"
  | "mobile-portrait";

export interface ViewportDimension {
  readonly name: ViewportProfileName;
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: string;
  readonly description: string;
}

export const VIEWPORT_DIMENSIONS: Record<ViewportProfileName, ViewportDimension> = {
  "ultra-wide": {
    name: "ultra-wide",
    width: 1920,
    height: 1080,
    aspectRatio: "16:9",
    description: "Ultra-Wide Desktop for broad dashboards, dual sidebars, and wide data grids",
  },
  "standard-desktop": {
    name: "standard-desktop",
    width: 1440,
    height: 900,
    aspectRatio: "16:10",
    description: "Standard Laptop/Desktop for primary workflows, navigation, and modal flows",
  },
  "tablet-portrait": {
    name: "tablet-portrait",
    width: 768,
    height: 1024,
    aspectRatio: "3:4",
    description: "Tablet Portrait for responsive reflow, drawer transitions, and 2-column layouts",
  },
  "mobile-portrait": {
    name: "mobile-portrait",
    width: 390,
    height: 844,
    aspectRatio: "9:19.5",
    description: "Mobile Portrait for vertical stacks, touch targets, and sticky bottom bars",
  },
};

export interface PermutationSurface {
  readonly permutationId: string;
  readonly theme: ThemeMode;
  readonly viewport: ViewportProfileName;
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: string;
  readonly description: string;
}

/**
 * The Canonical 12-Permutation Surface Grid
 * 3 Themes (light, dark, high-contrast) x 4 Viewports = 12 Permutations
 */
export const THEME_PERMUTATION_GRID: readonly PermutationSurface[] = PERMUTATION_THEMES.flatMap(
  (theme) =>
    (Object.keys(VIEWPORT_DIMENSIONS) as ViewportProfileName[]).map((vpName) => {
      const vp = VIEWPORT_DIMENSIONS[vpName];
      return {
        permutationId: `${theme}_${vpName}`,
        theme,
        viewport: vpName,
        width: vp.width,
        height: vp.height,
        aspectRatio: vp.aspectRatio,
        description: `${theme.toUpperCase()} theme on ${vp.name} (${vp.width}x${vp.height})`,
      };
    }),
);

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a?: number;
}

/**
 * Parse hex string (#fff, #ffffff, #ffffff80) or rgb/rgba string into RGB values [0..255]
 */

export interface PermutationInspectionState {
  readonly permutationId: string;
  readonly surfaceSeparationPassed: boolean;
  readonly borderSubtletyPassed: boolean;
  readonly iconClarityPassed: boolean;
  readonly readabilityPassed: boolean;
  readonly findings: readonly string[];
}

export interface ThematicGateReport {
  readonly gateRound: 4;
  readonly gateStatus: "APPROVED" | "BLOCKED";
  readonly totalPermutations: number;
  readonly passedPermutationsCount: number;
  readonly failedPermutationsCount: number;
  readonly permutationStates: readonly PermutationInspectionState[];
  readonly blockingIssues: readonly string[];
  readonly generatedAt: string;
}

export interface ThemeFlashDetectionInput {
  readonly initialHtmlBg: string;
  readonly loadedThemeBg: string;
  readonly hasInlineThemeScript: boolean;
  readonly transitionDurationMs: number;
}

export interface ThemeFlashReport {
  readonly flashRiskDetected: boolean;
  readonly riskLevel: "none" | "low" | "high";
  readonly deltaLuminance: number;
  readonly recommendations: readonly string[];
}

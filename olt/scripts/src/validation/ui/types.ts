export type UiViewportTier = "mobile" | "tablet" | "desktop" | "desktop-wide";

export interface UiViewportSpec {
  readonly name: UiViewportTier;
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
  readonly description: string;
}

export interface TouchTargetInspection {
  readonly selector: string;
  readonly width: number;
  readonly height: number;
  readonly passed: boolean;
  readonly minRequired: number;
  readonly message?: string | undefined;
}

export interface OverflowInspection {
  readonly selector: string;
  readonly viewport: UiViewportTier;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly overflowX: number;
  readonly hasOverflow: boolean;
  readonly message?: string | undefined;
}

export interface PlaywrightJourneyResult {
  readonly name: string;
  readonly viewport: UiViewportTier;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly screenshotPath?: string | undefined;
  readonly screenshotSizeBytes?: number | undefined;
  readonly error?: string | undefined;
}

export interface BrowserLifecycleInvariants {
  readonly fontsReady?: boolean | undefined;
  readonly networkIdle?: boolean | undefined;
  readonly layoutQuiet?: boolean | undefined;
  readonly freshContextPerViewport?: boolean | undefined;
  readonly hydrationComplete?: boolean | undefined;
}

export interface ScreenshotInspectionInput {
  readonly name: string;
  readonly path: string;
  readonly viewport?: string | undefined;
  readonly sizeBytes: number;
  readonly entropyScore?: number | undefined;
  readonly isBlank?: boolean | undefined;
}

export interface UiMechanicInspectionInput {
  readonly taskId?: string | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly viewports?: readonly UiViewportTier[] | undefined;
  readonly requireAllViewports?: boolean | undefined;
  readonly lifecycleInvariants?: BrowserLifecycleInvariants | undefined;
  readonly minTouchDimension?: number | undefined;
  readonly touchTargets?:
    | readonly {
        selector: string;
        width: number;
        height: number;
        isInteractive?: boolean | undefined;
      }[]
    | undefined;
  readonly overflowElements?:
    | readonly {
        selector: string;
        viewport?: string | undefined;
        scrollWidth: number;
        clientWidth: number;
        overflowX?: number | undefined;
        deviceScaleFactor?: number | undefined;
      }[]
    | undefined;
  readonly journeys?: readonly PlaywrightJourneyResult[] | undefined;
  readonly screenshots?: readonly ScreenshotInspectionInput[] | undefined;
}

export interface UiMechanicReport {
  readonly passed: boolean;
  readonly viewportsCovered: readonly UiViewportTier[];
  readonly missingViewports: readonly UiViewportTier[];
  readonly touchTargetEvaluations: readonly TouchTargetInspection[];
  readonly touchTargetFailures: readonly TouchTargetInspection[];
  readonly overflowEvaluations: readonly OverflowInspection[];
  readonly overflowViolations: readonly OverflowInspection[];
  readonly journeyResults: readonly PlaywrightJourneyResult[];
  readonly validScreenshotsCount: number;
  readonly lifecycleViolations: readonly string[];
  readonly totalDefects: number;
  readonly summary: string;
}

export interface ContainerHierarchyEvaluation {
  readonly container: string;
  readonly passed: boolean;
  readonly issues: readonly string[];
}

export interface OpticalHierarchyInspection {
  readonly score: number;
  readonly passed: boolean;
  readonly headingScaleRatio: number;
  readonly visualWeightBalanced: boolean;
  readonly containerEvaluations?: readonly ContainerHierarchyEvaluation[] | undefined;
  readonly notes: string;
  readonly issues: readonly string[];
}

export interface DescenderInspection {
  readonly passed: boolean;
  readonly clippedElements: readonly string[];
  readonly elementsInspected: number;
  readonly descenderCharactersChecked: readonly string[];
  readonly notes: string;
  readonly issues: readonly string[];
}

export interface AestheticHarmonyInspection {
  readonly score: number;
  readonly passed: boolean;
  readonly spacingRhythmGrid: number;
  readonly spacingRhythmValid: boolean;
  readonly colorPaletteBalance: string;
  readonly themeHarmony: "light" | "dark" | "adaptive" | "inconsistent";
  readonly notes: string;
  readonly issues: readonly string[];
}

export interface HierarchyElementInput {
  readonly selector: string;
  readonly tag: string;
  readonly fontSize: number;
  readonly fontWeight: number | string;
  readonly containerSelector?: string | undefined;
  readonly letterSpacing?: number | undefined;
  readonly lineHeight?: number | undefined;
}

export interface UiCognitiveInspectionInput {
  readonly taskId?: string | undefined;
  readonly critique?: string | undefined;
  readonly textElements?:
    | readonly {
        selector: string;
        text: string;
        fontSize: number;
        lineHeight: number;
        paddingBottom: number;
        overflowClipped?: boolean | undefined;
      }[]
    | undefined;
  readonly hierarchyElements?: readonly HierarchyElementInput[] | undefined;
  readonly spacingElements?:
    | readonly {
        selector: string;
        margin: number;
        padding: number;
      }[]
    | undefined;
  readonly screenshotsReviewed?: readonly string[] | undefined;
  readonly attemptedShellCommands?: readonly string[] | undefined;
  readonly canExecuteShell?: boolean | undefined;
}

export interface UiCognitiveReport {
  readonly passed: boolean;
  readonly canExecuteShell: false;
  readonly opticalHierarchy: OpticalHierarchyInspection;
  readonly descenderIntegrity: DescenderInspection;
  readonly aestheticHarmony: AestheticHarmonyInspection;
  readonly socraticCritique: string;
  readonly shellHardlockViolations: readonly string[];
  readonly isSuperficial: boolean;
  readonly totalDefects: number;
  readonly summary: string;
}

export interface DualUiAuditResult {
  readonly isUiTask: boolean;
  readonly passed: boolean;
  readonly mode:
    | "dual_ui_corroborated"
    | "mechanic_only"
    | "cognitive_only"
    | "non_ui_skipped"
    | "rejected";
  readonly mechanicReport: UiMechanicReport;
  readonly cognitiveReport: UiCognitiveReport;
  readonly defects: readonly {
    id: string;
    pillar: "mechanical" | "cognitive";
    category: string;
    message: string;
    severity: "critical" | "important" | "minor";
    remediation: string;
  }[];
  readonly summary: string;
}

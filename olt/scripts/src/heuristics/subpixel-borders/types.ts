import type { ElementPhysicsSnapshot } from "../../capture/validator/types.ts";

export const CANONICAL_FRACTIONAL_DPR_SCALES: readonly number[] = [
  1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 3.0,
];

export interface SubpixelBorderWidths {
  readonly top?: number | undefined;
  readonly right?: number | undefined;
  readonly bottom?: number | undefined;
  readonly left?: number | undefined;
}

export interface SubpixelElementBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SubpixelElementInput {
  readonly selector: string;
  readonly bounds: SubpixelElementBounds;
  readonly borderWidth?: SubpixelBorderWidths | number | undefined;
  readonly transform?: string | undefined;
  readonly dpr?: number | undefined;
  readonly devicePixelRatio?: number | undefined;
  readonly dprScales?: readonly number[] | undefined;
}

export interface SubpixelBorderDefect {
  readonly id: string;
  readonly category:
    | "subpixel-hairline-blur"
    | "subpixel-asymmetric-borders"
    | "subpixel-transform-smear"
    | "subpixel-coordinate-jitter";
  readonly severity: "critical" | "serious" | "moderate" | "minor";
  readonly elementSelector: string;
  readonly message: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>> | undefined;
}

export interface DprEvaluation {
  readonly dpr: number;
  readonly isAligned: boolean;
  readonly maxRoundingError: number;
  readonly physicalBorderWidths: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly physicalBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly artifacts: readonly string[];
}

export interface SubpixelBorderAnalysisResult {
  readonly isCompliant: boolean;
  readonly evaluatedDprs: readonly number[];
  readonly dprEvaluations: readonly DprEvaluation[];
  readonly worstCaseDpr: number;
  readonly maxRoundingErrorAcrossDprs: number;
  readonly defects: readonly SubpixelBorderDefect[];
  readonly remediations: readonly string[];
}

export interface AntiAliasingEdgeContrastResult {
  readonly dpr: number;
  readonly physicalWidth: number;
  readonly fractionalCoverage: number;
  readonly isCrisp: boolean;
  readonly edgeContrastFactor: number;
  readonly roundingError: number;
  readonly defect?: SubpixelBorderDefect | undefined;
}

export interface SubpixelDriftEvaluation {
  readonly dpr: number;
  readonly physicalWidth: number;
  readonly isCrisp: boolean;
  readonly roundingError: number;
  readonly isAntiAliasedBlur: boolean;
  readonly edgeContrastFactor: number;
  readonly snappedCssWidth: number;
}

export interface SubpixelDriftResult {
  readonly cssWidth: number;
  readonly isCrispOnAllDprs: boolean;
  readonly crispDprs: readonly number[];
  readonly blurredDprs: readonly number[];
  readonly evaluations: readonly SubpixelDriftEvaluation[];
  readonly worstCaseRoundingError: number;
  readonly worstCaseDpr: number;
  readonly recommendedCssWidth: number;
  readonly defects: readonly SubpixelBorderDefect[];
}

export interface EdgeContrastEvaluation {
  readonly cssWidth: number;
  readonly dpr: number;
  readonly physicalWidth: number;
  readonly roundingError: number;
  readonly nominalContrastRatio: number;
  readonly effectiveContrastRatio: number;
  readonly contrastDegradationPct: number;
  readonly isCrisp: boolean;
  readonly passesContrastThreshold: boolean;
}

export interface SubpixelValidationOptions {
  readonly dpr?: number | undefined;
  readonly devicePixelRatio?: number | undefined;
  readonly dprScales?: readonly number[] | undefined;
}

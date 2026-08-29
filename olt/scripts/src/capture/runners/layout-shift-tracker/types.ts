import type { AABB, ExtractedComputedStyles } from "../types.ts";

export interface UnstableElementDisplacement {
  readonly selector: string;
  readonly tagName: string;
  readonly id?: string | undefined;
  readonly previousRect: AABB;
  readonly currentRect: AABB;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaWidth: number;
  readonly deltaHeight: number;
  readonly maxDisplacement: number;
  readonly horizontalDisplacement: number;
  readonly verticalDisplacement: number;
  readonly isRootCause: boolean;
  readonly rootCauseReason?: string | undefined;
  readonly isExcluded: boolean;
  readonly exclusionReason?:
    | "fixed_or_sticky"
    | "transform_only"
    | "opacity_only"
    | "out_of_bounds"
    | "zero_viewport"
    | "nested_child_of_shifting_container"
    | "user_input_recent"
    | undefined;
  readonly previousStyles?: ExtractedComputedStyles | undefined;
  readonly currentStyles?: ExtractedComputedStyles | undefined;
}

export interface LayoutShiftEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly impactFraction: number;
  readonly distanceFraction: number;
  readonly score: number;
  readonly hadRecentInput: boolean;
  readonly sources: readonly UnstableElementDisplacement[];
  readonly rootCauses: readonly UnstableElementDisplacement[];
  readonly viewport: { readonly width: number; readonly height: number };
  readonly isValidShift: boolean;
}

export interface LayoutShiftWindow {
  readonly windowIndex: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly duration: number;
  readonly entries: readonly LayoutShiftEntry[];
  readonly windowScore: number;
  readonly isMaxWindow: boolean;
}

export interface CumulativeLayoutShiftReport {
  readonly clsScore: number;
  readonly totalCumulativeScore: number;
  readonly sessionWindows: readonly LayoutShiftWindow[];
  readonly maxSessionWindow: LayoutShiftWindow | null;
  readonly totalEntries: number;
  readonly unstableElementsCount: number;
  readonly rootCauseElements: readonly UnstableElementDisplacement[];
  readonly rating: "good" | "needs-improvement" | "poor";
  readonly summary: string;
  readonly evaluatedAt: string;
}

export interface LayoutShiftTrackerOptions {
  readonly subpixelTolerance?: number | undefined;
  readonly userInputWindowMs?: number | undefined;
  readonly sessionMaxDurationMs?: number | undefined;
  readonly sessionMaxGapMs?: number | undefined;
  readonly excludeFixedSticky?: boolean | undefined;
  readonly excludeTransformOnly?: boolean | undefined;
  readonly excludeOpacityOnly?: boolean | undefined;
  readonly ignoreUserInputShifts?: boolean | undefined;
}

export interface ResolvedLayoutShiftTrackerOptions {
  readonly subpixelTolerance: number;
  readonly userInputWindowMs: number;
  readonly sessionMaxDurationMs: number;
  readonly sessionMaxGapMs: number;
  readonly excludeFixedSticky: boolean;
  readonly excludeTransformOnly: boolean;
  readonly excludeOpacityOnly: boolean;
  readonly ignoreUserInputShifts: boolean;
}

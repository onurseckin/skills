import type {
  CanonicalStressInputKey,
  ZIndexLayer,
  ZIndexRange,
  ViewportSpecification,
} from "./types.ts";

export type FormFieldType =
  | "text"
  | "number"
  | "email"
  | "password"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio";

export interface FormFieldDescriptor {
  readonly fieldId: string;
  readonly selector: string;
  readonly label?: string;
  readonly type: FormFieldType;
  readonly required?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly min?: number;
  readonly max?: number;
}

export interface ValidationBannerInfo {
  readonly present: boolean;
  readonly message: string;
  readonly theme?: "error" | "warning" | "info" | "success" | "neutral";
  readonly ariaRole?: "alert" | "status" | "region" | string;
  readonly ariaLive?: "polite" | "assertive" | "off";
  readonly ariaDescribedByMatch?: boolean;
  readonly contrastRatioValid?: boolean;
}

export interface OverflowInspectionResult {
  readonly overflowDetected: boolean;
  readonly horizontalOverflow: boolean;
  readonly verticalOverflow: boolean;
  readonly textTruncated: boolean;
  readonly details: {
    readonly scrollWidth: number;
    readonly clientWidth: number;
    readonly scrollHeight: number;
    readonly clientHeight: number;
  };
}

export interface FormStressFieldResult {
  readonly fieldId: string;
  readonly inputKey: CanonicalStressInputKey | string;
  readonly appliedValue: string;
  readonly accepted: boolean;
  readonly overflowDetected: boolean;
  readonly textTruncated: boolean;
  readonly clientValidationError?: string;
  readonly validationBanner?: ValidationBannerInfo;
  readonly violations: readonly string[];
}

export interface FormStressTestPlan {
  readonly formId: string;
  readonly formSelector: string;
  readonly fields: readonly FormFieldDescriptor[];
  readonly customInputs?: Record<string, string>;
}

export interface FormStressTestResult {
  readonly formId: string;
  readonly totalTests: number;
  readonly passedTests: number;
  readonly failedTests: number;
  readonly fieldResults: readonly FormStressFieldResult[];
  readonly overflowViolations: readonly string[];
  readonly ariaViolations: readonly string[];
  readonly overallValid: boolean;
}

export interface FormFieldEvaluationInput {
  readonly fieldId: string;
  readonly inputKey: CanonicalStressInputKey | string;
  readonly value: string;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly accepted: boolean;
  readonly clientValidationError?: string;
  readonly validationBanner?: ValidationBannerInfo;
}

export type OverlayType = "modal" | "drawer" | "menu" | "popover" | "tooltip" | "toast";

export interface OverlayDescriptor {
  readonly id: string;
  readonly type: OverlayType;
  readonly selector: string;
  readonly zIndex: number;
  readonly backdropSelector?: string;
  readonly backdropZIndex?: number;
  readonly hasBackdrop: boolean;
  readonly dismissOnEscape: boolean;
  readonly dismissOnBackdropClick: boolean;
  readonly focusTrapActive?: boolean;
}

export interface ZIndexHierarchyViolation {
  readonly elementId: string;
  readonly overlayType: OverlayType;
  readonly actualZIndex: number;
  readonly expectedLayer: ZIndexLayer;
  readonly expectedRange: ZIndexRange;
  readonly message: string;
}

export interface ElementBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ElementLayoutNode {
  readonly id: string;
  readonly zIndex: number;
  readonly bounds: ElementBounds;
}

export interface BackdropOcclusionResult {
  readonly occludedCorrectly: boolean;
  readonly occludingElements: readonly string[];
  readonly violations: readonly string[];
}

export interface OverlayDismissalErgonomicsResult {
  readonly overlayId: string;
  readonly escapeDismissalValid: boolean;
  readonly backdropDismissalValid: boolean;
  readonly focusTrapValid: boolean;
  readonly passed: boolean;
  readonly violations: readonly string[];
}

export interface TouchHitbox {
  readonly elementId: string;
  readonly selector: string;
  readonly width: number;
  readonly height: number;
  readonly isCockpitControl?: boolean;
}

export interface TouchHitboxResult {
  readonly elementId: string;
  readonly width: number;
  readonly height: number;
  readonly requiredWidth: number;
  readonly requiredHeight: number;
  readonly compliant: boolean;
  readonly violationMessage?: string;
}

export interface MobileMenuTransitionMetrics {
  readonly triggerSelector: string;
  readonly menuSelector: string;
  readonly opensOnTap: boolean;
  readonly animatesSmoothly: boolean;
  readonly closesOnSelectionOrBackdrop: boolean;
}

export interface MobileMenuTransitionResult {
  readonly triggerSelector: string;
  readonly menuSelector: string;
  readonly passed: boolean;
  readonly violations: readonly string[];
}

export interface BreakpointLayoutMetrics {
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly clippedElements?: readonly string[];
  readonly hitboxes?: readonly TouchHitbox[];
  readonly mobileMenu?: MobileMenuTransitionMetrics;
}

export interface BreakpointReflowResult {
  readonly viewport: ViewportSpecification;
  readonly horizontalScrollDetected: boolean;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly clippedElements: readonly string[];
  readonly touchHitboxResults: readonly TouchHitboxResult[];
  readonly mobileMenuResult?: MobileMenuTransitionResult;
  readonly reflowPassed: boolean;
  readonly violations: readonly string[];
}

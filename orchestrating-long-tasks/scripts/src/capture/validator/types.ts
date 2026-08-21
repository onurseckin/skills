import type { SidebarLayoutConfig } from "../config/types.ts";

export type ValidationVerdict = "CERTIFIED" | "DEFECTS_FOUND" | "NOT_CERTIFIED";

export type DefectSeverity = "critical" | "serious" | "moderate" | "minor";

export type ValidationPillar = "mechanical" | "cognitive" | "custom";

export type CodeRemediationFramework = "react" | "react-native" | "vue" | "svelte" | "css";

export interface CodeRemediation {
  readonly framework: CodeRemediationFramework;
  readonly description: string;
  readonly snippet: string;
}

export interface ValidationDefect {
  readonly id: string;
  readonly pillar: ValidationPillar;
  readonly category: string;
  readonly elementSelector?: string;
  readonly message: string;
  readonly severity: DefectSeverity;
  readonly remediations: readonly CodeRemediation[];
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface PillarValidationResult {
  readonly pillar: ValidationPillar;
  readonly passed: boolean;
  readonly defects: readonly ValidationDefect[];
  readonly evaluatedCount: number;
}

export interface CompanionManifestV2 {
  readonly version: "2.0";
  readonly screenId: string;
  readonly viewport: string;
  readonly timestamp: string;
  readonly verdict: ValidationVerdict;
  readonly totalDefects: number;
  readonly criticalCount: number;
  readonly seriousCount: number;
  readonly moderateCount: number;
  readonly minorCount: number;
  readonly pillars: {
    readonly mechanical: PillarValidationResult;
    readonly cognitive: PillarValidationResult;
    readonly custom: PillarValidationResult;
  };
  readonly allDefects: readonly ValidationDefect[];
  readonly remediationSummary: readonly CodeRemediation[];
}

export interface ElementBoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ElementComputedStyles {
  readonly color?: string;
  readonly backgroundColor?: string;
  readonly fontSize?: number;
  readonly fontWeight?: number;
  readonly borderRadius?: number;
  readonly borderTopLeftRadius?: number;
  readonly borderTopRightRadius?: number;
  readonly borderBottomLeftRadius?: number;
  readonly borderBottomRightRadius?: number;
  readonly padding?: number;
  readonly paddingTop?: number;
  readonly paddingRight?: number;
  readonly paddingBottom?: number;
  readonly paddingLeft?: number;
  readonly letterSpacing?: number;
  readonly fontFamily?: string;
  readonly aspectRatio?: string;
  readonly overflow?: string;
  readonly opacity?: number;
  readonly transform?: string;
}

export type UIInteractionState = "default" | "hover" | "active" | "focus" | "disabled" | "loading";

export interface ElementMediaMeta {
  readonly hasDimensionsReserved?: boolean;
  readonly naturalWidth?: number;
  readonly naturalHeight?: number;
  readonly renderedWidth?: number;
  readonly renderedHeight?: number;
}

export interface ElementPhysicsSnapshot {
  readonly selector: string;
  readonly tagName: string;
  readonly role?: string;
  readonly text?: string;
  readonly bounds: ElementBoundingBox;
  readonly computedStyles?: ElementComputedStyles;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly interactive?: boolean;
  readonly isTouchTarget?: boolean;
  readonly isDestructive?: boolean;
  readonly hasUndo?: boolean;
  readonly hasConfirmation?: boolean;
  readonly implementedStates?: readonly UIInteractionState[];
  readonly isFloating?: boolean;
  readonly clippingBounds?: ElementBoundingBox;
  readonly hasRovingTabindex?: boolean;
  readonly hasTrapFocus?: boolean;
  readonly stateLayers?: Readonly<Record<string, number>>;
  readonly imageVideoMeta?: ElementMediaMeta;
  readonly parentSelector?: string;
  readonly parentBounds?: ElementBoundingBox;
  readonly parentBorderRadius?: number;
  readonly parentPadding?: number;
  readonly children?: readonly ElementPhysicsSnapshot[];
}

export interface ValidationContext {
  readonly screenId: string;
  readonly viewport: string;
  readonly elements: readonly ElementPhysicsSnapshot[];
  readonly sidebarConfig?: SidebarLayoutConfig;
  readonly viewportBounds?: { readonly width: number; readonly height: number };
}

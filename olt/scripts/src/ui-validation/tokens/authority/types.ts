import type {
  FontSizeToken,
  LineHeightToken,
  FontWeightToken,
  SpacingTokenName,
  ShadowElevationToken,
  BorderRadiiToken,
} from "./constants.ts";

export interface RawValueViolation {
  readonly property: string;
  readonly rawValue: string | number;
  readonly violationType:
    | "unauthorized_pixel_value"
    | "unauthorized_color"
    | "arbitrary_inline_style";
  readonly message: string;
  readonly recommendedToken: string;
  readonly line?: number;
}

export interface RawValueValidationResult {
  readonly valid: boolean;
  readonly violationCount: number;
  readonly violations: readonly RawValueViolation[];
}

/**
 * Helper to find the closest valid numerical token
 */

export interface StyleAdjustmentRequest {
  readonly reviewerName: string;
  readonly componentTarget: string;
  readonly requestedProperty: string;
  readonly requestedValue: string | number;
  readonly reviewerCritique: string;
}

export interface TokenImmunityDefense {
  readonly defenseId: string;
  readonly timestamp: string;
  readonly status: "INVOKED" | "WAIVED";
  readonly requestedProperty: string;
  readonly requestedValue: string | number;
  readonly citedTokenStandard: string;
  readonly compliantAlternative: {
    readonly tokenName: string;
    readonly tokenValue: string | number;
    readonly cssExpression: string;
  };
  readonly defenseReasoning: string;
}

export interface TokenCompositionDescriptor {
  readonly componentName: string;
  readonly hierarchyLevel:
    | "h1"
    | "h2"
    | "h3"
    | "h4"
    | "body"
    | "caption"
    | "card"
    | "modal"
    | "button";
  readonly fontSize?: FontSizeToken;
  readonly lineHeight?: LineHeightToken;
  readonly fontWeight?: FontWeightToken;
  readonly spacingOuter?: SpacingTokenName;
  readonly spacingInner?: SpacingTokenName;
  readonly shadowElevation?: ShadowElevationToken;
  readonly borderRadius?: BorderRadiiToken;
}

export interface CompositionRecommendation {
  readonly category: "hierarchy" | "spatial_rhythm" | "elevation" | "typographic_contrast";
  readonly severity: "info" | "warning" | "error";
  readonly currentComposition: string;
  readonly suggestedComposition: string;
  readonly rationale: string;
}

export interface CompositionEvaluationResult {
  readonly componentName: string;
  readonly harmonized: boolean;
  readonly recommendations: readonly CompositionRecommendation[];
  readonly elevationScore: number; // 0 to 100
}

export type TokenProposalStatus =
  | "PROPOSED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "PROPAGATED";

export interface TokenEvolutionProposal {
  readonly id: string;
  readonly name: string;
  readonly category: "spacing" | "typography" | "color" | "shadow" | "radius" | "transition";
  readonly proposedTokenName: string;
  readonly proposedTokenValue: string | number;
  readonly targetDomain: string;
  readonly justification: string;
  readonly author: string;
  readonly status: TokenProposalStatus;
  readonly reviewedBy?: string;
  readonly reviewNotes?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TokenRegistrySnapshot {
  readonly version: string;
  readonly customTokens: readonly TokenEvolutionProposal[];
  readonly totalTokensCount: number;
}

export type { ThemeMode } from "./constants.ts";
export {
  SPACING_TOKENS,
  VALID_SPACING_VALUES,
  TYPOGRAPHY_TOKENS,
  VALID_FONT_SIZES,
  VALID_FONT_WEIGHTS,
  VALID_LINE_HEIGHTS,
  COLOR_PALETTES,
  SHADOW_ELEVATIONS,
  BORDER_RADII,
  VALID_BORDER_RADII_VALUES,
  TRANSITION_TOKENS,
  VALID_TRANSITION_DURATIONS,
} from "./constants.ts";

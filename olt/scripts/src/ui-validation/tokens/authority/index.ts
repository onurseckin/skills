// @ts-nocheck
export type {
  SpacingTokenName,
  SpacingTokenValue,
  FontFamilyToken,
  FontSizeToken,
  FontWeightToken,
  LineHeightToken,
  LetterSpacingToken,
  ThemeMode,
  ColorRoleTokens,
  ColorRole,
  ShadowElevationToken,
  BorderRadiiToken,
  TransitionDurationToken,
  TransitionEasingToken,
  RawValueViolation,
  RawValueValidationResult,
  StyleAdjustmentRequest,
  TokenImmunityDefense,
  TokenCompositionDescriptor,
  CompositionRecommendation,
  CompositionEvaluationResult,
  TokenProposalStatus,
  TokenEvolutionProposal,
  TokenRegistrySnapshot,
} from "./types.ts";

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
} from "./types.ts";

export {
  RawValuePolicyValidator,
  validateZeroRawValues,
} from "./raw-value-validator.ts";
export { TokenComplianceImmunity } from "./immunity-defense.ts";
export { CompositionalDialecticEngine } from "./compositional-dialectic.ts";
export { TokenEvolutionManager } from "./evolution-manager.ts";

export {
  TokenAuthorityEngine,
  getDefaultTokenAuthorityEngine,
  setDefaultTokenAuthorityEngine,
  resetDefaultTokenAuthorityEngine,
} from "./engine.ts";

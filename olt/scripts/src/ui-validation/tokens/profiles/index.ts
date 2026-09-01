// @ts-nocheck
export type {
  OpticalDimension,
  OpticalDimensionMeta,
  IndustryProfileId,
  AestheticProfile,
  UiElementDescriptor,
  UiDescriptor,
  OpticalViolation,
  SocraticCritiqueChallenge,
  AestheticEvaluationReport,
} from "./types.ts";

export {
  OPTICAL_DIMENSIONS,
  OPTICAL_DIMENSION_METADATA,
} from "./types.ts";

export {
  ENTERPRISE_ACCOUNTING_PROFILE,
  LUXURY_HOSPITALITY_PROFILE,
  FLEET_TELEMATICS_PROFILE,
  STANDARD_AESTHETIC_PROFILES,
} from "./canonical-profiles.ts";

export {
  AestheticProfileEvaluator,
  getDefaultAestheticProfileEvaluator,
  setDefaultAestheticProfileEvaluator,
  resetDefaultAestheticProfileEvaluator,
} from "./evaluator.ts";

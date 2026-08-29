export {
  validateZeroCommentsInCode,
  type CommentViolation,
  type ZeroCommentsValidationResult,
} from "./comments.ts";

export {
  validateDensityBudgets,
  type DensityCheckOptions,
  type DensityValidationResult,
  type DirectoryDensityViolation,
  type FileDensityViolation,
} from "./density.ts";

export {
  validateFacadeExports,
  type FacadeExportViolation,
  type FacadeValidationResult,
} from "./facades.ts";

export {
  validateNoBackwardsCompatibilityShims,
  type ShimViolation,
  type ShimValidationResult,
} from "./shims.ts";

export {
  validateCapsuleDiskHygiene,
  type CapsuleHygieneViolation,
  type CapsuleHygieneValidationResult,
} from "./capsule.ts";

export {
  validateRepositoryCodingConventions,
  type RepoConventionsCheckOptions,
  type RepoConventionsValidationResult,
} from "./conventions.ts";

/**
 * Health Checks Subdomain Test Facade.
 * Explicit named exports for dead code, literal fallbacks, unread parameters, and unenforced declarations.
 */

export {
  checkDeadCode,
  scanCommentedCode,
  scanLegacyShapeBranches,
  scanDuplicateHelperImplementations,
} from "../../../olt/scripts/src/health/dead-code.ts";

export {
  checkLiteralFallbacks,
  scanLiteralFallbacks,
} from "../../../olt/scripts/src/health/fallbacks.ts";

export {
  scanUnreadParameters,
  type UnreadParameterFinding,
} from "../../../olt/scripts/src/health/parameters.ts";

export {
  checkDeclarations,
  type DeclarationsCheckOptions,
} from "../../../olt/scripts/src/health/unenforced.ts";

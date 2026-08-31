/**
 * Health Modules Subdomain Test Facade.
 * Explicit named exports for module graph, reachability, allowlist, and intent drift.
 */

export {
  buildModules,
  resolveOrigin,
  type ModuleRecord,
  type ModuleExport,
  type ModuleImport,
} from "../../../olt/scripts/src/health/modules.ts";

export {
  checkUnusedCode,
  type ReachabilityInput,
} from "../../../olt/scripts/src/health/reachability.ts";

export {
  ALLOWED_FINDINGS,
  applyAllowances,
  assertAllowancesHaveReasons,
  type AllowedFinding,
} from "../../../olt/scripts/src/health/allowlist.ts";

export {
  checkIntentDrift,
  type IntentCheckInput,
  type DocumentTarget,
} from "../../../olt/scripts/src/health/intent.ts";

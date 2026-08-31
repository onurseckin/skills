/**
 * Lane 10: Health Domain Root Test Facade.
 * Re-exports domain facades across all 6 subdomains:
 * - scanner/
 * - hygiene/
 * - vendors/
 * - checks/
 * - modules/
 * - reporting/
 */

// 1. Scanner Subdomain
export {
  scanSource,
  lineOf,
  loadSources,
  listFiles,
  type CommentRecord,
  type ScannedSource,
  type SourceFile,
} from "./scanner/index.ts";

// 2. Hygiene Subdomain
export {
  scanRootHygiene,
  quarantineViolations,
  assertCleanRootHygiene,
  RootHygieneEngine,
  DEFAULT_ALLOWED_SCRIPTS_DIRS,
  DEFAULT_ALLOWED_SCRIPTS_FILES,
  DEFAULT_ALLOWED_ROOT_DIRS,
  DEFAULT_ALLOWED_ROOT_FILES,
  type HygieneViolation,
  type HygieneScanResult,
  type QuarantineRecord,
} from "./hygiene/index.ts";

// 3. Vendors Subdomain
export {
  checkVendorIdentifiers,
  checkUnqualifiedDispatch,
  VENDOR_NAMES,
  type TreeTarget,
} from "./vendors/index.ts";

// 4. Checks Subdomain
export {
  checkDeadCode,
  scanCommentedCode,
  scanLegacyShapeBranches,
  scanDuplicateHelperImplementations,
  checkLiteralFallbacks,
  scanLiteralFallbacks,
  scanUnreadParameters,
  checkDeclarations,
  type UnreadParameterFinding,
  type DeclarationsCheckOptions,
} from "./checks/index.ts";

// 5. Modules Subdomain
export {
  buildModules,
  resolveOrigin,
  checkUnusedCode,
  ALLOWED_FINDINGS,
  applyAllowances,
  assertAllowancesHaveReasons,
  checkIntentDrift,
  type ModuleRecord,
  type ModuleExport,
  type ModuleImport,
  type ReachabilityInput,
  type AllowedFinding,
  type IntentCheckInput,
  type DocumentTarget,
} from "./modules/index.ts";

// 6. Reporting Subdomain
export {
  renderHealthReport,
  runHealthCheck,
  defaultLayout,
  finding,
  advisory,
  type HealthLayout,
  type HealthCheckId,
  type HealthCheckResult,
  type HealthFinding,
  type HealthReport,
  type HealthSeverity,
  type SkippedCheck,
} from "./reporting/index.ts";

// 7. In-Memory Virtual Test Fixtures
export {
  sourceOf,
  loadTree,
  pathsIn,
  tempRoot,
  writeTree,
  cleanupTempRoots,
  type LoadedTree,
} from "./fixture.ts";

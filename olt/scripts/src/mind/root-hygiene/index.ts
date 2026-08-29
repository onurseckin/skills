export type {
  HygieneScope,
  HygieneSeverity,
  HygieneViolationType,
  QuarantinedFileRecord,
  RootHygieneFinding,
  RootHygieneOptions,
  RootHygieneScanResult,
} from "./types.ts";

export {
  DEFAULT_ALLOWED_SCRIPTS_DIRS,
  DEFAULT_ALLOWED_SCRIPTS_FILES,
  EXECUTABLE_EXTENSIONS,
  SCRATCH_PATTERNS,
  TEST_ARTIFACT_PATTERNS,
} from "./types.ts";

export {
  isExecutable,
  scanRepoRoot,
  scanRootHygiene,
  scanScriptsRoot,
  scanStaticPackage,
} from "./scanner.ts";

export { quarantineViolations } from "./quarantine.ts";

export { assertCleanRootHygiene, RootHygieneEngine } from "./engine.ts";

export type {
  HygieneScope,
  HygieneSeverity,
  HygieneViolationType,
  QuarantinedFileRecord,
  RootHygieneFinding,
  RootHygieneOptions,
  RootHygieneScanResult,
} from "./root-hygiene/index.ts";

export {
  assertCleanRootHygiene,
  DEFAULT_ALLOWED_SCRIPTS_DIRS,
  DEFAULT_ALLOWED_SCRIPTS_FILES,
  EXECUTABLE_EXTENSIONS,
  isExecutable,
  quarantineViolations,
  RootHygieneEngine,
  scanRepoRoot,
  scanRootHygiene,
  scanScriptsRoot,
  scanStaticPackage,
  SCRATCH_PATTERNS,
  TEST_ARTIFACT_PATTERNS,
} from "./root-hygiene/index.ts";

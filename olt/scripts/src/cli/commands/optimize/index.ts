export {
  detectCycle,
  formatAnalysisMarkdown,
  generateAnalysis,
  optimizeAnalyzeCommand,
  type AnalysisResult,
  type ExportedSymbol,
  type InboundCaller,
  type PlannedSubmodule,
} from "./analyze.ts";

export {
  AstInvariantError,
  checkAstInvariants,
  normalizeSignature,
  optimizeCheckAstCommand,
  type AstBreachCode,
  type AstInvariantBreach,
  type CheckAstResult,
  type ExportedSymbolInfo,
} from "./check-ast.ts";

export {
  checkTestInvariants,
  optimizeCheckTestsCommand,
  type CheckTestsCliOptionsInput,
  type CheckTestsContext,
  type CheckTestsDiffFile,
  type CheckTestsDiffInput,
  type CheckTestsFilesInput,
  type CheckTestsPrePostFile,
  type CheckTestsPrePostInput,
  type CheckTestsResult,
} from "./check-tests.ts";

export {
  checkCodeRelevantDrift,
  defaultGitExecutor,
  getRawPaths,
  isArchive,
  isExecutablePlan,
  isGitHygiene,
  isSourceCode,
  normalizePath,
  optimizeCheckDriftCommand,
  setProcessExitCodeIfHarness,
  type DriftOptions,
  type DriftResult,
  type DriftStatus,
} from "./drift.ts";

export {
  executeQuarantine,
  optimizeQuarantineCommand,
  setTscRunnerForTesting,
  type CompilerHealthCheck,
  type QuarantineOptions,
  type QuarantineResult,
  type TscRunner,
  type WorktreeCleaner,
} from "./quarantine.ts";

export {
  optimizeScanCommand,
  scanCodebase,
  type ScanOptions,
  type ScanResult,
  type ScanViolation,
} from "./scan.ts";

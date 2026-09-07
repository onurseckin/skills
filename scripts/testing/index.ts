export {
  computeIsMain as computeIsChangedMain,
  findAllTestFiles,
  getChangedFiles,
  gitOutput,
  main as runTestChangedMain,
  parseCoverageOutput,
  resolveAffectedTestFiles,
  resolveChangedTestFiles,
  run as runTestChanged,
  type FileCoverageSummary,
  type TestChangedPorts,
} from "./test-changed.ts";

export {
  acquireTestLock,
  isProcessAlive,
  createMemoryLockStore,
  resetLockStore,
  setLockStore,
  getActiveLockStore,
  diskLockStore,
  type LockStore,
  type TestLockData,
} from "./mutex/index.ts";

export {
  computeIsMain as computeIsRunnerMain,
  executeStreamingRunner,
  executeTestRunner,
  main as runTestRunnerMain,
} from "./test-runner.ts";

export {
  createDefaultRunnerStats,
  type ParsedRunnerArgs,
  type RawLineEvent,
  type RunnerOptions,
  type RunnerResult,
  type RunnerStats,
  type StreamEvent,
  type StreamEventListener,
  type StreamEventType,
  type SuiteEndEvent,
  type SuiteStartEvent,
  type SummaryEvent,
  type TestFailEvent,
  type TestFailureInfo,
  type TestPassEvent,
  type TestSkipEvent,
  type TickerOptions,
  type WrapperOptions,
  buildBunTestArgs,
  DEFAULT_COVERAGE_DIR,
  DEFAULT_COVERAGE_REPORTERS,
  DEFAULT_PARALLEL,
  DEFAULT_TIMEOUT_MS,
  isBroadScopeTargets,
  parseRunnerArgs,
  parseDurationMs,
  StreamParser,
  stripAnsi,
  formatElapsedSeconds,
  isInteractiveTerminal,
  TerminalTicker,
  type TerminalTickerOptions,
  formatDuration,
  formatSummaryTable,
  getExecutionBadge,
  type SummaryTableOptions,
} from "./runner/index.ts";

export {
  auditSourceCode,
  auditTestPurity,
  auditTestPuritySync,
  buildAuditResult,
  describeVacuity,
  formatMarkdownReport,
  formatTerminalReport,
  getAllTestFiles,
  getStagedTestFiles,
  resolveAuditRequest,
  type PurityAuditOptions,
  type PurityAuditRequest,
  type PurityAuditResult,
  type PurityAuditScope,
  type PurityViolation,
  type PurityViolationCategory,
} from "./guardrails/index.ts";

export {
  buildDataReferenceIndex,
  CODE_FILE_PATTERN,
  collectBindings,
  collectDataReferences,
  extractCallArguments,
  extractPathCandidates,
  isDataFile,
  isSelectablePrefix,
  normalizePrefix,
  resolvePathExpression,
  selectTestsForDataFile,
  splitTopLevelArguments,
  TEST_FILE_PATTERN,
  type DataReferenceIndex,
  type DataReferenceOptions,
  type DataReferencePorts,
  type ExpressionScope,
} from "./selection/index.ts";

import * as guardrails from "./guardrails/index.ts";
import * as reporting from "./reporting/index.ts";
import * as runner from "./runner/index.ts";
import * as selection from "./selection/index.ts";

export { guardrails, reporting, runner, selection };

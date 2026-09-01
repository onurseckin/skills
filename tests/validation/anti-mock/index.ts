/**
 * Anti-Mock Facade.
 */
export {
  AntiMockEngine,
  evaluateAntiMock,
  formatAntiMockReport,
  checkAssertionFloor,
} from "../../../olt/scripts/src/validation/anti-mock/index.ts";

export type {
  AntiMockDiagnosticReport,
  AntiMockEngineConfig,
  AntiMockEvaluationInput,
  AssertionFloorOptions,
  AssertionFloorResult,
  AssertionFloorRule,
  AssertionFloorViolation,
  AstLinterOptions,
  AstLinterResult,
  AstLinterRule,
  AstLinterViolation,
  MutantExecutionResult,
  MutantRecord,
  MutantStatus,
  MutationCandidate,
  MutationGateOptions,
  MutationGateResult,
  MutationTestRunOutcome,
  MutationTestRunner,
  MutationType,
  MutationViolation,
  TestAssertionSummary,
} from "../../../olt/scripts/src/validation/anti-mock/index.ts";

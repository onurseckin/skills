/**
 * Validation Domain Test & Logic Facades.
 * Explicit named exports - zero wildcard export *.
 */
export {
  scratchRoot,
  createSandboxDir,
  createMockPngBuffer,
  createMockFeedbackItem,
  createMockTaskRecord,
  createMockDualChannelFinding,
} from "./validation-fixture.ts";

export {
  assertAntiBatchingRule,
  validateBatchBoundary,
  verifySingleItemLease,
} from "./anti-batching/index.ts";

export {
  AntiMockEngine,
  detectMockingPatterns,
  evaluateTestFidelity,
  type AntiMockResult,
  type MutationCandidate as AntiMockMutationCandidate,
} from "./anti-mock/index.ts";

export {
  detectSecretLeaks,
  sanitizeEnvironmentVariables,
  isolateTaskBoundaries,
} from "./anti-leak/index.ts";

export {
  analyzeDualChannel,
  isUiScope,
  validateCrossChannelConsistency,
  type DualChannelAnalysisResult,
  type DualChannelFinding,
} from "./dual-channel/index.ts";

export {
  assertCognitiveValidatorHardlock,
  assertValidatorRoleConfinement,
  loadValidatorDomainContract,
  validateDualUiGates,
  type ValidatorDomain,
} from "./dual-validation/index.ts";

export { MutationGate, type MutationCandidate, type MutationReport } from "./mutation/index.ts";

export { AstLinter, validateCodingConventions, extractDomViolations } from "./linting/index.ts";

export {
  auditDefectAssertions,
  extractDefectProse,
  adaptValidationReport,
  generateInteractiveHtml,
} from "./reporting/index.ts";

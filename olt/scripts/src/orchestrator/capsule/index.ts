/**
 * Explicit named facade for the capsule domain.
 */

export type {
  AntiSequentialityReport,
  AntiSequentialityViolation,
  AntiSequentialityViolationType,
  CapsuleExecutionInput,
  CapsuleExecutionResult,
  CapsuleExecutionStatus,
  CapsuleExecutor,
  CapsuleSpec,
  CapsuleStateChangeEvent,
  MultiCapsuleOrchestratorOptions,
  MultiCapsuleSummary,
} from "./types.ts";

export { MultiCapsuleDAG } from "./dag.ts";
export {
  assertAntiSequentiality,
  hasScopeOverlap,
  validateAntiSequentiality,
} from "./anti-sequentiality.ts";
export { formatMultiCapsuleMarkdownSummary } from "./formatter.ts";
export { TrueMultiCapsuleOrchestrator } from "./runner.ts";

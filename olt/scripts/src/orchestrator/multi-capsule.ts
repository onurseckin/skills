/**
 * Facade for True Multi-Capsule Parallel Orchestration & Anti-Sequentiality Engine.
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
} from "./capsule/index.ts";

export {
  assertAntiSequentiality,
  formatMultiCapsuleMarkdownSummary,
  hasScopeOverlap,
  MultiCapsuleDAG,
  TrueMultiCapsuleOrchestrator,
  validateAntiSequentiality,
} from "./capsule/index.ts";

export { formatMultiCapsuleMarkdownSummary as formatMultiCapsuleSummary } from "./capsule/index.ts";

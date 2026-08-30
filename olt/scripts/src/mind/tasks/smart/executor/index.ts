export {
  synthesizeSmartTasksFromFeedbackQueue,
  synthesizeSmartTasksFromSelfEvolution,
  planTasksForDefect,
  type PlanTasksForDefectOptions,
  type DefectTaskTarget,
} from "./evolution.ts";

export {
  synthesizeAutonomousTasks,
  processAutonomousDualIntake,
  runAutonomousDualIntakeCycle,
  expandExternalPromptToPlan,
  planEnhance,
} from "./synthesis.ts";

export {
  expandExternalPromptToWavePlan,
  planEnhanceToWavePlan,
  deriveWriteScopeForCategory,
  deriveGateForCategory,
  sanitizeSlug,
  mapFeedbackPriorityToTaskPriority,
} from "./orchestrator.ts";

export { preplanMultiOrchestratorTasks } from "./execution.ts";

export {
  validateMultiOrchestratorIsolation,
  stageTasksForMultiOrchestratorExecution,
  planMultiOrchestratorExecution,
  partitionTasksAcrossOrchestrators,
  verifyAdmissionToDispatchInvariants,
  verifyProductOwnerInvariants,
} from "./invariants.ts";

export {
  executeAtomicAdmissionToDispatch,
  executeAtomicDispatch,
  executeProductOwnerAdmissionAndDispatch,
  reconcileAdmissionToDispatchState,
  type AtomicDispatchOptions,
} from "./dispatch.ts";

export { runInfiniteProductOwnerCycle, drainBacklogOnRunCompletion } from "./product-owner.ts";

export {
  scanCodeQuality,
  scanTestCoverage,
  scanCharterGaps,
  autonomousCreativeOverload,
  assertMindModeAllowed,
} from "./backlog-drainer.ts";

export { synthesizeTaskPriorities, type TaskPrioritySynthesisOptions } from "./priorities.ts";

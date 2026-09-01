export {
  registerInspectionCommand,
  setupReadyRun,
  REQUIREMENT_ID,
  RUN_GATE_ID,
  TASK_GATE_ID,
  TASK_ID,
  type ReadyRun,
} from "./critic-ready-fixture.ts";

export { requirementIds } from "./critic-run-fixture.ts";

export { setupCompiledRun as setupPersistedCompiledRun } from "./file-persistence-fixture.ts";

export {
  cleanCompletionReview,
  cleanupRoots,
  cleanupVirtualCliFS,
  getVirtualCliFS,
  runStateAssertion,
  setupVirtualCliFS,
  successfulCommand,
  writeJson,
  GATE_SCRIPT,
} from "./full-lifecycle-fixture.ts";

export { freshRun as freshPlanWorkflowRun } from "./plan-workflow-fixture.ts";

export {
  setupRun as setupProbeRun,
  answeredBy,
  reviewPass,
  seedGateProof,
  CHANGED_FILE,
  TASK_ID as PROBE_TASK_ID,
  VALIDATOR as PROBE_VALIDATOR,
} from "./probe-fixture.ts";

export { setupCompiledRun as setupTaskOpsCompiledRun } from "./task-ops-fixture.ts";

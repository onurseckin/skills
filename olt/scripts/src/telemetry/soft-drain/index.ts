export {
  DEFAULT_SOFT_DRAIN_THRESHOLD,
  type TaskAdmissionDecision,
  type SubagentSpawnDecision,
  type SoftExitExecutionParams,
  type SoftExitExecutionResult,
  type SoftDrainStatus,
} from "./types.ts";

export {
  isSoftDrainActive,
  canAdmitTask,
  canSpawnSubagent,
  throttleConcurrency,
  executeGracefulSoftExit,
} from "./manager.ts";

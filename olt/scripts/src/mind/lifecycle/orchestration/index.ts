// @ts-nocheck
export {
  evaluateMindMode,
  discoverGroundedFeatures,
  runMindProductManagerLoop,
} from "./product-manager.ts";

export {
  evaluateAntiStagnation,
  computeProgressSignature,
  recordNonZeroProgress,
  type ProgressDeltaInput,
} from "./anti-stagnation.ts";

export type {
  MindExecutionMode,
  CreativeEvolutionStep,
  GroundedFeatureProposal,
  AntiStagnationState,
  ProductManagerEvaluationResult,
  ProductManagerExpansionResult,
  MindProductManagerOptions,
} from "./types.ts";

export {
  DEFAULT_ORCHESTRATOR_LEDGER_FILE,
  DEFAULT_ORCHESTRATOR_LOCK_FILE,
  VALID_LIFECYCLE_STATUSES,
  VALID_HOST_TYPES,
  withOrchestratorLedgerLock,
  loadOrchestratorLedger,
  registerOrchestratorSpawn,
  deregisterOrchestrator,
  updateOrchestratorHeartbeat,
  isValidHostType,
  isValidStatus,
  validateNewOrchestratorInput,
  parseRecord,
} from "./orchestrator-ledger.ts";

export type {
  OrchestratorLifecycleStatus,
  OrchestratorHostType,
  OrchestratorRegistrationRecord,
  NewOrchestratorRecordInput,
} from "./orchestrator-ledger-types.ts";

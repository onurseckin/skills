export type {
  CadencePhase,
  CadenceTriggerType,
  TriggerPriority,
  CadenceTrigger,
  RolloverDecision,
  CadenceState,
  CadenceTelemetry,
  CadenceEvent,
  CadenceEventListener,
  RolloverEvaluationOptions,
  CadenceStepInput,
  CadenceStepResult,
} from "./types.ts";

export {
  PERPETUAL_NON_STOPPING_CADENCE,
  CLOSING_FORBIDDEN_FOR_MIND,
  ZERO_SLEEP_DELAY_MS,
  DEFAULT_CADENCE_BASE_INTERVAL_MS,
  DEFAULT_CADENCE_MAX_INTERVAL_MS,
  DEFAULT_CADENCE_GRACE_MS,
  createCadenceTrigger,
  enforceLineLimit,
} from "./types.ts";

export type { MindCadenceEngineOptions } from "./state.ts";

export {
  evaluateAntiIdleRollover,
  enforceInfiniteMindCadence,
  createInitialCadenceState,
  CadenceTriggerDispatcher,
} from "./state.ts";

export { MindCadenceEngine } from "./rollover.ts";

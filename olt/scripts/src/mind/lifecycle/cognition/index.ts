export type {
  CognitiveAuditDimension,
  CognitiveAuditSeverity,
  CognitiveAuditFinding,
  CognitiveAuditResult,
  ProactiveQuestionSpec,
  OptimizationProposal,
  ProactiveQuestionCycle,
  DiscoveredSubtask,
  PlanEnhancementHarvest,
  CognitiveScoreVector,
  CadenceHyperAction,
  HyperCognitivePulseReport,
} from "./types.ts";

export {
  HYPER_COGNITION_VERSION,
  MIND_NEVER_IDLE_MANTRA,
  MIN_COGNITIVE_SCORE,
  MAX_COGNITIVE_SCORE,
  DEFAULT_HYPER_AUDIT_INTERVAL_MS,
  COGNITIVE_AUDIT_DIMENSIONS,
  PROACTIVE_QUESTION_CATALOG,
} from "./types.ts";

export type {
  SystemStateMetrics,
  MindPulseContext,
  QuestionCycleInput,
  HyperPulseInput,
  HyperCognitionEngineOptions,
  HyperCognitionEngine,
  DimensionalWeights,
} from "./state.ts";

export { DEFAULT_DIMENSIONAL_WEIGHTS } from "./state.ts";

export { computeCognitiveScoreVector, runAutonomousAuditLoop } from "./gap-analysis.ts";

export {
  executeProactiveSelfQuestioningCycle,
  harvestPlanEnhancementsDuringPulse,
} from "./planner.ts";

export {
  generateOptimizationProposals,
  evaluateCadenceHyperPulse,
  formatHyperCognitionBrief,
  validateHyperCognitiveReport,
} from "./evolution.ts";

export { createHyperCognitionEngine } from "./engine.ts";

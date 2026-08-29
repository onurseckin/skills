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
} from "./hyper-cognition-chunk1.ts";

export {
  HYPER_COGNITION_VERSION,
  MIND_NEVER_IDLE_MANTRA,
  MIN_COGNITIVE_SCORE,
  MAX_COGNITIVE_SCORE,
  DEFAULT_HYPER_AUDIT_INTERVAL_MS,
  COGNITIVE_AUDIT_DIMENSIONS,
  PROACTIVE_QUESTION_CATALOG,
} from "./hyper-cognition-chunk1.ts";

export type {
  SystemStateMetrics,
  MindPulseContext,
  QuestionCycleInput,
  HyperPulseInput,
  HyperCognitionEngineOptions,
  HyperCognitionEngine,
  DimensionalWeights,
} from "./hyper-cognition-chunk2.ts";

export {
  DEFAULT_DIMENSIONAL_WEIGHTS,
} from "./hyper-cognition-chunk2.ts";

export {
  computeCognitiveScoreVector,
  runAutonomousAuditLoop,
} from "./hyper-cognition-chunk3.ts";

export {
  executeProactiveSelfQuestioningCycle,
  harvestPlanEnhancementsDuringPulse,
} from "./hyper-cognition-chunk4.ts";

export {
  generateOptimizationProposals,
  evaluateCadenceHyperPulse,
  formatHyperCognitionBrief,
  validateHyperCognitiveReport,
} from "./hyper-cognition-chunk5.ts";

export {
  createHyperCognitionEngine,
} from "./hyper-cognition-chunk6.ts";

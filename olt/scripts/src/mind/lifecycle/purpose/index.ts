export type {
  MindProactiveBandwidthActivity,
  MacroDagTaskNode,
  MacroDagBottleneck,
  MacroDagDiagnosticResult,
  BacklogGroomingItem,
  BacklogGroomingResult,
  StrategicCandidate,
  StrategicCandidateEvaluation,
  StrategicCandidateAdmissionResult,
  ProactiveWaveTask,
  ProactiveWavePlan,
  ProactiveRoadmapPlan,
  ProactiveMindCognitionResult,
  MacroDagDiagnosticOptions,
  BacklogGroomingOptions,
  StrategicCandidateAdmissionOptions,
  ProactiveRoadmapPlanningOptions,
  ProactiveMindCognitionOptions,
} from "./strategic-purpose-chunk1.ts";

export {
  MIND_STRATEGIC_ALTITUDE,
  MIND_HARD_ZEROS,
  MIND_PROACTIVE_BANDWIDTH_ACTIVITIES,
} from "./strategic-purpose-chunk1.ts";

export {
  diagnoseMacroDag,
  groomBacklog,
} from "./strategic-purpose-chunk2.ts";

export {
  evaluateStrategicCandidateAdmission,
  planProactiveRoadmap,
} from "./strategic-purpose-chunk3.ts";

export {
  executeProactiveMindCognition,
  formatStrategicCognitionBrief,
  verifyMindRoleStrategicInvariants,
} from "./strategic-purpose-chunk4.ts";

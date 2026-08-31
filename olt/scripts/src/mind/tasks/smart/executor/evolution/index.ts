export {
  planTasksForDefect,
  synthesizeSmartTasksFromFeedbackQueue,
  type PlanTasksForDefectOptions,
  type DefectTaskTarget,
} from "./defect-evolution.ts";

export {
  synthesizeSmartTasksFromSelfEvolution,
  detectRepositoryStructure,
  type DetectedRepositoryStructure,
  type SynthesizeSelfEvolutionOptions,
} from "./self-evolution.ts";

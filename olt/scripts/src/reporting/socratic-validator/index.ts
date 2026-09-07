export type {
  SocraticDimension,
  SocraticDimensionMeta,
  SocraticQuestionEvaluation,
  SocraticAuditReport,
} from "./types.ts";
export { SOCRATIC_DIMENSIONS } from "./types.ts";

export { evaluateSocraticSelfQuestioning, formatSocraticAuditSection } from "./evaluate.ts";

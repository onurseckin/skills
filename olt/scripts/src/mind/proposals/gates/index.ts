export type {
  CandidateRecord,
  AdmissionGateVerdict,
  AdmissionEvaluationResult,
  GateEvaluationContext,
  CommandRecordCandidate,
} from "./types.ts";

export { findCommandRecord, readCandidateCommandOutput, outputContainsDefect } from "./types.ts";

export {
  isPathInRepoRoots,
  executeFalsifier,
  parseFalsifierArgv,
  evaluateGate1Witnessed,
} from "./predicates.ts";

export {
  evaluateGate2InCharter,
  evaluateGate3Falsifiable,
  evaluateGate4Scoped,
} from "./evaluator.ts";

export { evaluateGate5Affordable, evaluateGate6NotADuplicate } from "./table.ts";

export { evaluateAdmissionGates } from "./formatter.ts";

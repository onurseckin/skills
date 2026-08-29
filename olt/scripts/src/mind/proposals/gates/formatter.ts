import type {
  CandidateRecord,
  AdmissionGateVerdict,
  AdmissionEvaluationResult,
  GateEvaluationContext,
} from "./types.ts";
import { evaluateGate1Witnessed } from "./predicates.ts";
import {
  evaluateGate2InCharter,
  evaluateGate3Falsifiable,
  evaluateGate4Scoped,
} from "./evaluator.ts";
import { evaluateGate5Affordable, evaluateGate6NotADuplicate } from "./table.ts";
export function evaluateAdmissionGates(
  candidate: CandidateRecord,
  context: GateEvaluationContext,
): AdmissionEvaluationResult {
  const verdicts: AdmissionGateVerdict[] = [];

  const gateEvaluators = [
    evaluateGate1Witnessed,
    evaluateGate2InCharter,
    evaluateGate3Falsifiable,
    evaluateGate4Scoped,
    evaluateGate5Affordable,
    evaluateGate6NotADuplicate,
  ];

  for (const evaluator of gateEvaluators) {
    const verdict = evaluator(candidate, context);
    verdicts.push(verdict);
    if (!verdict.passed) {
      return {
        admitted: false,
        candidateId: candidate.id,
        failingGate: verdict,
        verdicts,
        falsifierExitObserved: null,
      };
    }
  }

  const gate3 = verdicts.find((v) => v.gateNumber === 3);
  const falsifierExitObserved =
    gate3?.metadata && typeof gate3.metadata.exitCode === "number"
      ? (gate3.metadata.exitCode as number)
      : null;

  return {
    admitted: true,
    candidateId: candidate.id,
    verdicts,
    falsifierExitObserved,
  };
}

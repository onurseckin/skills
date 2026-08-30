import { join } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import {
  evaluateAdmissionGates,
  findCommandRecord,
  parseFalsifierArgv,
  readCandidateCommandOutput,
  outputContainsDefect,
  type AdmissionGateVerdict,
  type CandidateRecord,
  type GateEvaluationContext,
} from "../../proposals/gates/index.ts";
import type {
  CounterfactualFindingKind,
  IsolatedCounterfactualCandidate,
  CounterfactualFinding,
  CounterfactualEvaluationResult,
  CounterfactualCandidateSelectionOptions,
  CounterfactualReAdmissionSuiteResult,
  ContextIsolationAuditResult,
} from "./types.ts";
import {
  DISALLOWED_NARRATIVE_KEYS,
  parseNowIso,
  createIsolatedCandidate,
  auditCandidateIsolation,
  selectPreviouslyAdmittedCandidates,
} from "./types.ts";

/**
 * Re-evaluates a previously admitted candidate under fresh isolated conditions.
 * Enforces context isolation: Evaluator receives 0 narrative or rationale from original admission.
 *
 * Verdict logic:
 * - If defect is now fixed (witness exits 0, defect output is absent, or falsifier now passes): produces finding.
 * - If defect persists (witness exits non-zero, defect output present, falsifier fails) and passes gates: confirms validity.
 */
export function evaluateCandidateCounterfactual(
  candidate: Record<string, unknown> | CandidateRecord,
  context: GateEvaluationContext,
  options: { readonly now?: string | number | Date } = {},
): CounterfactualEvaluationResult {
  const evaluatedAt = parseNowIso(options.now);
  const isolated = createIsolatedCandidate(candidate);

  const audit = auditCandidateIsolation(isolated);
  if (!audit.isolated) {
    throw new HarnessError(
      "INVALID_STATE",
      `isolation breach: isolated candidate contains narrative keys [${audit.narrativeKeysFound.join(", ")}]`,
    );
  }

  const isolatedRecord: CandidateRecord = {
    id: isolated.id,
    kind: isolated.kind,
    statement: isolated.statement,
    witness_command_id: isolated.witness_command_id ?? null,
    charter_goal_ids: isolated.charter_goal_ids ?? [],
    falsifier_argv: isolated.falsifier_argv ?? null,
    falsifier_exit: isolated.falsifier_exit ?? null,
    write_scope: isolated.write_scope,
    status: "opened",
  };

  if (isolated.kind === "defect") {
    const witnessId = isolated.witness_command_id?.trim();
    if (!witnessId) {
      const finding: CounterfactualFinding = {
        candidateId: isolated.id,
        findingKind: "defect_never_real",
        message: `defect candidate '${isolated.id}' has no witness command id; defect was never evidenced`,
        gateNumber: 1,
        gateId: "gate-1-witnessed",
        details: { statement: isolated.statement },
        observedAt: evaluatedAt,
      };
      return {
        candidateId: isolated.id,
        admissible: false,
        defectPersists: false,
        isolatedCandidate: isolated,
        admissionVerdicts: [
          {
            gateId: "gate-1-witnessed",
            gateNumber: 1,
            name: "Witnessed",
            passed: false,
            reason: finding.message,
          },
        ],
        failingGate: {
          gateId: "gate-1-witnessed",
          gateNumber: 1,
          name: "Witnessed",
          passed: false,
          reason: finding.message,
        },
        finding,
        evaluatedAt,
      };
    }

    if (witnessId !== "owner-decision") {
      const record = findCommandRecord(context.runRoot, witnessId, context.state);
      if (!record) {
        const finding: CounterfactualFinding = {
          candidateId: isolated.id,
          findingKind: "defect_never_real",
          message: `witness command '${witnessId}' not found in any capsule command records`,
          gateNumber: 1,
          gateId: "gate-1-witnessed",
          details: { witnessCommandId: witnessId },
          observedAt: evaluatedAt,
        };
        return {
          candidateId: isolated.id,
          admissible: false,
          defectPersists: false,
          isolatedCandidate: isolated,
          admissionVerdicts: [
            {
              gateId: "gate-1-witnessed",
              gateNumber: 1,
              name: "Witnessed",
              passed: false,
              reason: finding.message,
            },
          ],
          failingGate: {
            gateId: "gate-1-witnessed",
            gateNumber: 1,
            name: "Witnessed",
            passed: false,
            reason: finding.message,
          },
          finding,
          evaluatedAt,
        };
      }

      const exitCode =
        record.exit_code !== undefined
          ? record.exit_code
          : record.status === "succeeded"
            ? 0
            : record.status === "failed"
              ? 1
              : null;

      if (exitCode === 0) {
        const finding: CounterfactualFinding = {
          candidateId: isolated.id,
          findingKind: "witness_exited_zero",
          message: `witness command '${witnessId}' exited with code 0 (clean); defect has cleared or was never real`,
          gateNumber: 1,
          gateId: "gate-1-witnessed",
          details: { witnessCommandId: witnessId, exitCode: 0 },
          observedAt: evaluatedAt,
        };
        return {
          candidateId: isolated.id,
          admissible: false,
          defectPersists: false,
          isolatedCandidate: isolated,
          admissionVerdicts: [
            {
              gateId: "gate-1-witnessed",
              gateNumber: 1,
              name: "Witnessed",
              passed: false,
              reason: finding.message,
              metadata: { exitCode: 0 },
            },
          ],
          failingGate: {
            gateId: "gate-1-witnessed",
            gateNumber: 1,
            name: "Witnessed",
            passed: false,
            reason: finding.message,
          },
          finding,
          evaluatedAt,
        };
      }

      const output = readCandidateCommandOutput(record, context.runRoot);
      if (output && !outputContainsDefect(output, isolated.statement)) {
        const finding: CounterfactualFinding = {
          candidateId: isolated.id,
          findingKind: "witness_output_missing",
          message: `witness command '${witnessId}' output does not contain cited defect '${isolated.statement}'; defect output is absent`,
          gateNumber: 1,
          gateId: "gate-1-witnessed",
          details: { witnessCommandId: witnessId, statement: isolated.statement },
          observedAt: evaluatedAt,
        };
        return {
          candidateId: isolated.id,
          admissible: false,
          defectPersists: false,
          isolatedCandidate: isolated,
          admissionVerdicts: [
            {
              gateId: "gate-1-witnessed",
              gateNumber: 1,
              name: "Witnessed",
              passed: false,
              reason: finding.message,
            },
          ],
          failingGate: {
            gateId: "gate-1-witnessed",
            gateNumber: 1,
            name: "Witnessed",
            passed: false,
            reason: finding.message,
          },
          finding,
          evaluatedAt,
        };
      }
    }
  }

  const admission = evaluateAdmissionGates(isolatedRecord, context);

  if (!admission.admitted) {
    const failing = admission.failingGate;
    let findingKind: CounterfactualFindingKind = "admission_gate_failed";

    if (failing?.gateNumber === 3 && failing.reason?.includes("exited with 0")) {
      findingKind = "falsifier_passed";
    } else if (failing?.gateNumber === 1) {
      findingKind = "defect_cleared";
    }

    const finding: CounterfactualFinding = {
      candidateId: isolated.id,
      findingKind,
      message:
        failing?.reason ??
        `admission gate '${failing?.gateId ?? "unknown"}' failed during fresh re-admission`,
      ...(failing?.gateNumber !== undefined ? { gateNumber: failing.gateNumber } : {}),
      ...(failing?.gateId !== undefined ? { gateId: failing.gateId } : {}),
      details: {
        reason: failing?.reason,
        falsifierExitCode: admission.falsifierExitObserved,
        metadata: failing?.metadata,
      },
      observedAt: evaluatedAt,
    };

    return {
      candidateId: isolated.id,
      admissible: false,
      defectPersists: false,
      isolatedCandidate: isolated,
      admissionVerdicts: admission.verdicts,
      ...(failing !== undefined ? { failingGate: failing } : {}),
      finding,
      evaluatedAt,
    };
  }

  return {
    candidateId: isolated.id,
    admissible: true,
    defectPersists: true,
    isolatedCandidate: isolated,
    admissionVerdicts: admission.verdicts,
    evaluatedAt,
  };
}

import { HarnessError } from "../errors/harness-error.ts";
import {
  evaluateAdmissionGates,
  findCommandRecord,
  parseFalsifierArgv,
  readCandidateCommandOutput,
  outputContainsDefect,
  type AdmissionGateVerdict,
  type CandidateRecord,
  type GateEvaluationContext,
} from "./gates.ts";

export type CounterfactualFindingKind =
  | "defect_cleared"
  | "defect_never_real"
  | "witness_exited_zero"
  | "witness_output_missing"
  | "falsifier_passed"
  | "admission_gate_failed";

export interface IsolatedCounterfactualCandidate {
  readonly id: string;
  readonly kind: "defect" | "proposal";
  readonly statement: string;
  readonly witness_command_id?: string | null;
  readonly charter_goal_ids?: readonly string[];
  readonly falsifier_argv?: readonly string[] | null;
  readonly falsifier_exit?: number | null;
  readonly write_scope: readonly string[];
  readonly status: "opened";
}

export interface CounterfactualFinding {
  readonly candidateId: string;
  readonly findingKind: CounterfactualFindingKind;
  readonly message: string;
  readonly gateNumber?: number;
  readonly gateId?: string;
  readonly details?: Record<string, unknown>;
  readonly observedAt: string;
}

export interface CounterfactualEvaluationResult {
  readonly candidateId: string;
  readonly admissible: boolean;
  readonly defectPersists: boolean;
  readonly isolatedCandidate: IsolatedCounterfactualCandidate;
  readonly admissionVerdicts: readonly AdmissionGateVerdict[];
  readonly failingGate?: AdmissionGateVerdict;
  readonly finding?: CounterfactualFinding;
  readonly evaluatedAt: string;
}

export interface CounterfactualCandidateSelectionOptions {
  readonly count?: number;
  readonly strategy?: "all" | "random" | "round_robin" | "oldest" | "newest" | "sample";
  readonly filterKind?: "defect" | "proposal" | "all";
  readonly seed?: number;
}

export interface CounterfactualReAdmissionSuiteResult {
  readonly evaluatedAt: string;
  readonly totalEvaluated: number;
  readonly persistentCount: number;
  readonly clearedCount: number;
  readonly findingsCount: number;
  readonly findings: readonly CounterfactualFinding[];
  readonly results: readonly CounterfactualEvaluationResult[];
}

export interface ContextIsolationAuditResult {
  readonly isolated: boolean;
  readonly narrativeKeysFound: readonly string[];
  readonly leakedFields: readonly string[];
}

const DISALLOWED_NARRATIVE_KEYS: readonly string[] = [
  "rationale",
  "decided_at",
  "decided_by",
  "decline_reason",
  "gate_failed",
  "objective_run_id",
  "adoption_notes",
  "adoption_history",
  "prior_admission",
  "prior_verdict",
  "prior_notes",
  "history",
  "narrative",
  "comments",
  "justification",
  "approval_memo",
  "decision_memo",
];

function parseNowIso(nowInput?: number | Date | string): string {
  if (typeof nowInput === "number") {
    return new Date(nowInput).toISOString();
  }
  if (nowInput instanceof Date) {
    return nowInput.toISOString();
  }
  if (typeof nowInput === "string") {
    const parsed = Date.parse(nowInput);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return new Date().toISOString();
}

/**
 * Creates an isolated candidate projection stripping all historical narrative,
 * prior admission rationalizations, and decision artifacts.
 * Fresh evaluator receives zero context from original admission.
 */
export function createIsolatedCandidate(
  rawCandidate: Record<string, unknown> | CandidateRecord,
): IsolatedCounterfactualCandidate {
  if (!rawCandidate || typeof rawCandidate !== "object") {
    throw new HarnessError("INVALID_ARGUMENT", "candidate record must be a valid object");
  }

  const rawObj = rawCandidate as Record<string, unknown>;
  const id =
    typeof rawCandidate.id === "string" && rawCandidate.id.trim()
      ? rawCandidate.id.trim()
      : "unknown-cand";
  const kind = rawCandidate.kind === "proposal" ? "proposal" : "defect";
  const statement = typeof rawCandidate.statement === "string" ? rawCandidate.statement.trim() : "";

  const witnessCommandId =
    typeof rawCandidate.witness_command_id === "string"
      ? rawCandidate.witness_command_id.trim()
      : typeof rawObj.witness === "string"
        ? String(rawObj.witness).trim()
        : null;

  const rawGoals = Array.isArray(rawCandidate.charter_goal_ids)
    ? rawCandidate.charter_goal_ids
    : Array.isArray(rawObj.charter_goals)
      ? rawObj.charter_goals
      : [];

  const charterGoalIds = (rawGoals as unknown[])
    .filter((g): g is string => typeof g === "string" && g.trim().length > 0)
    .map((g) => g.trim());

  let rawFalsifier: readonly string[] | string | null | undefined = undefined;
  if (Array.isArray(rawCandidate.falsifier_argv)) {
    rawFalsifier = rawCandidate.falsifier_argv as readonly string[];
  } else if (typeof rawCandidate.falsifier_argv === "string") {
    rawFalsifier = rawCandidate.falsifier_argv;
  } else if (rawCandidate.falsifier_argv === null) {
    rawFalsifier = null;
  } else if (Array.isArray(rawObj.falsifier)) {
    rawFalsifier = (rawObj.falsifier as unknown[]).filter(
      (s): s is string => typeof s === "string",
    );
  } else if (typeof rawObj.falsifier === "string") {
    rawFalsifier = rawObj.falsifier;
  } else if (rawObj.falsifier === null) {
    rawFalsifier = null;
  }

  const falsifierArgvParsed = parseFalsifierArgv(rawFalsifier);
  const falsifierArgv = falsifierArgvParsed.length > 0 ? [...falsifierArgvParsed] : null;

  const falsifierExit =
    typeof rawCandidate.falsifier_exit === "number" ? rawCandidate.falsifier_exit : null;

  const rawScope = Array.isArray(rawCandidate.write_scope) ? rawCandidate.write_scope : [];
  const writeScope = (rawScope as unknown[])
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim());

  return {
    id,
    kind,
    statement,
    witness_command_id: witnessCommandId,
    charter_goal_ids: charterGoalIds,
    falsifier_argv: falsifierArgv,
    falsifier_exit: falsifierExit,
    write_scope: writeScope,
    status: "opened",
  };
}

/**
 * Audits a candidate object to verify strict context isolation (0 narrative leakage).
 */
export function auditCandidateIsolation(candidate: unknown): ContextIsolationAuditResult {
  if (!candidate || typeof candidate !== "object") {
    return {
      isolated: false,
      narrativeKeysFound: ["non_object_candidate"],
      leakedFields: ["non_object_candidate"],
    };
  }

  const obj = candidate as Record<string, unknown>;
  const keys = Object.keys(obj);
  const found: string[] = [];

  for (const key of keys) {
    const normKey = key.toLowerCase().trim();
    if (DISALLOWED_NARRATIVE_KEYS.includes(normKey)) {
      if (obj[key] !== undefined && obj[key] !== null) {
        found.push(key);
      }
    }
  }

  return {
    isolated: found.length === 0,
    narrativeKeysFound: found,
    leakedFields: found,
  };
}

/**
 * Selects previously admitted candidates from capsule state.
 */
export function selectPreviouslyAdmittedCandidates(
  state: Record<string, unknown>,
  options: CounterfactualCandidateSelectionOptions = {},
): CandidateRecord[] {
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  const candidatePool: Record<string, unknown>[] = [];

  if (Array.isArray(state.candidates)) {
    candidatePool.push(...(state.candidates as Record<string, unknown>[]));
  }
  if (Array.isArray(mindState.candidates)) {
    for (const cand of mindState.candidates as Record<string, unknown>[]) {
      if (!candidatePool.some((existing) => existing.id === cand.id)) {
        candidatePool.push(cand);
      }
    }
  }

  let admitted = candidatePool.filter((c) => c.status === "admitted");

  if (options.filterKind && options.filterKind !== "all") {
    admitted = admitted.filter((c) => c.kind === options.filterKind);
  }

  const strategy = options.strategy ?? "all";

  if (strategy === "newest") {
    admitted = [...admitted].reverse();
  } else if (strategy === "random" || strategy === "sample") {
    const seed = options.seed ?? 12345;
    admitted = [...admitted].sort((a, b) => {
      const hashA = String(a.id)
        .split("")
        .reduce((acc, char) => acc + char.charCodeAt(0), seed);
      const hashB = String(b.id)
        .split("")
        .reduce((acc, char) => acc + char.charCodeAt(0), seed);
      return hashA - hashB;
    });
  }

  if (typeof options.count === "number" && options.count > 0) {
    admitted = admitted.slice(0, options.count);
  }

  return admitted.map((c) => {
    const rawGoals = Array.isArray(c.charter_goal_ids)
      ? c.charter_goal_ids
      : Array.isArray(c.charter_goals)
        ? c.charter_goals
        : [];
    const charterGoalIds = (rawGoals as unknown[]).filter(
      (g): g is string => typeof g === "string",
    );

    const record: CandidateRecord = {
      id: typeof c.id === "string" ? c.id : "unknown-cand",
      kind: c.kind === "proposal" ? "proposal" : "defect",
      statement: typeof c.statement === "string" ? c.statement : "",
      witness_command_id: typeof c.witness_command_id === "string" ? c.witness_command_id : null,
      charter_goal_ids: charterGoalIds,
      falsifier_argv: Array.isArray(c.falsifier_argv) ? (c.falsifier_argv as string[]) : null,
      falsifier_exit: typeof c.falsifier_exit === "number" ? c.falsifier_exit : null,
      write_scope: Array.isArray(c.write_scope) ? (c.write_scope as string[]) : [],
      status: "admitted",
      rationale: typeof c.rationale === "string" ? c.rationale : null,
    };
    return record;
  });
}

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

  // Assert isolation
  const audit = auditCandidateIsolation(isolated);
  if (!audit.isolated) {
    throw new HarnessError(
      "INVALID_STATE",
      `isolation breach: isolated candidate contains narrative keys [${audit.narrativeKeysFound.join(", ")}]`,
    );
  }

  // Convert isolated candidate to CandidateRecord interface for admission evaluation
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

  // 1. Defect-specific witness inspection
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

  // 2. Execute fresh admission evaluation
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

  // Defect persists and all admission gates pass under isolated evaluation
  return {
    candidateId: isolated.id,
    admissible: true,
    defectPersists: true,
    isolatedCandidate: isolated,
    admissionVerdicts: admission.verdicts,
    evaluatedAt,
  };
}

/**
 * Runs a counterfactual re-admission test suite across previously admitted candidates.
 */
export function runCounterfactualReAdmissionSuite(
  state: Record<string, unknown>,
  context: GateEvaluationContext,
  options: CounterfactualCandidateSelectionOptions & { readonly now?: string | number | Date } = {},
): CounterfactualReAdmissionSuiteResult {
  const evaluatedAt = parseNowIso(options.now);
  const candidates = selectPreviouslyAdmittedCandidates(state, options);

  const results: CounterfactualEvaluationResult[] = [];
  const findings: CounterfactualFinding[] = [];
  let persistentCount = 0;
  let clearedCount = 0;

  for (const candidate of candidates) {
    const evalResult = evaluateCandidateCounterfactual(candidate, context, { now: evaluatedAt });
    results.push(evalResult);

    if (evalResult.finding) {
      findings.push(evalResult.finding);
      clearedCount++;
    } else if (evalResult.defectPersists) {
      persistentCount++;
    }
  }

  return {
    evaluatedAt,
    totalEvaluated: results.length,
    persistentCount,
    clearedCount,
    findingsCount: findings.length,
    findings,
    results,
  };
}

/**
 * Formats counterfactual evaluation suite results into structured Markdown.
 */
export function formatCounterfactualReportMarkdown(
  suiteResult: CounterfactualReAdmissionSuiteResult,
): string {
  const lines: string[] = [
    `### Counterfactual Re-Admission Test Report`,
    `- **Evaluated At**: ${suiteResult.evaluatedAt}`,
    `- **Total Evaluated**: ${suiteResult.totalEvaluated}`,
    `- **Persistent Defects (Confirmed)**: ${suiteResult.persistentCount}`,
    `- **Cleared / Non-Persisting Findings**: ${suiteResult.clearedCount}`,
    "",
  ];

  if (suiteResult.findings.length > 0) {
    lines.push(`#### Findings (${suiteResult.findings.length}):`);
    for (const finding of suiteResult.findings) {
      lines.push(
        `- **[${finding.findingKind.toUpperCase()}]** Candidate \`${finding.candidateId}\`: ${finding.message}`,
      );
    }
    lines.push("");
  } else {
    lines.push(
      `_All ${suiteResult.totalEvaluated} tested candidate(s) confirmed persistent defect validity under fresh isolated evaluation._`,
    );
    lines.push("");
  }

  if (suiteResult.results.length > 0) {
    lines.push(`#### Candidate Summaries:`);
    for (const res of suiteResult.results) {
      const statusIcon = res.admissible ? "PASS" : "FINDING";
      lines.push(
        `- \`${res.candidateId}\` [${res.isolatedCandidate.kind}]: **${statusIcon}** — "${res.isolatedCandidate.statement}"`,
      );
      if (res.finding) {
        lines.push(`  - Reason: ${res.finding.message}`);
      }
    }
  }

  return lines.join("\n");
}

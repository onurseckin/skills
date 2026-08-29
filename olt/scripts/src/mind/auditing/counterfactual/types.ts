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
export type CounterfactualOptions = CounterfactualCandidateSelectionOptions;
export type CounterfactualResult = CounterfactualReAdmissionSuiteResult;

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

export const DISALLOWED_NARRATIVE_KEYS: readonly string[] = [
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

export function parseNowIso(nowInput?: number | Date | string): string {
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

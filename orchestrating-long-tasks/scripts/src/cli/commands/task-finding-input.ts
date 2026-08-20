import { HarnessError } from "../../errors/harness-error.ts";
import type { TaskRecord } from "../../workflow/types.ts";
import { textFlag, type Flags } from "../options.ts";

/** No requirement is invented: a finding binds to a requirement the task actually owns, or fails. */
export function resolveFindingRequirement(task: TaskRecord, explicit: string | undefined): string {
  if (explicit !== undefined) {
    if (!task.requirement_ids.includes(explicit)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `requirement ${explicit} is not owned by ${task.id}`,
      );
    }
    return explicit;
  }
  const [only, ...rest] = task.requirement_ids;
  if (only === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `${task.id} has no requirement to bind a finding to`,
    );
  }
  if (rest.length > 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `${task.id} covers ${task.requirement_ids.length} requirements; pass --requirement`,
    );
  }
  return only;
}

export interface ProbeDemandParams {
  taskId: string;
  round: number;
  index: number;
  requirementId: string;
  demand: string;
  commandIds: readonly string[];
  revalidation?: string | undefined;
}

// A demand asserts no defect, so it takes the lowest severity the finding contract allows; what
// separates it from a defect is `class`, never severity.
const PROBE_SEVERITY = "minor";
const PROBE_REMEDIATION =
  "Answer the demand with evidence, or record a defect with task:reject if it does not hold.";

export function buildProbeDemand(params: ProbeDemandParams): Record<string, unknown> {
  return {
    id: `probe-${params.taskId}-${String(params.round).padStart(2, "0")}-${params.index + 1}`,
    class: "probe_demand",
    requirement_id: params.requirementId,
    severity: PROBE_SEVERITY,
    // Cited commands are harness-observed; a bare demand is the validator's own words and says so.
    evidence:
      params.commandIds.length > 0
        ? params.commandIds.map((id) => ({
            kind: "command",
            reference: id,
            evidence_class: "harness_observed",
          }))
        : [{ kind: "demand", detail: params.demand, evidence_class: "agent_reported" }],
    observation: params.demand,
    remediation: PROBE_REMEDIATION,
    revalidation: params.revalidation ?? `Cite a command id that proves this for ${params.taskId}`,
  };
}

export type FindingSeverity = "critical" | "important" | "minor";

const FINDING_SEVERITIES: readonly FindingSeverity[] = ["critical", "important", "minor"];

export function parseSeverity(value: string, flagName: string): FindingSeverity {
  const found = FINDING_SEVERITIES.find((candidate) => candidate === value);
  if (!found) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `--${flagName} must be one of ${FINDING_SEVERITIES.join(", ")}`,
    );
  }
  return found;
}

export interface FailingVerdictInput {
  observation: string;
  severity: FindingSeverity;
  remediation: string;
  revalidation?: string | undefined;
}

/**
 * The three things only the validator knows about a defect. None of them has a stand-in: a
 * generated severity or remediation would be filed as the validator's own finding.
 */
export function failingVerdictInput(flags: Flags): FailingVerdictInput {
  const observation = textFlag(flags, "summary", false);
  if (observation === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--summary is required for a failing verdict: state the defect the validator found",
    );
  }
  const severityRaw = textFlag(flags, "severity", false);
  if (severityRaw === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `--severity is required for a failing verdict (${FINDING_SEVERITIES.join(", ")})`,
    );
  }
  const remediation = textFlag(flags, "remediation", false);
  if (remediation === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--remediation is required for a failing verdict: state what would fix the defect",
    );
  }
  const revalidation = textFlag(flags, "revalidation", false);
  return {
    observation,
    severity: parseSeverity(severityRaw, "severity"),
    remediation,
    ...(revalidation === undefined ? {} : { revalidation }),
  };
}

export interface ReviewFindingParams {
  taskId: string;
  findingId?: string | undefined;
  round: number;
  requirementId: string;
  severity: FindingSeverity;
  checkIds: string[];
  summary: string;
  remediation: string;
  /** How the fix is to be proven. Derived from the task when the validator names nothing. */
  revalidation?: string | undefined;
}

export function buildReviewFinding(params: ReviewFindingParams): Record<string, unknown> {
  const findingId =
    params.findingId ??
    (params.round > 1
      ? `finding-${params.taskId}-${String(params.round).padStart(2, "0")}`
      : `finding-${params.taskId}-01`);

  return {
    id: findingId,
    class: "defect",
    requirement_id: params.requirementId,
    severity: params.severity,
    evidence:
      params.checkIds.length > 0
        ? params.checkIds.map((id) => ({ kind: "command", reference: id }))
        : [{ kind: "failure", detail: params.summary }],
    observation: params.summary,
    remediation: params.remediation,
    // The finding contract demands a revalidation instruction. When the validator names none, the
    // task's own gate is the only instruction the harness can derive without inventing a method.
    revalidation: params.revalidation ?? `Run gate tests for ${params.taskId}`,
  };
}

/**
 * Findings are numbered by the round that produced them, so a repair round and a probe round that
 * both file findings never collide on an id.
 */
export function nextFindingRound(task: TaskRecord): number {
  return Math.max((task.repair_round ?? 0) + 1, (task.findings ?? []).length + 1);
}

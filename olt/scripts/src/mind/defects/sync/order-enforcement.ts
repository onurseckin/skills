import { HarnessError } from "../../../core/errors/index.ts";
import type {
  DefectEntry,
  DefectStatus,
  EmpiricalFailureProof,
} from "../../contracts/defect-contracts.ts";

export const LIFECYCLE_PHASES: readonly string[] = [
  "plan:init",
  "plan:enhance",
  "plan:add",
  "plan:compile",
  "run:start",
  "task:claim",
  "task:review",
  "run:submit",
  "quiesce",
];

const PHASE_ORDER_MAP: Readonly<Record<string, number>> = {
  "plan:init": 0,
  "plan:enhance": 1,
  "plan:add": 2,
  "plan:compile": 3,
  "run:start": 4,
  "task:claim": 5,
  "task:review": 6,
  "run:submit": 7,
  quiesce: 8,
};

export const VALID_DEFECT_STATE_TRANSITIONS: Readonly<
  Record<string, readonly (DefectStatus | string)[]>
> = {
  open: ["deliberating", "in_progress", "resolved", "completed", "closed", "declined"],
  deliberating: ["in_progress", "open", "resolved", "declined"],
  in_progress: ["resolved", "completed", "open", "deliberating", "declined"],
  resolved: ["completed", "closed", "open", "reopened"],
  completed: ["open", "reopened", "closed"],
  closed: ["open", "reopened"],
  declined: ["open", "reopened"],
  reopened: ["open", "deliberating", "in_progress"],
};

export function validatePhaseTransition(currentPhase: string, nextPhase: string): boolean {
  const currentIndex = PHASE_ORDER_MAP[currentPhase];
  const nextIndex = PHASE_ORDER_MAP[nextPhase];
  if (currentIndex === undefined) return true;
  if (nextIndex === undefined) return true;
  return nextIndex >= currentIndex;
}

export function enforceSequentialLifecycleOrdering(sequence: readonly string[]): {
  readonly valid: boolean;
  readonly highestPhaseReached: string;
  readonly violations: readonly string[];
} {
  const violations: string[] = [];
  let highestIndex = -1;
  let highestPhase = "none";

  for (let i = 0; i < sequence.length; i += 1) {
    const cmd = sequence[i];
    if (!cmd) continue;
    const phaseIndex = PHASE_ORDER_MAP[cmd];
    if (phaseIndex !== undefined) {
      if (phaseIndex < highestIndex) {
        violations.push(
          `Command '${cmd}' (phase index ${phaseIndex}) executed out of order after '${highestPhase}' (phase index ${highestIndex})`,
        );
      } else {
        highestIndex = phaseIndex;
        highestPhase = cmd;
      }
    }
  }

  if (violations.length > 0) {
    throw new HarnessError(
      "INVALID_STATE",
      `Sequential lifecycle command ordering breached:\n${violations.join("\n")}`,
    );
  }

  return {
    valid: true,
    highestPhaseReached: highestPhase,
    violations: [],
  };
}

export function validateDefectStateTransition(
  currentStatus: string,
  targetStatus: DefectStatus,
  proof?: EmpiricalFailureProof,
): boolean {
  if (currentStatus === targetStatus) return true;
  const allowed = VALID_DEFECT_STATE_TRANSITIONS[currentStatus];
  if (!allowed) return false;
  if (!allowed.includes(targetStatus)) return false;

  if (
    ["completed", "resolved", "closed", "declined"].includes(currentStatus) &&
    ["open", "reopened"].includes(targetStatus)
  ) {
    if (proof === undefined) return false;
    if (proof === null) return false;
    if (!proof.commit_sha) return false;
    if (!proof.test_assertion) return false;
    if (!proof.task_id) return false;
  }
  return true;
}

export function transitionDefectState(
  defect: DefectEntry,
  targetStatus: DefectStatus,
  proof?: EmpiricalFailureProof,
): DefectEntry {
  const currentStatus =
    defect.status !== undefined && defect.status !== "" ? (defect.status as DefectStatus) : "open";
  if (!validateDefectStateTransition(currentStatus, targetStatus, proof)) {
    throw new HarnessError(
      "INVALID_STATE",
      `Invalid defect transition from '${currentStatus}' to '${targetStatus}' (reopening requires commit_sha, test_assertion, task_id failure proof)`,
    );
  }
  const now = new Date().toISOString();
  const prevCount = defect.count !== undefined ? defect.count : 1;
  return {
    ...defect,
    status: targetStatus,
    last_seen_at: now,
    ...(["open", "reopened"].includes(targetStatus)
      ? {
          count: prevCount + 1,
          reopened_at: now,
          ...(proof ? { failure_proof: proof } : {}),
        }
      : {}),
  };
}

import { HarnessError } from "../../../core/errors/index.ts";
import type {
  DefectEntry,
  DefectStatus,
  EmpiricalFailureProof,
} from "../../contracts/defect-contracts.ts";
import { assertFailureProofValid, verifyFailureProof } from "./proof-verifier.ts";

export type DefectLifecycleStatus =
  | "open"
  | "deliberating"
  | "in_remediation"
  | "in_progress"
  | "resolved"
  | "completed"
  | "closed"
  | "declined"
  | "reopened";

export const VALID_DEFECT_STATE_TRANSITIONS: Readonly<
  Record<string, readonly (DefectLifecycleStatus | string)[]>
> = {
  open: [
    "deliberating",
    "in_remediation",
    "in_progress",
    "resolved",
    "completed",
    "closed",
    "declined",
  ],
  deliberating: [
    "open",
    "reopened",
    "in_remediation",
    "in_progress",
    "resolved",
    "declined",
    "closed",
  ],
  in_remediation: ["resolved", "completed", "open", "deliberating", "declined"],
  in_progress: ["resolved", "completed", "open", "deliberating", "declined"],
  resolved: ["deliberating", "completed", "closed", "open", "reopened"],
  completed: ["deliberating", "open", "reopened", "closed"],
  closed: ["deliberating", "open", "reopened"],
  declined: ["deliberating", "open", "reopened"],
  reopened: ["deliberating", "in_remediation", "in_progress", "open"],
};

/**
 * Validates whether a defect state transition is permitted by the state machine.
 */
export function validateDefectStateTransition(
  currentStatus: string,
  targetStatus: string,
  proof?: EmpiricalFailureProof,
): boolean {
  if (currentStatus === targetStatus) return true;
  const allowed = VALID_DEFECT_STATE_TRANSITIONS[currentStatus];
  if (!allowed) return false;
  if (!allowed.includes(targetStatus)) return false;

  // Reopening completed/resolved/closed defects directly to open/reopened requires empirical failure proof
  if (
    ["completed", "resolved", "closed", "declined", "deliberating"].includes(currentStatus) &&
    ["open", "reopened"].includes(targetStatus)
  ) {
    if (proof === undefined) return false;
    if (proof === null) return false;
    const verification = verifyFailureProof(proof);
    if (!verification.valid) return false;
  }

  return true;
}

/**
 * Transitions a defect to a target state, verifying failure proofs on regressions.
 */
export function transitionDefectState(
  defect: DefectEntry,
  targetStatus: DefectStatus | DefectLifecycleStatus,
  proof?: EmpiricalFailureProof,
): DefectEntry {
  const currentStatus =
    defect.status !== undefined && defect.status !== "" ? (defect.status as string) : "open";

  if (!validateDefectStateTransition(currentStatus, targetStatus, proof)) {
    throw new HarnessError(
      "INTEGRITY",
      `Invalid defect transition from '${currentStatus}' to '${targetStatus}' (reopening requires valid empirical failure proof: commit_sha, test_assertion, task_id)`,
    );
  }

  const now = new Date().toISOString();
  const prevCount = defect.count !== undefined ? defect.count : 1;
  return {
    ...defect,
    status: targetStatus as DefectStatus,
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

/**
 * Handles recurrence of an existing defect when reported by Doctor or another auditor.
 * If previously completed/resolved, transitions through 'deliberating' or directly to 'open' if valid proof provided.
 */
export function handleDefectRecurrence(
  existing: DefectEntry,
  options: {
    readonly proof?: EmpiricalFailureProof | undefined;
    readonly now?: string | undefined;
    readonly requireStrictProof?: boolean | undefined;
  } = {},
): DefectEntry {
  const now =
    options.now !== undefined && options.now !== "" ? options.now : new Date().toISOString();
  const currentStatus =
    existing.status !== undefined && existing.status !== "" ? existing.status : "open";
  const prevExistingCount = existing.count !== undefined ? existing.count : 1;
  const count = prevExistingCount + 1;

  if (["resolved", "completed", "closed"].includes(currentStatus)) {
    if (options.proof) {
      if (options.requireStrictProof) {
        assertFailureProofValid(options.proof);
      }
      const verification = verifyFailureProof(options.proof);
      if (verification.valid) {
        return {
          ...existing,
          status: "open",
          last_seen_at: now,
          reopened_at: now,
          count,
          failure_proof: options.proof,
        };
      }
    }

    // Without complete proof, transition to deliberating intermediate stage
    return {
      ...existing,
      status: "deliberating" as DefectStatus,
      last_seen_at: now,
      count,
      ...(options.proof ? { failure_proof: options.proof } : {}),
    };
  }

  return {
    ...existing,
    last_seen_at: now,
    count,
  };
}

import { HarnessError } from "../../core/errors/harness-error.ts";
import { isRecord } from "../../requirements/predicates.ts";
import { requireText, transition, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort, type WorkflowState } from "../types.ts";
import {
  authorityAuditIssues,
  authorityRequirements,
  requirementDisposition,
} from "./authorization.ts";
import { decisionHistory, makeAuthorityDecisionRecord } from "./decision-record.ts";
import { requirementExecutionState } from "./execution-state.ts";
import type { AuthorityDecisionInput } from "./types.ts";

const DORMANT_DISPOSABLE_TASK_STATUSES = new Set([
  "proposed",
  "ready",
  "retry_ready",
  "blocked",
  "stale",
  "escalated",
  "cancelled",
]);

function assertDeclineIsSafe(state: WorkflowState, requirementId: string): void {
  const unsafe = Object.values(state.tasks)
    .filter(
      (task) =>
        task.requirement_ids.includes(requirementId) &&
        !DORMANT_DISPOSABLE_TASK_STATUSES.has(task.status),
    )
    .map(({ id }) => id)
    .sort();
  if (unsafe.length > 0) {
    throw new HarnessError(
      "INVALID_STATE",
      `authority decline would invalidate active or completed task(s): ${unsafe.join(", ")}`,
    );
  }
}

function disposePureTasks(state: WorkflowState, actor: string, now: Date): void {
  const requirements = authorityRequirements(state);
  for (const task of Object.values(state.tasks)) {
    if (task.status === "cancelled" || task.requirement_ids.length === 0) continue;
    if (
      task.requirement_ids.every(
        (id) =>
          requirements.has(id) && requirementExecutionState(requirements.get(id)!) === "disposed",
      )
    ) {
      transition(task, "cancelled", actor, now, "all mapped requirements are out of scope");
    }
  }
}

function exactRetry(
  state: WorkflowState,
  requirementId: string,
  actor: string,
  input: AuthorityDecisionInput,
): boolean {
  const requirement = authorityRequirements(state).get(requirementId);
  const history = requirement?.authority_history;
  return Boolean(
    requirement &&
    requirementDisposition(requirement) === "needs_authority" &&
    authorityAuditIssues(requirement).length === 0 &&
    Array.isArray(history) &&
    history.length === 1 &&
    isRecord(history[0]) &&
    history[0].decision === input.decision &&
    history[0].actor === actor &&
    history[0].rationale === input.rationale,
  );
}

export function recordAuthorityDecision(
  port: TransactionPort,
  requirementId: string,
  actor: string,
  input: AuthorityDecisionInput,
  clock: Clock = systemClock,
): WorkflowState {
  requirementId = requireText(requirementId, "requirement_id");
  actor = requireText(actor, "actor");
  if (!isRecord(input) || !["grant", "decline"].includes(String(input.decision))) {
    throw new HarnessError("INVALID_ARGUMENT", "decision must be grant or decline");
  }
  const normalized = {
    decision: input.decision,
    rationale: requireText(input.rationale, "rationale"),
  };
  const existing = port.read();
  if (exactRetry(existing, requirementId, actor, normalized)) return existing;
  const now = clock.now();
  const record = makeAuthorityDecisionRecord(requirementId, actor, normalized, utc(now));
  return port.transact(
    actor,
    "requirement-authority-decided",
    {
      requirement_id: requirementId,
      decision: normalized.decision,
      decision_sha256: record.decision_sha256,
    },
    (draft) => {
      const requirement = authorityRequirements(draft).get(requirementId);
      if (!requirement) {
        throw new HarnessError("INVALID_ARGUMENT", `unknown requirement: ${requirementId}`);
      }
      if (
        requirementDisposition(requirement) !== "needs_authority" ||
        requirement.authority_status !== undefined
      ) {
        throw new HarnessError(
          "INVALID_STATE",
          "only pending needs_authority requirements can receive a decision",
        );
      }
      if (normalized.decision === "decline") assertDeclineIsSafe(draft, requirementId);
      if (decisionHistory(requirement).length > 0) {
        throw new HarnessError(
          "INVALID_STATE",
          "pending requirement cannot already contain authority history",
        );
      }
      requirement.authority_status = normalized.decision === "grant" ? "granted" : "declined";
      requirement.authority_history = [record];
      if (normalized.decision === "decline") disposePureTasks(draft, actor, now);
    },
  );
}

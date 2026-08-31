import { HarnessError } from "../../core/errors/index.ts";
import type { Evidenced } from "../../core/contracts/index.ts";
import { newLeaseToken, tokenDigest } from "./token.ts";
import { requireText, taskIn, transition, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";
import { ownershipConflicts } from "../../engine/scheduler/index.ts";
import { taskExecutionBlockers, taskExecutionState } from "../authority/execution-state.ts";

const MIN_LEASE = 5;
const MAX_LEASE = 86_400;

export interface ClaimOptions {
  leaseSeconds?: number;
  clock?: Clock;
  writeScopeContentHash?: Evidenced<string>;
  claimedBaseSha?: Evidenced<string>;
}

export function claimTask(
  port: TransactionPort,
  taskId: string,
  agentId: string,
  role: string,
  options: ClaimOptions = {},
): { state: ReturnType<TransactionPort["read"]>; token: string } {
  agentId = requireText(agentId, "agent_id");
  role = requireText(role, "role");
  const seconds = options.leaseSeconds ?? 1_200;
  if (!Number.isSafeInteger(seconds) || seconds < MIN_LEASE || seconds > MAX_LEASE) {
    throw new HarnessError("INVALID_ARGUMENT", "lease_seconds must be an integer from 5 to 86400");
  }
  const now = (options.clock ?? systemClock).now();
  const token = newLeaseToken();
  const state = port.transact(agentId, "task-claimed", { task_id: taskId, role }, (draft) => {
    if (draft.completion_result?.status === "complete") {
      throw new HarnessError("INVALID_STATE", "run is already completed");
    }
    const task = taskIn(draft, taskId);
    const repair = task.status === "changes_requested";
    if (!["ready", "retry_ready", "changes_requested"].includes(task.status)) {
      throw new HarnessError("INVALID_STATE", `task ${taskId} is not claimable`);
    }
    if ((repair && role !== "repairer") || (!repair && role !== "implementer")) {
      throw new HarnessError("INVALID_ARGUMENT", "lease role does not match the task state");
    }
    if (repair && task.repair_assignee !== agentId) {
      throw new HarnessError("INVALID_STATE", "repair must return to the assigned implementer");
    }
    const review = draft.plan_review;
    const liveRevision = draft.graph_revision ?? 1;
    if (review && review.graph_revision === liveRevision && review.status === "changes_requested") {
      throw new HarnessError(
        "INVALID_STATE",
        "plan validation rejected this graph revision; replan and record a passing plan:review before any implementer or repairer can claim work",
      );
    }
    if (task.dependencies.some((id) => draft.tasks[id]?.status !== "done")) {
      throw new HarnessError("INVALID_STATE", "task dependencies are not done");
    }
    const execution = taskExecutionState(draft, task.requirement_ids);
    if (execution !== "executable") {
      const blockers = taskExecutionBlockers(draft, task.requirement_ids);
      throw new HarnessError(
        "INVALID_STATE",
        blockers.length > 0
          ? `task requirements are not authorized: ${blockers.join(", ")}`
          : "task requirements are disposed",
      );
    }
    const conflicts = ownershipConflicts(task, Object.values(draft.tasks));
    if (conflicts.length > 0) {
      throw new HarnessError(
        "INVALID_STATE",
        `task has active ownership conflict with: ${conflicts.join(", ")}`,
      );
    }
    const attempt = task.attempts.length + 1;
    task.lease = {
      agent_id: agentId,
      role,
      attempt,
      token_digest: tokenDigest(token),
      issued_at: utc(now),
      heartbeat_at: utc(now),
      expires_at: utc(new Date(now.valueOf() + seconds * 1_000)),
      duration_seconds: seconds,
      write_scope: [...task.write_scope],
      resource_scope: [...(task.resource_scope ?? [])],
      ...(options.writeScopeContentHash === undefined
        ? {}
        : { write_scope_content_hash: options.writeScopeContentHash }),
    };
    task.attempts.push({
      attempt,
      agent_id: agentId,
      role,
      started_at: utc(now),
      kind: repair ? "repair" : "implementation",
      ...(options.claimedBaseSha === undefined ? {} : { claimed_base_sha: options.claimedBaseSha }),
    });
    if (options.writeScopeContentHash !== undefined && !task.initial_write_scope_content_hash) {
      task.initial_write_scope_content_hash = options.writeScopeContentHash;
    }
    task.original_implementer ??= agentId;
    transition(task, "leased", agentId, now, repair ? "repair claimed" : "implementation claimed");
  });
  return { state, token };
}

import { createHash } from "node:crypto";
import { HarnessError } from "../../errors/harness-error.ts";
import type { Evidenced } from "../../contracts/evidence.ts";
import type { JsonObject } from "../../contracts/json.ts";
import { tokenMatches } from "../lease/token.ts";
import { jsonCopy, requireText, taskIn, transition, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";
import { validateReport } from "./validate-report.ts";
import { assertPublishedTaskPacket } from "../packet-authority.ts";

export interface EffortEvidenceOptions {
  currentWriteScopeContentHash?: Evidenced<string>;
  noOp?: { reason: string };
}

export function submitTask(
  port: TransactionPort,
  taskId: string,
  agentId: string,
  token: string,
  reportValue: unknown,
  clock: Clock = systemClock,
  effortEvidence: EffortEvidenceOptions = {},
): { state: ReturnType<TransactionPort["read"]>; orphaned: boolean } {
  agentId = requireText(agentId, "agent_id");
  const now = clock.now();
  let orphaned = false;
  const payload: JsonObject = { task_id: taskId };
  if (effortEvidence.noOp) payload.no_op_reason = effortEvidence.noOp.reason;
  const state = port.transact(agentId, "task-submitted", payload, (draft) => {
    const task = taskIn(draft, taskId);
    const lease = task.lease;
    const expiredAttempt = [...task.attempts]
      .reverse()
      .find(
        (attempt) =>
          attempt.expired_agent_id === agentId &&
          typeof attempt.expired_token_digest === "string" &&
          tokenMatches(token, attempt.expired_token_digest),
      );
    const current = lease?.agent_id === agentId && tokenMatches(token, lease.token_digest);
    if (!current && !expiredAttempt) {
      throw new HarnessError("INVALID_STATE", "lease identity or token is invalid");
    }
    const report = validateReport(task, reportValue);
    if (expiredAttempt || (lease && Date.parse(lease.expires_at) <= now.valueOf())) {
      const canonical = JSON.stringify(report);
      draft.orphan_evidence.push({
        task_id: taskId,
        agent_id: agentId,
        attempt: expiredAttempt?.attempt ?? lease?.attempt ?? 0,
        reason: expiredAttempt ? "stale_recovered_lease" : "expired_lease",
        received_at: utc(now),
        report_sha256: createHash("sha256").update(canonical).digest("hex"),
        report: jsonCopy(report),
      });
      orphaned = true;
      return;
    }
    if (!lease) throw new HarnessError("INVALID_STATE", "task has no current lease");
    if (!["leased", "running"].includes(task.status)) {
      throw new HarnessError("INVALID_STATE", "task is not accepting a submission");
    }
    assertPublishedTaskPacket(draft, taskId, lease.role, agentId, lease.attempt);

    const claimedHash = lease.write_scope_content_hash;
    const submittedHash = effortEvidence.currentWriteScopeContentHash;
    if (claimedHash !== undefined && submittedHash !== undefined) {
      const unchanged = claimedHash.value === submittedHash.value;
      if (unchanged && !effortEvidence.noOp) {
        throw new HarnessError(
          "INVALID_STATE",
          `task ${taskId} write scope (${task.write_scope.join(", ")}) is byte-identical to its content at claim; nothing was written. Submit --no-op --reason "<why>" if this task legitimately needed no change, or make the change its write scope requires.`,
        );
      }
      if (!unchanged && effortEvidence.noOp) {
        throw new HarnessError(
          "INVALID_ARGUMENT",
          `task ${taskId} write scope changed since claim; --no-op is only for a submission that changed nothing`,
        );
      }
      if (unchanged && effortEvidence.noOp) {
        task.no_op = {
          reason: requireText(effortEvidence.noOp.reason, "no_op reason"),
          declared_by: agentId,
          at: utc(now),
        };
      }
    }

    task.report = report;
    delete task.lease;
    const latestAttempt = task.attempts.at(-1);
    if (latestAttempt) latestAttempt.submitted_at = utc(now);
    transition(task, "submitted", agentId, now, "evidence submitted");
  });
  return { state, orphaned };
}

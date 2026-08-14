import { createHash } from "node:crypto";
import { HarnessError } from "../../errors/harness-error.ts";
import type { JsonObject } from "../../contracts/json.ts";
import { tokenMatches } from "../lease/token.ts";
import { jsonCopy, requireText, taskIn, transition, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";
import { validateReport } from "./validate-report.ts";
import { assertPublishedTaskPacket } from "../packet-authority.ts";

export function submitTask(
  port: TransactionPort,
  taskId: string,
  agentId: string,
  token: string,
  reportValue: unknown,
  clock: Clock = systemClock,
): { state: ReturnType<TransactionPort["read"]>; orphaned: boolean } {
  agentId = requireText(agentId, "agent_id");
  const now = clock.now();
  let orphaned = false;
  const state = port.transact(agentId, "task-submitted", { task_id: taskId }, (draft) => {
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
    const attempt = expiredAttempt ?? lease;
    assertPublishedTaskPacket(
      draft,
      taskId,
      String(attempt?.role ?? ""),
      agentId,
      Number(attempt?.attempt ?? 0),
    );
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
    task.report = report;
    delete task.lease;
    const latestAttempt = task.attempts.at(-1);
    if (latestAttempt) latestAttempt.submitted_at = utc(now);
    transition(task, "submitted", agentId, now, "evidence submitted");
  });
  return { state, orphaned };
}

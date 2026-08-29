import { createHash } from "node:crypto";
import { HarnessError } from "../../core/errors/index.ts";
import type { Evidenced } from "../../core/contracts/index.ts";
import type { Finding } from "../../core/contracts/index.ts";
import type { JsonObject } from "../../core/contracts/index.ts";
import { repositoryGit, type RepositoryGitCommand } from "../../packets/repository-git-command.ts";
import { tokenMatches } from "../lease/token.ts";
import { jsonCopy, requireText, taskIn, transition, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";
import { outOfBandPaths } from "./out-of-band-drift.ts";
import { validateReport } from "./validate-report.ts";
import { assertPublishedTaskPacket } from "../packet-authority.ts";
import {
  auditTierConfinement,
  assertSupervisorRoleConfinement,
  isCoordinatorRole,
  isOrchestratorRole,
  isMindRole,
} from "../../reporting/doctor/tier-confinement.ts";

export interface EffortEvidenceOptions {
  currentWriteScopeContentHash?: Evidenced<string>;
  noOp?: { reason: string };
}

function outOfBandFinding(
  taskId: string,
  requirementId: string,
  paths: readonly string[],
): Finding {
  const id = `out-of-band-${createHash("sha256").update(paths.join("\n")).digest("hex").slice(0, 16)}`;
  return {
    id,
    requirement_id: requirementId,
    severity: "critical",
    observation: `repository drift outside every declared task write_scope: ${paths.join(", ")}`,
    evidence: [{ kind: "out_of_band_paths", paths: [...paths] }],
    remediation: `extend a task's write_scope to cover the drifted paths, or revert the out-of-scope change, before ${taskId} can complete`,
    revalidation: `re-run task:submit for ${taskId} once the working tree matches the union of every declared write_scope`,
    status: "open",
  };
}

export function submitTask(
  port: TransactionPort,
  taskId: string,
  agentId: string,
  token: string,
  reportValue: unknown,
  clock: Clock = systemClock,
  effortEvidence: EffortEvidenceOptions = {},
  git: RepositoryGitCommand = repositoryGit,
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

    if (
      isOrchestratorRole(agentId) ||
      isCoordinatorRole(agentId) ||
      isMindRole(agentId) ||
      (lease &&
        (isOrchestratorRole(lease.role) || isCoordinatorRole(lease.role) || isMindRole(lease.role)))
    ) {
      throw new HarnessError(
        "ROLE_CONFINEMENT_VIOLATION",
        `Supervisors (agent: ${agentId}, role: ${lease ? lease.role : "supervisor"}) are mechanically confined from submitting implementation tasks. Implementation submissions are restricted to Tier 3 Implementers.`,
      );
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

    const confinementFindings = auditTierConfinement("", draft as unknown as JsonObject);
    assertSupervisorRoleConfinement(confinementFindings);

    const criticalTaskFindings = confinementFindings.filter(
      (f) =>
        f.severity === "critical" &&
        (f.agent_id === agentId || (f.evidence && f.evidence.task_id === taskId)),
    );
    if (criticalTaskFindings.length > 0) {
      const details = criticalTaskFindings
        .map((f) => `[${f.violation_type}] ${f.observation}`)
        .join("; ");
      throw new HarnessError(
        "ROLE_CONFINEMENT_VIOLATION",
        `Tier confinement violation detected during task submission for ${taskId}: ${details}`,
      );
    }

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

    const drift = outOfBandPaths(draft, now, git);
    if (drift.length > 0) {
      const finding = outOfBandFinding(taskId, task.requirement_ids[0] ?? "", drift);
      task.findings ??= [];
      if (!task.findings.some((existing) => existing.id === finding.id))
        task.findings.push(finding);
    }

    task.report = report;
    delete task.lease;
    const latestAttempt = task.attempts.at(-1);
    if (latestAttempt) latestAttempt.submitted_at = utc(now);
    transition(task, "submitted", agentId, now, "evidence submitted");
  });
  return { state, orphaned };
}

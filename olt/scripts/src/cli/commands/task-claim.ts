import { join } from "node:path";
import { AGENT_ROLES, isAgentRole } from "../../core/contracts/index.ts";
import { evidenced, type Evidenced } from "../../core/contracts/index.ts";
import { getHarnessConfig } from "../../core/config/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { appendDefectLedgerRecord } from "../../logging/defect-logger.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { repositoryGit, type RepositoryGitCommand } from "../../packets/repository-git-command.ts";
import { hasRepositoryGitMetadata } from "../../packets/repository-git-metadata.ts";
import { publishTaskRolePacket } from "../../packets/role-grant.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { loadRun } from "../../engine/store/index.ts";
import {
  refreshAgentDerivedTelemetry,
  type TelemetryFieldConflict,
} from "../../workflow/agents/grants.ts";
import { claimTask } from "../../workflow/lease/claim.ts";
import { hashWriteScope } from "../../workflow/lease/write-scope-hash.ts";
import { findAssignedWorktree, readWorktreeLedger } from "../../workflow/worktree/ledger.ts";
import { formatTaskClaimBrief, formatTaskHeartbeatBrief } from "../formatters/index.ts";
import { probeLiveQuotaTelemetry } from "../../workflow/lifecycle/quota-lifecycle.ts";
import { detectHostApp } from "../../authority/thread/context.ts";
import { probeAgentTelemetry, withHostTelemetryConflicts } from "../host-telemetry-probe.ts";
import { integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import { heartbeat } from "../../workflow/lease/heartbeat.ts";

export { taskSubmitCommand } from "./task-submit.ts";

export function taskHeartbeatCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const taskId = textFlag(flags, "task")!;
  const agent = textFlag(flags, "agent")!;
  const token = textFlag(flags, "token")!;

  const state = heartbeat(workflowPort(run), taskId, agent, token);
  const task = state.tasks[taskId]!;
  const lease = task.lease;
  if (!lease) {
    throw new HarnessError("INTEGRITY", `heartbeat for ${taskId} left the task without a lease`);
  }
  const markdown = formatTaskHeartbeatBrief({
    taskId,
    agent,
    extendedMinutes: Math.round(lease.duration_seconds / 60),
    newDeadline: lease.expires_at,
  });

  return { markdown, run_root: run, task };
}

export function assignedWorktreeForClaim(
  run: string,
  taskId: string,
): { worktreePath: string; worktreeId: string } | undefined {
  const repoRoot = findRepoRoot(run);
  const config = getHarnessConfig(repoRoot, run);
  if (!config.worktree_isolation) return undefined;
  const ledger = readWorktreeLedger(loadRun(run).state);
  if (!ledger) return undefined;
  return findAssignedWorktree(ledger, taskId) ?? undefined;
}

export function writeScopeHashBase(run: string, taskId: string, repoRoot: string): string {
  return assignedWorktreeForClaim(run, taskId)?.worktreePath ?? repoRoot;
}

const CLAIMED_BASE_SHA_MAX_BYTES = 1024;

export function claimedBaseShaAt(
  repoRoot: string,
  gitCommand: RepositoryGitCommand = repositoryGit,
): Evidenced<string> | undefined {
  if (!hasRepositoryGitMetadata(repoRoot)) return undefined;
  try {
    const result = gitCommand(
      repoRoot,
      ["rev-parse", "--verify", "-q", "HEAD"],
      CLAIMED_BASE_SHA_MAX_BYTES,
      [0, 1],
    );
    if (result.status !== 0) return undefined;
    const sha = result.bytes.toString("utf8").trim();
    return sha === "" ? undefined : evidenced(sha, "harness_observed");
  } catch {
    return undefined;
  }
}

export function probeAtTaskBoundary(
  run: string,
  agent: string,
  boundary: string,
): TelemetryFieldConflict[] {
  const derived = probeAgentTelemetry(agent);
  if (Object.keys(derived).length === 0) return [];
  const refreshed = refreshAgentDerivedTelemetry({
    runRoot: run,
    agentId: agent,
    actor: agent,
    boundary,
    derived,
  });
  return refreshed?.conflicts === undefined ? [] : [...refreshed.conflicts];
}

export async function taskClaimCommand(
  flags: Flags,
  context: CommandContext & { repositoryGitCommand?: RepositoryGitCommand } = {},
): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const taskId = textFlag(flags, "task")!;
  const agent = textFlag(flags, "agent")!;
  const role = textFlag(flags, "role")!;
  if (!isAgentRole(role)) {
    throw new HarnessError("INVALID_ARGUMENT", `--role must be one of ${AGENT_ROLES.join(", ")}`);
  }

  const isOrchestrator =
    role === "orchestrator" ||
    role === "mind" ||
    role === "mind-auditor" ||
    /^orch/i.test(agent) ||
    /^mind/i.test(agent);
  const isCoordinator = role === "coordinator" || /^coord/i.test(agent);

  if (isOrchestrator || isCoordinator) {
    const roleTitle = isOrchestrator ? "Orchestrators" : "Coordinators";
    appendDefectLedgerRecord(join(run, "defects.jsonl"), {
      id: `defect-role-confinement-${Date.now()}-${agent}-${taskId}`,
      type: "role_confinement_violation",
      category: "role_boundary",
      actor: agent,
      role,
      task_id: taskId,
      timestamp: new Date().toISOString(),
      details: `${roleTitle} are mechanically confined from claiming code execution tasks.`,
    });
    if (isOrchestrator) {
      throw new HarnessError(
        "ROLE_CONFINEMENT_VIOLATION",
        "Orchestrators are mechanically confined from claiming code execution tasks. Dispatch Tier 3 Implementers via invoke_subagent.",
        [{ task_id: taskId, agent_id: agent, role }],
        3,
        "Dispatch Tier 3 Implementers via invoke_subagent.",
      );
    } else {
      throw new HarnessError(
        "ROLE_CONFINEMENT_VIOLATION",
        "Coordinators are mechanically confined from claiming code execution tasks. Dispatch Tier 3 Implementers via invoke_subagent.",
        [{ task_id: taskId, agent_id: agent, role }],
        3,
        "Dispatch Tier 3 Implementers via invoke_subagent.",
      );
    }
  }

  const isCriticOrValidator =
    role === "validator" ||
    role === "completeness-critic" ||
    role === "sub-validator" ||
    role === "plan-validator" ||
    /^val/i.test(agent) ||
    /^critic/i.test(agent);

  if (isCriticOrValidator) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `role '${role}' cannot claim code implementation tasks: critics and validators are strictly prohibited from claiming code write leases (anti-boundary-leak rule)`,
      [{ task_id: taskId, agent_id: agent, role }],
      3,
      "Delegate repair to an assigned implementer/repairer via task:assign-repairer.",
    );
  }
  const leaseSeconds =
    integerFlag(flags, "lease-duration", { minimum: 5, maximum: 86_400 }) ??
    integerFlag(flags, "lease-seconds", { minimum: 5, maximum: 86_400 });

  const repoRoot = findRepoRoot(run);
  const taskBeforeClaim = workflowPort(run).read().tasks[taskId];
  const writeScopeContentHash = taskBeforeClaim
    ? evidenced(
        hashWriteScope(writeScopeHashBase(run, taskId, repoRoot), taskBeforeClaim.write_scope),
        "harness_observed",
      )
    : undefined;
  const claimedBaseSha = claimedBaseShaAt(repoRoot, context.repositoryGitCommand);

  const result = claimTask(workflowPort(run), taskId, agent, role, {
    ...(leaseSeconds === undefined ? {} : { leaseSeconds }),
    ...(claimedBaseSha === undefined ? {} : { claimedBaseSha }),
    ...(writeScopeContentHash === undefined ? {} : { writeScopeContentHash }),
  });

  const task = result.state.tasks[taskId]!;
  const lease = task.lease;
  if (!lease)
    throw new HarnessError("INTEGRITY", `claim of ${taskId} left the task without a lease`);

  let published;
  try {
    published = await publishTaskRolePacket({
      runRoot: run,
      port: workflowPort(run),
      role,
      agentId: agent,
      attempt: lease.attempt,
      token: result.token,
      taskId,
    });
  } catch (publishErr) {
    // Compensation rollback: Release or revert un-packeted claim attempt so state is not orphaned
    try {
      workflowPort(run).transact(
        agent,
        "task-claim-aborted",
        { task_id: taskId, reason: "packet publication failure" },
        (draft) => {
          const rollbackTask = draft.tasks[taskId];
          if (rollbackTask && rollbackTask.lease?.token_digest === lease.token_digest) {
            delete rollbackTask.lease;
            const lastAttempt = rollbackTask.attempts.at(-1);
            if (lastAttempt && lastAttempt.attempt === lease.attempt) {
              rollbackTask.attempts.pop();
            }
            const repair = rollbackTask.history.some((h) => h.to === "changes_requested");
            rollbackTask.status = repair ? "changes_requested" : "ready";
          }
        },
      );
    } catch {
      // Best effort rollback
    }
    throw publishErr;
  }

  const worktree = assignedWorktreeForClaim(run, taskId);

  let markdown = formatTaskClaimBrief({
    taskId,
    agent,
    token: result.token,
    durationMinutes: Math.round(lease.duration_seconds / 60),
    writeScope: task.write_scope,
    worktreePath: worktree?.worktreePath,
  });

  try {
    const { buildExactAnchorBriefing } = await import("../../mind/proposals/builder/index.ts");
    const briefing = buildExactAnchorBriefing({
      taskId: task.id,
      label: typeof task.label === "string" ? task.label : task.id,
      writeScope: task.write_scope ?? [],
      targetFiles: [],
      targetSymbols: [],
      gateCommands: [],
      acceptanceCriteria: [],
      recommendedCommands: [],
      baseDir: repoRoot,
    });
    markdown += `\n\n${briefing.markdown}`;
  } catch (err) {
    console.error("ExactAnchorBriefing failed:", err);
  }

  const conflicts = probeAtTaskBoundary(run, agent, "task:claim");
  const quotaTelemetry = await probeLiveQuotaTelemetry({ host: detectHostApp(process.env) });

  if (quotaTelemetry.quotaBadge) {
    markdown += `\n- **Live Quota**: ${quotaTelemetry.quotaBadge} (${quotaTelemetry.activeHost})`;
  }
  if (quotaTelemetry.isTriggered) {
    markdown += `\n\n⚠️ **Quota Circuit Breaker Active**: Remaining quota (${quotaTelemetry.lowestQuotaPercentage !== null ? `${quotaTelemetry.lowestQuotaPercentage.toFixed(1)}%` : "unknown"}) <= ${quotaTelemetry.evaluation.thresholdPercentage}%. Wrap up current micro-step immediately.`;
  }

  return withHostTelemetryConflicts(
    {
      markdown,
      run_root: run,
      token: result.token,
      task,
      packet_id: published.record.id,
      packet_path: published.markdownPath,
      role_contract_sha256: published.packet.metadata.role_contract_sha256,
      quota_telemetry: quotaTelemetry,
      ...(worktree
        ? {
            worktree_path: worktree.worktreePath,
            worktree_id: worktree.worktreeId,
          }
        : {}),
    },
    conflicts,
  );
}

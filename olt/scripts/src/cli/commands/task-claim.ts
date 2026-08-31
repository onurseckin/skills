import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CommandRecord } from "../../core/contracts/index.ts";
import { AGENT_ROLES, isAgentRole } from "../../core/contracts/index.ts";
import { evidenced, type Evidenced } from "../../core/contracts/index.ts";
import { getHarnessConfig } from "../../core/config/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { appendDefectLedgerRecord } from "../../logging/defect-logger.ts";
import { readPlanObject } from "../../graph/read-plan.ts";
import { refreshHandoff } from "../../reporting/handoff.ts";
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
import { heartbeat } from "../../workflow/lease/heartbeat.ts";
import { tokenDigest } from "../../workflow/lease/token.ts";
import { hashWriteScope } from "../../workflow/lease/write-scope-hash.ts";
import { buildSubmissionReport } from "../../workflow/submission/build-report.ts";
import { observeChangedFiles } from "../../workflow/submission/observe-changes.ts";
import { submitTask } from "../../workflow/submission/submit.ts";
import type { TaskRecord } from "../../workflow/types.ts";
import { commitSubphase, recordWorktreeCommit } from "../../workflow/worktree/commit.ts";
import type { GitRunner } from "../../workflow/worktree/git.ts";
import { findAssignedWorktree, readWorktreeLedger } from "../../workflow/worktree/ledger.ts";
import {
  formatTaskClaimBrief,
  formatTaskHeartbeatBrief,
  formatTaskSubmitBrief,
} from "../formatters/index.ts";
import { probeLiveQuotaTelemetry } from "../../workflow/lifecycle/quota-lifecycle.ts";
import { detectHostApp } from "../../authority/thread/context.ts";
import { probeAgentTelemetry, withHostTelemetryConflicts } from "../host-telemetry-probe.ts";
import {
  boolFlag,
  integerFlag,
  listFlag,
  textFlag,
  type CommandContext,
  type Flags,
} from "../options.ts";

function commitSubphaseIfAssigned(
  run: string,
  agent: string,
  taskId: string,
  task: TaskRecord,
  runner?: GitRunner,
): { warning?: string } {
  const repoRoot = findRepoRoot(run);
  const config = getHarnessConfig(repoRoot, run);
  if (!config.worktree_isolation || !config.commit_per_subphase) return {};
  const ledger = readWorktreeLedger(loadRun(run).state);
  if (!ledger) return {};
  const assigned = findAssignedWorktree(ledger, taskId);
  if (!assigned) return {};
  const label = typeof task.label === "string" ? task.label : taskId;
  const outcome = commitSubphase({
    taskId,
    worktreeId: assigned.worktreeId,
    worktreePath: assigned.worktreePath,
    writeScope: task.write_scope,
    label,
    commitType: "chore",
    maxCommitLines: config.max_commit_lines,
    ...(runner === undefined ? {} : { runner }),
  });
  if (outcome.committed && outcome.commit) {
    recordWorktreeCommit(run, agent, taskId, outcome.commit);
    return outcome.warning === undefined ? {} : { warning: outcome.warning };
  }
  return {};
}

function assignedWorktreeForClaim(
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

function writeScopeHashBase(run: string, taskId: string, repoRoot: string): string {
  return assignedWorktreeForClaim(run, taskId)?.worktreePath ?? repoRoot;
}

const CLAIMED_BASE_SHA_MAX_BYTES = 1024;

function claimedBaseShaAt(
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

function probeAtTaskBoundary(
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
  context: CommandContext & {
    repositoryGitCommand?: RepositoryGitCommand;
  } = {},
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
    const defect = {
      type: "role_confinement_violation",
      category: "role_boundary",
      actor: agent,
      role,
      task_id: taskId,
      timestamp: new Date().toISOString(),
      details: `${roleTitle} are mechanically confined from claiming code execution tasks.`,
    };
    const defectsPath = join(run, "defects.jsonl");
    appendDefectLedgerRecord(defectsPath, {
      id: `defect-role-confinement-${Date.now()}-${agent}-${taskId}`,
      ...defect,
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
    const roleTitle = role === "completeness-critic" ? "Completeness critics" : "Validators";

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

  const published = await publishTaskRolePacket({
    runRoot: run,
    port: workflowPort(run),
    role,
    agentId: agent,
    attempt: lease.attempt,
    token: result.token,
    taskId,
  });

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
      targetFiles: [], // Let it derive from writeScope
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

export function taskHeartbeatCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const taskId = textFlag(flags, "task")!;
  const agent = textFlag(flags, "agent")!;
  const token = textFlag(flags, "token")!;

  const state = heartbeat(workflowPort(run), taskId, agent, token);
  const task = state.tasks[taskId]!;
  const lease = task.lease;
  if (!lease)
    throw new HarnessError("INTEGRITY", `heartbeat for ${taskId} left the task without a lease`);
  const markdown = formatTaskHeartbeatBrief({
    taskId,
    agent,
    extendedMinutes: Math.round(lease.duration_seconds / 60),
    newDeadline: lease.expires_at,
  });

  return { markdown, run_root: run, task };
}

export async function taskSubmitCommand(
  flags: Flags,
  context: CommandContext & { worktreeGitRunner?: GitRunner } = {},
): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const taskId = textFlag(flags, "task")!;
  const agent = textFlag(flags, "agent")!;
  const token = textFlag(flags, "token")!;
  const summary = textFlag(flags, "summary", false);
  const reportFile = textFlag(flags, "report", false);
  const declaredFiles = listFlag(flags, "files-changed");
  const declaredCommandIds = listFlag(flags, "evidence");
  const noOp = boolFlag(flags, "no-op");
  const noOpReason = textFlag(flags, "reason", false);
  if (noOp && noOpReason === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      '--no-op requires --reason "<why this needed no change>"',
    );
  }
  if (!noOp && noOpReason !== undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "--reason only applies together with --no-op");
  }

  const loaded = loadRun(run);
  const allTasks = (loaded.state.tasks ?? {}) as Record<string, TaskRecord>;
  const taskBefore = allTasks[taskId];
  if (!taskBefore) throw new HarnessError("INVALID_ARGUMENT", `unknown task ${taskId}`);

  if (reportFile !== undefined && (declaredFiles || declaredCommandIds || summary !== undefined)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--report carries the whole submission; it cannot be combined with --files-changed, --evidence or --summary",
    );
  }
  if (reportFile === undefined && summary === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--summary is required: state what this task changed, or pass --report with a summary inside it",
    );
  }

  const reportPayload =
    reportFile !== undefined
      ? await readPlanObject(reportFile, "task submission report")
      : buildSubmissionReport({
          task: taskBefore,
          agentId: agent,
          summary: summary!,
          declaredFiles,
          declaredCommandIds,
          observedFiles: observeChangedFiles(findRepoRoot(loaded.runRoot)),
          commands: (loaded.state.commands ?? {}) as Record<string, CommandRecord>,
          allowEmptyFiles: noOp,
        });

  const submitRepoRoot = findRepoRoot(run);
  const currentWriteScopeContentHash = evidenced(
    hashWriteScope(writeScopeHashBase(run, taskId, submitRepoRoot), taskBefore.write_scope),
    "harness_observed",
  );

  const result = submitTask(workflowPort(run), taskId, agent, token, reportPayload, undefined, {
    currentWriteScopeContentHash,
    ...(noOp ? { noOp: { reason: noOpReason! } } : {}),
  });
  const task = result.state.tasks[taskId]!;
  const reportPath = `${run}/reports/${taskId}-submission.json`;
  const recordedReport = task.report ?? reportPayload;

  const worktreeCommit = result.orphaned
    ? {}
    : commitSubphaseIfAssigned(run, agent, taskId, task, context.worktreeGitRunner);

  const reportsDir = join(loaded.runRoot, "reports");
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(
    join(reportsDir, `${taskId}-submission.json`),
    JSON.stringify(
      {
        task_id: taskId,
        agent,
        token_digest: tokenDigest(token),
        summary: recordedReport.summary,
        created_at: new Date().toISOString(),
        report: recordedReport,
        task,
      },
      null,
      2,
    ),
    "utf-8",
  );

  const quotaTelemetry = await probeLiveQuotaTelemetry({ host: detectHostApp(process.env) });

  let markdown = formatTaskSubmitBrief({
    taskId,
    agent,
    filesTouchedCount: (recordedReport.files_changed as string[]).length,
    writeScope: task.write_scope,
    reportPath,
  });

  if (quotaTelemetry.quotaBadge) {
    markdown += `\n- **Live Quota**: ${quotaTelemetry.quotaBadge} (${quotaTelemetry.activeHost})`;
  }

  const handoffPath = refreshHandoff(run);
  const conflicts = probeAtTaskBoundary(run, agent, "task:submit");

  return withHostTelemetryConflicts(
    {
      markdown,
      run_root: run,
      orphaned: result.orphaned,
      task,
      report_path: reportPath,
      quota_telemetry: quotaTelemetry,
      ...(handoffPath === undefined ? {} : { handoff_path: handoffPath }),
      ...(worktreeCommit.warning === undefined
        ? {}
        : { worktree_commit_warning: worktreeCommit.warning }),
    },
    conflicts,
  );
}

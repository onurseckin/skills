import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CommandRecord } from "../../contracts/commands.ts";
import { AGENT_ROLES, isAgentRole } from "../../contracts/packets.ts";
import { evidenced, type Evidenced } from "../../contracts/evidence.ts";
import { getHarnessConfig } from "../../config/harness-config.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { readPlanObject } from "../../graph/read-plan.ts";
import { refreshHandoff } from "../../reporting/handoff.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import {
  repositoryGit,
  type RepositoryGitCommand,
} from "../../packets/repository-git-command.ts";
import { hasRepositoryGitMetadata } from "../../packets/repository-git-metadata.ts";
import { publishTaskRolePacket } from "../../packets/role-grant.ts";
import { loadRun } from "../../store/index.ts";
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
  const repoRoot = resolve(run, "..", "..");
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
  const repoRoot = resolve(run, "..", "..");
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
  context: CommandContext & { repositoryGitCommand?: RepositoryGitCommand } = {},
): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const taskId = textFlag(flags, "task")!;
  const agent = textFlag(flags, "agent")!;
  const role = textFlag(flags, "role")!;
  if (!isAgentRole(role)) {
    throw new HarnessError("INVALID_ARGUMENT", `--role must be one of ${AGENT_ROLES.join(", ")}`);
  }
  const leaseSeconds =
    integerFlag(flags, "lease-duration", { minimum: 5, maximum: 86_400 }) ??
    integerFlag(flags, "lease-seconds", { minimum: 5, maximum: 86_400 });

  const repoRoot = resolve(run, "..", "..");
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

  const markdown = formatTaskClaimBrief({
    taskId,
    agent,
    token: result.token,
    durationMinutes: Math.round(lease.duration_seconds / 60),
    writeScope: task.write_scope,
    worktreePath: worktree?.worktreePath,
  });

  const conflicts = probeAtTaskBoundary(run, agent, "task:claim");

  return withHostTelemetryConflicts(
    {
      markdown,
      run_root: run,
      token: result.token,
      task,
      packet_id: published.record.id,
      packet_path: published.markdownPath,
      role_contract_sha256: published.packet.metadata.role_contract_sha256,
      ...(worktree
        ? { worktree_path: worktree.worktreePath, worktree_id: worktree.worktreeId }
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
          observedFiles: observeChangedFiles(dirname(dirname(loaded.runRoot))),
          commands: (loaded.state.commands ?? {}) as Record<string, CommandRecord>,
          allowEmptyFiles: noOp,
        });

  const submitRepoRoot = resolve(run, "..", "..");
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

  const markdown = formatTaskSubmitBrief({
    taskId,
    agent,
    filesTouchedCount: (recordedReport.files_changed as string[]).length,
    writeScope: task.write_scope,
    reportPath,
  });

  const handoffPath = refreshHandoff(run);
  const conflicts = probeAtTaskBoundary(run, agent, "task:submit");

  return withHostTelemetryConflicts(
    {
      markdown,
      run_root: run,
      orphaned: result.orphaned,
      task,
      report_path: reportPath,
      ...(handoffPath === undefined ? {} : { handoff_path: handoffPath }),
      ...(worktreeCommit.warning === undefined
        ? {}
        : { worktree_commit_warning: worktreeCommit.warning }),
    },
    conflicts,
  );
}

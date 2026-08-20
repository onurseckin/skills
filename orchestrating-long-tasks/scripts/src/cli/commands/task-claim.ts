import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CommandRecord } from "../../contracts/commands.ts";
import { AGENT_ROLES, isAgentRole } from "../../contracts/packets.ts";
import { getHarnessConfig } from "../../config/harness-config.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { readPlanObject } from "../../graph/read-plan.ts";
import { refreshHandoff } from "../../reporting/handoff.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { publishTaskRolePacket } from "../../packets/role-grant.ts";
import { loadRun } from "../../store/index.ts";
import {
  refreshAgentDerivedTelemetry,
  type TelemetryFieldConflict,
} from "../../workflow/agents/grants.ts";
import { claimTask } from "../../workflow/lease/claim.ts";
import { heartbeat } from "../../workflow/lease/heartbeat.ts";
import { tokenDigest } from "../../workflow/lease/token.ts";
import { buildSubmissionReport } from "../../workflow/submission/build-report.ts";
import { observeChangedFiles } from "../../workflow/submission/observe-changes.ts";
import { submitTask } from "../../workflow/submission/submit.ts";
import type { TaskRecord } from "../../workflow/types.ts";
import { commitSubphase, recordWorktreeCommit } from "../../workflow/worktree/commit.ts";
import { findAssignedWorktree, readWorktreeLedger } from "../../workflow/worktree/ledger.ts";
import {
  formatTaskClaimBrief,
  formatTaskHeartbeatBrief,
  formatTaskSubmitBrief,
} from "../formatters/index.ts";
import { probeAgentTelemetry, withHostTelemetryConflicts } from "../host-telemetry-probe.ts";
import { integerFlag, listFlag, textFlag, type Flags } from "../options.ts";

/**
 * B22.3: commits the task's write scope in its assigned worktree once a submission is accepted.
 * A no-op whenever worktree isolation is off (the default), the run was never provisioned, this
 * task drew no worktree assignment, or the submission was orphan evidence rather than a real
 * acceptance — none of those are errors, just nothing for this step to do.
 */
function commitSubphaseIfAssigned(
  run: string,
  agent: string,
  taskId: string,
  task: TaskRecord,
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
    // Nothing on TaskRecord declares a task's change type yet (see commitSubphase's own doc
    // comment), so this call site states its interim policy explicitly rather than leaning on a
    // library default: every harness-made commit reads "chore:" until that gap is closed.
    commitType: "chore",
    maxCommitLines: config.max_commit_lines,
  });
  if (outcome.committed && outcome.commit) {
    recordWorktreeCommit(run, agent, taskId, outcome.commit);
    return outcome.warning === undefined ? {} : { warning: outcome.warning };
  }
  return {};
}

/**
 * B22.2's worktree assignment only isolates anything if the claiming agent learns about it. Without
 * this, an agent under worktree isolation has no way to discover which directory to actually work
 * in and would silently edit the shared repo checkout instead — defeating B22.1's whole point that
 * "the user's working tree and branch are never touched." A no-op (returns `undefined`) whenever
 * isolation is off, the run was never provisioned, or this task drew no assignment.
 */
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

/**
 * The probe hardcoded into `task:claim` and `task:submit`: it only ever touches an agent that
 * already holds an active grant, so a run that never calls `agent:register` sees no change here at
 * all — this never becomes a second way to register one.
 */
function probeAtTaskBoundary(run: string, agent: string, boundary: string): TelemetryFieldConflict[] {
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

export async function taskClaimCommand(flags: Flags): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const taskId = textFlag(flags, "task")!;
  const agent = textFlag(flags, "agent")!;
  // The role is a capability contract, not a formality: defaulting it would bind an agent to a
  // contract nobody chose for it.
  const role = textFlag(flags, "role")!;
  if (!isAgentRole(role)) {
    throw new HarnessError("INVALID_ARGUMENT", `--role must be one of ${AGENT_ROLES.join(", ")}`);
  }
  const leaseSeconds =
    integerFlag(flags, "lease-duration", { minimum: 5, maximum: 86_400 }) ??
    integerFlag(flags, "lease-seconds", { minimum: 5, maximum: 86_400 });

  const result = claimTask(
    workflowPort(run),
    taskId,
    agent,
    role,
    leaseSeconds === undefined ? {} : { leaseSeconds },
  );

  const task = result.state.tasks[taskId]!;
  const lease = task.lease;
  if (!lease)
    throw new HarnessError("INTEGRITY", `claim of ${taskId} left the task without a lease`);

  // The lease is the authority; the packet is the contract that authority is bounded by. They are
  // handed over together so no agent can hold one without the other.
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
    // The lease the transaction actually recorded, not the one the flags asked for.
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
  // --extend is range-checked here, but the renewal length is the lease's own recorded duration:
  // the brief reports the extension the lease actually received, never the one that was asked for.
  integerFlag(flags, "extend", { minimum: 60, maximum: 86_400 });

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

export async function taskSubmitCommand(flags: Flags): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const taskId = textFlag(flags, "task")!;
  const agent = textFlag(flags, "agent")!;
  const token = textFlag(flags, "token")!;
  const summary = textFlag(flags, "summary", false);
  const reportFile = textFlag(flags, "report", false);
  const declaredFiles = listFlag(flags, "files-changed");
  const declaredCommandIds = listFlag(flags, "evidence");

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
  // The summary is the agent's own account of what it changed. There is no honest stand-in for it,
  // so an absent summary is refused instead of filled with a sentence the agent never wrote.
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
        });

  const result = submitTask(workflowPort(run), taskId, agent, token, reportPayload);
  const task = result.state.tasks[taskId]!;
  const reportPath = `${run}/reports/${taskId}-submission.json`;
  const recordedReport = task.report ?? reportPayload;

  // Orphan evidence is a dead agent's leftovers, not an accepted change: nothing to commit yet, the
  // task is still open for whoever actually claims and finishes it.
  const worktreeCommit = result.orphaned ? {} : commitSubphaseIfAssigned(run, agent, taskId, task);

  const reportsDir = join(loaded.runRoot, "reports");
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(
    join(reportsDir, `${taskId}-submission.json`),
    JSON.stringify(
      {
        task_id: taskId,
        agent,
        // The bearer token never reaches disk; verification compares digests, so a digest is all a
        // reader of this capsule needs to tie the report to the lease.
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

  // A submission is the point where the work leaves one agent's head, so the restart document is
  // rewritten here: whatever happens to that agent next, the run is resumable from the capsule.
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
      ...(worktreeCommit.warning === undefined ? {} : { worktree_commit_warning: worktreeCommit.warning }),
    },
    conflicts,
  );
}

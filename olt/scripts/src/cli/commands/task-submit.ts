import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandRecord } from "../../core/contracts/index.ts";
import { evidenced } from "../../core/contracts/index.ts";
import { getHarnessConfig } from "../../core/config/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { readPlanObject } from "../../graph/read-plan.ts";
import { refreshHandoff } from "../../reporting/handoff.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { loadRun } from "../../engine/store/index.ts";
import { tokenDigest } from "../../workflow/lease/token.ts";
import { hashWriteScope } from "../../workflow/lease/write-scope-hash.ts";
import { buildSubmissionReport } from "../../workflow/submission/build-report.ts";
import { observeChangedFiles } from "../../workflow/submission/observe-changes.ts";
import { submitTask } from "../../workflow/submission/submit.ts";
import type { TaskRecord } from "../../workflow/types.ts";
import { commitSubphase, recordWorktreeCommit } from "../../workflow/worktree/commit.ts";
import type { GitRunner } from "../../workflow/worktree/git.ts";
import { findAssignedWorktree, readWorktreeLedger } from "../../workflow/worktree/ledger.ts";
import { formatTaskSubmitBrief } from "../formatters/index.ts";
import { probeLiveQuotaTelemetry } from "../../workflow/lifecycle/quota-lifecycle.ts";
import { detectHostApp } from "../../authority/thread/context.ts";
import { withHostTelemetryConflicts } from "../host-telemetry-probe.ts";
import { probeAtTaskBoundary, writeScopeHashBase } from "./task-claim.ts";
import { boolFlag, listFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

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

  // Phase 1 (Stage): Build and prepare report payload prior to state transaction
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

  // Pre-create reports staging directory so disk writes cannot fail on missing parent dir
  const reportsDir = join(loaded.runRoot, "reports");
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, `${taskId}-submission.json`);

  // Phase 2 (Commit): State mutation transaction
  const result = submitTask(workflowPort(run), taskId, agent, token, reportPayload, undefined, {
    currentWriteScopeContentHash,
    ...(noOp ? { noOp: { reason: noOpReason! } } : {}),
  });
  const task = result.state.tasks[taskId]!;
  const recordedReport = task.report ?? reportPayload;

  const worktreeCommit = result.orphaned
    ? {}
    : commitSubphaseIfAssigned(run, agent, taskId, task, context.worktreeGitRunner);

  try {
    writeFileSync(
      reportPath,
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
  } catch (err) {
    console.error(`Warning: Failed to write submission report to ${reportPath}:`, err);
  }

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

import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { JsonObject } from "../../contracts/json.ts";
import { getHarnessConfig } from "../../config/harness-config.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { runAndRecordCommand } from "../../integration/record-command.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { inspectRepositoryBinding } from "../../packets/repository-identity.ts";
import { verifyCommandRecord } from "../../runner/verify-command.ts";
import { loadRun } from "../../store/index.ts";
import { completeRun } from "../../workflow/completion/complete-run.ts";
import { gateTally } from "../../workflow/completion/completion-state.ts";
import type { CompletionArtifactRequirements } from "../../workflow/completion/artifact-verification.ts";
import type { TaskRecord, WorkflowState } from "../../workflow/types.ts";
import { consolidateWorktrees, recordConsolidation } from "../../workflow/worktree/consolidate.ts";
import { readWorktreeLedger } from "../../workflow/worktree/ledger.ts";
import type { WorktreeConsolidationRecord } from "../../contracts/worktree.ts";
import {
  formatRunCompleteBrief,
  formatRunExecBrief,
  formatRunStatusBrief,
} from "../formatters/index.ts";
import { boolFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import { declaredToolFlags } from "../taxonomy-flags.ts";
import { generateSummarySuite } from "../../summary/generate-summary.ts";
import { ingestBrowserRun } from "../../reporting/browser-run-ingestion.ts";
import { refreshHandoff } from "../../reporting/handoff.ts";
import { ingestScreenshots, ingestVisualReport } from "../../reporting/screenshot-ingestion.ts";
import { commandEvidenceView, commandRecordPath } from "../../reporting/command-evidence.ts";
import { capsuleCatalogue, runStatus, type CapsuleCatalogue } from "../../reporting/status.ts";

function occupancyCeilings(runRoot: string): { maxParallel: number; gateMaxParallel: number } {
  const config = getHarnessConfig(resolve(runRoot, "..", ".."), runRoot);
  return { maxParallel: config.default_max_parallel, gateMaxParallel: config.gate_max_parallel };
}

function liveRepositoryBinding(run: string) {
  const repository = dirname(dirname(loadRun(run).runRoot));
  return inspectRepositoryBinding(repository);
}

function verifyCompletionArtifacts(
  run: string,
  state: Readonly<WorkflowState>,
  requirements: CompletionArtifactRequirements,
) {
  const issues: string[] = [];
  for (const id of requirements.command_ids) {
    const command = state.commands[id];
    if (!command) issues.push(`command ${id}: missing durable command record`);
    else
      issues.push(...verifyCommandRecord(run, command).map((issue) => `command ${id}: ${issue}`));
  }
  if (issues.length > 0) {
    throw new HarnessError(
      "INTEGRITY",
      `completion artifact verification failed: ${issues.join("; ")}`,
    );
  }
  return {
    verified_at: new Date().toISOString(),
    command_ids: requirements.command_ids,
    packets: requirements.packets ?? [],
    repository_binding: liveRepositoryBinding(run),
  };
}

function consolidateIfProvisioned(
  run: string,
  actor: string,
): WorktreeConsolidationRecord | undefined {
  const repoRoot = resolve(run, "..", "..");
  const config = getHarnessConfig(repoRoot, run);
  if (!config.worktree_isolation) return undefined;
  const ledger = readWorktreeLedger(loadRun(run).state);
  if (!ledger || ledger.consolidation !== undefined) return undefined;
  const result = consolidateWorktrees({
    repoRoot,
    runId: basename(run),
    ledger,
    rebaseOnComplete: config.rebase_on_complete,
  });
  recordConsolidation(run, actor, result);
  return result;
}

export function runCompleteCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const actor = textFlag(flags, "actor")!;
  const authToken = textFlag(flags, "auth-token")!;

  const consolidation = consolidateIfProvisioned(run, actor);

  const state = completeRun(
    workflowPort(run),
    actor,
    (lockedState, requirements) => verifyCompletionArtifacts(run, lockedState, requirements),
    authToken,
  );

  try {
    generateSummarySuite({ capsulePath: run, writeToDisk: true });
  } catch {}

  const handoffPath = refreshHandoff(run);

  const tasks = Object.values(state.tasks);
  const gates = gateTally(state);
  const markdown = formatRunCompleteBrief({
    runId: basename(run),
    capsulePath: run,
    tasksCount: tasks.length,
    validationsCount: tasks.filter((t) => t.status === "done").length,
    gatesPassed: gates.green,
    totalGates: gates.total,
    ...(consolidation === undefined
      ? {}
      : {
          worktreeConsolidation: {
            branch: consolidation.harness_branch,
            commitCount: consolidation.commit_count,
            rebased: consolidation.rebased,
            diffstat: consolidation.diffstat,
            conflicted:
              consolidation.merge_conflict !== undefined ||
              consolidation.rebase_conflict_paths !== undefined,
          },
        }),
  });

  return {
    markdown,
    run_root: run,
    completion: state.completion_result,
    ...(handoffPath === undefined ? {} : { handoff_path: handoffPath }),
    ...(consolidation === undefined ? {} : { worktree_consolidation: consolidation }),
  };
}

export function runStatusCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const detailed = boolFlag(flags, "detailed");

  const loaded = loadRun(run);
  const state = loaded.state;
  const tasks = Object.values((state.tasks ?? {}) as Record<string, TaskRecord>);

  const taskItems = tasks.map((t) => {
    let agentOrLock = "-";
    if (t.lease) agentOrLock = `Leased (${t.lease.agent_id})`;
    else if (t.validations && t.validations.length > 0)
      agentOrLock = `Validating (${t.validations.map((v) => v.validator_id).join(", ")})`;
    else if (t.status === "done") agentOrLock = "Completed";

    let statusEmoji = "⚪ Unknown";
    if (t.status === "done") statusEmoji = "✅ Satisfied";
    else if (t.status === "leased" || t.status === "running") statusEmoji = "🏃 Leased";
    else if (t.status === "validating") statusEmoji = "🔄 Validating";
    else if (t.status === "ready") statusEmoji = "🟢 Ready";
    else if (t.status === "proposed") statusEmoji = "⏳ Blocked";
    else if (t.status === "changes_requested") statusEmoji = "🛠️ Repair";

    return {
      id: t.id,
      label: (t.label as string | undefined) ?? t.id,
      writeScope: t.write_scope,
      status: statusEmoji,
      agentOrLock,
    };
  });

  const satCount = tasks.filter((t) => t.status === "done").length;
  const valCount = tasks.filter((t) => t.status === "validating").length;
  const leasedCount = tasks.filter((t) => t.status === "leased").length;
  const blockedCount = tasks.filter((t) => t.status === "proposed").length;
  const progressSummary = `${satCount}/${tasks.length} Satisfied, ${valCount} Validating, ${leasedCount} Leased, ${blockedCount} Blocked.`;

  const completionResult = state.completion_result as { status: string } | undefined;
  const phase =
    completionResult?.status === "complete" ? "Completed" : state.graph ? "Executing" : "Planning";
  const catalogue = capsuleCatalogue(loaded.runRoot);
  const activeCount = tasks.filter(
    (t) => t.status === "leased" || t.status === "running" || t.status === "validating",
  ).length;
  const { maxParallel, gateMaxParallel } = occupancyCeilings(loaded.runRoot);
  const occupancySummary = `${activeCount}/${maxParallel} occupancy slots in use (gate ceiling ${gateMaxParallel}).`;
  const markdown = formatRunStatusBrief(
    basename(run),
    phase,
    taskItems,
    progressSummary,
    catalogueSummary(catalogue),
    occupancySummary,
  );

  return {
    markdown,
    run_root: run,
    state: runStatus(run),
    detailed,
    catalogue,
    occupancy: {
      active: activeCount,
      max_parallel: maxParallel,
      gate_max_parallel: gateMaxParallel,
    },
    ...(readWorktreeLedger(state) === null ? {} : { worktrees: readWorktreeLedger(state) }),
  };
}

function catalogueSummary(catalogue: CapsuleCatalogue): string {
  if (!catalogue.available || catalogue.counts === undefined)
    return "catalogue unreadable (index.json); counts unknown";
  const { commands, captures, blobs, open_findings } = catalogue.counts;
  const bytes = catalogue.stored_bytes === undefined ? "unknown" : `${catalogue.stored_bytes} B`;
  return `${commands} commands, ${captures} captures over ${blobs} blobs (${bytes}), ${open_findings} open findings — index ${catalogue.freshness}`;
}

export async function runExecCommand(
  flags: Flags,
  _context: CommandContext,
  argv: readonly string[],
): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const task = textFlag(flags, "task", false);
  const gate = textFlag(flags, "gate", false);
  const rawCwd = textFlag(flags, "cwd", false);
  const actor = textFlag(flags, "actor")!;
  const loaded = loadRun(run);
  const repoRoot = dirname(dirname(loaded.runRoot));
  const cwd = rawCwd
    ? isAbsolute(rawCwd)
      ? realpathSync(rawCwd)
      : resolve(repoRoot, rawCwd)
    : repoRoot;

  const declared = declaredToolFlags(flags);
  const commandDir = `${loaded.runRoot}/commands`;
  const cmdOpts = {
    runRoot: loaded.runRoot,
    commandDir,
    cwd,
    actor,
    argv: [...argv],
    ...(task ? { taskId: task } : {}),
    ...(gate ? { gateId: gate } : {}),
    ...declared,
  };
  const result = await runAndRecordCommand(loaded.runRoot, cmdOpts);

  const record = result.record;
  const commandStr = argv.join(" ");
  const exitCode = record.exit_code;
  const durationMs =
    record.started_at && record.finished_at
      ? Math.max(0, Date.parse(record.finished_at) - Date.parse(record.started_at))
      : undefined;
  const durationSec = durationMs === undefined ? undefined : durationMs / 1000;
  const outputSummary =
    exitCode === null
      ? "Command produced no exit code"
      : exitCode === 0
        ? "Command completed successfully"
        : "Command returned non-zero exit code";

  let stdoutStr = "";
  let stderrStr = "";
  const lastAttempt = result.attempts?.at(-1);
  if (lastAttempt) {
    try {
      if (lastAttempt.stdoutPath) {
        stdoutStr = readFileSync(lastAttempt.stdoutPath, "utf-8");
      }
    } catch {}
    try {
      if (lastAttempt.stderrPath) {
        stderrStr = readFileSync(lastAttempt.stderrPath, "utf-8");
      }
    } catch {}
  }

  ingestScreenshots({
    runRoot: loaded.runRoot,
    commandId: record.id,
    taskId: task ?? record.task_id ?? undefined,
    actor,
    searchDirs: [cwd, repoRoot],
    stdout: stdoutStr,
    stderr: stderrStr,
    startedAt: record.started_at,
  });

  const visualReport = ingestVisualReport({
    runRoot: loaded.runRoot,
    commandId: record.id,
    taskId: task ?? record.task_id ?? undefined,
    actor,
    searchDirs: [cwd, repoRoot],
    stdout: stdoutStr,
    stderr: stderrStr,
    startedAt: record.started_at,
  });

  const browserRun = ingestBrowserRun({
    runRoot: loaded.runRoot,
    commandId: record.id,
    taskId: task ?? record.task_id ?? undefined,
    actor,
    searchDirs: [cwd, repoRoot],
    stdout: stdoutStr,
    stderr: stderrStr,
    startedAt: record.started_at,
    finishedAt: record.finished_at,
    exitCode,
  });

  const evidencePayload = commandEvidenceView(
    loaded.runRoot,
    record as unknown as JsonObject,
    record.id,
  );
  const evidencePath = join(loaded.runRoot, commandRecordPath(record.id));
  const screenshotPaths = evidencePayload.screenshots as string[];

  const markdown = formatRunExecBrief({
    commandStr,
    exitCode,
    ...(durationSec === undefined ? {} : { durationSeconds: durationSec }),
    outputSummary,
    evidencePath: `${run}/${commandRecordPath(record.id)}`,
    logPath: result.recordPath,
  });

  return {
    markdown,
    run_root: run,
    command: record,
    command_id: record.id,
    exit_code: exitCode,
    evidence_path: evidencePath,
    evidence: evidencePayload,
    screenshots: screenshotPaths,
    screenshot_records: evidencePayload.screenshot_records,
    ...(visualReport ? { visual_report: visualReport } : {}),
    ...(browserRun ? { browser_run: browserRun } : {}),
    ...result,
  };
}

import { executePhaseCompletionSyncAndCommit } from "../../workflow/completion/auto-sync-and-commit.ts";
import { readAgentMetadata } from "../../runtime/agent-metadata.ts";
import { verifyCommandAuthorization } from "../../policy/rbac-engine.ts";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { JsonObject } from "../../core/contracts/json.ts";
import { getHarnessConfig } from "../../core/config/harness-config.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { runAndRecordCommand } from "../../integration/record-command.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { inspectRepositoryBinding } from "../../packets/repository-identity.ts";
import { verifyCommandRecord } from "../../engine/runner/verify-command.ts";
import { loadRun } from "../../engine/store/index.ts";
import {
  archiveCapsule,
  consolidateCapsules,
  pruneCapsuleBoilerplate,
} from "../../mind/archival.ts";
import { drainBacklogOnRunCompletion } from "../../mind/smart-task-manager.ts";
import { completeRun } from "../../workflow/completion/complete-run.ts";
import { gateTally } from "../../workflow/completion/completion-state.ts";
import type { CompletionArtifactRequirements } from "../../workflow/completion/artifact-verification.ts";
import { findRepoRoot, resolveCapsulesDir } from "../../core/shared/paths.ts";
import type { TaskRecord, WorkflowState } from "../../workflow/types.ts";
import { consolidateWorktrees, recordConsolidation } from "../../workflow/worktree/consolidate.ts";
import { readWorktreeLedger } from "../../workflow/worktree/ledger.ts";
import type { WorktreeConsolidationRecord } from "../../core/contracts/worktree.ts";
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
import type { ScreenshotRecord } from "../../reporting/screenshot-types.ts";
import { capsuleCatalogue, runStatus, type CapsuleCatalogue } from "../../reporting/status.ts";
import { extractLeaseAgentId, generateUnifiedReport } from "../../reporting/unified.ts";
import { resolveCapsuleRun } from "./dag-view.ts";

function occupancyCeilings(runRoot: string): { maxParallel: number; gateMaxParallel: number } {
  const config = getHarnessConfig(resolve(runRoot, "..", ".."), runRoot);
  return { maxParallel: config.default_max_parallel, gateMaxParallel: config.gate_max_parallel };
}

function liveRepositoryBinding(run: string) {
  const loaded = loadRun(run);
  const runRoot = loaded?.runRoot ?? run;
  const repository = findRepoRoot(runRoot);
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

  let summaryWarning: string | undefined;
  try {
    generateSummarySuite({ capsulePath: run, writeToDisk: true });
  } catch (error) {
    summaryWarning = error instanceof Error ? error.message : String(error);
  }

  const handoffPath = refreshHandoff(run);

  const tasks = Object.values(state.tasks);
  const gates = gateTally(state);

  // Automatically drain processed/completed backlog items into completed archive ledger
  try {
    const repoRoot = findRepoRoot(run);
    const completedTaskIds = tasks.filter((t) => t.status === "done").map((t) => t.id);
    drainBacklogOnRunCompletion({
      runId: basename(run),
      completedTasks: completedTaskIds,
      repoRoot,
    });
  } catch {
    // Non-blocking
  }

  // Execute automatic local skill sync, git commit, and git push on run completion
  let autoSyncCommitResult: unknown;
  try {
    const repoRoot = findRepoRoot(run);
    autoSyncCommitResult = executePhaseCompletionSyncAndCommit({
      phaseName: "run:complete",
      runId: basename(run),
      repoRoot,
    });
  } catch (err) {
    // Non-blocking
  }

  let prunedSubdirectories: readonly string[] = [];
  try {
    const pruneRes = pruneCapsuleBoilerplate(run);
    prunedSubdirectories = pruneRes.prunedDirectories;
  } catch {
    // Non-blocking
  }

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
    ...(summaryWarning === undefined ? {} : { summary_warning: summaryWarning }),
    ...(autoSyncCommitResult === undefined ? {} : { auto_sync_commit: autoSyncCommitResult }),
    ...(prunedSubdirectories.length > 0 ? { pruned_subdirectories: prunedSubdirectories } : {}),
  };
}

export function runConsolidateCommand(flags: Flags): Record<string, unknown> {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const capsulesDir = textFlag(flags, "capsules-dir", false) ?? resolveCapsulesDir(repo);
  const dryRun = boolFlag(flags, "dry-run");
  const result = consolidateCapsules(capsulesDir, { dryRun });
  return {
    markdown: `### Capsule Consolidation Complete\n- **Active Capsules**: ${result.activeCapsules.length}\n- **Archived Capsules**: ${result.archivedCapsules.length}\n- **Pruned Subdirectories**: ${result.prunedSubdirectoriesCount}\n- **Archive Directory**: \`${result.archiveDir}\``,
    ...result,
  };
}

export function runArchiveCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const dryRun = boolFlag(flags, "dry-run");
  const result = archiveCapsule(run, { dryRun });
  return {
    markdown: `### Capsule Archived: \`${result.runId}\`\n- **Source**: \`${result.sourcePath}\`\n- **Archived**: \`${result.archivedPath}\`\n- **Pruned Subdirectories**: ${result.prunedDirectories.length}`,
    ...result,
  };
}

export function runStatusCommand(flags: Flags): Record<string, unknown> {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const runFlag = textFlag(flags, "run", false);
  const runIdFlag = textFlag(flags, "run-id", false);
  const detailed = boolFlag(flags, "detailed");

  const run = resolveCapsuleRun(repo, runFlag, runIdFlag);
  const loaded = loadRun(run);
  const state = loaded.state;
  const tasks = Object.values((state.tasks ?? {}) as Record<string, TaskRecord>);

  const taskItems = tasks.map((t) => {
    let agentOrLock = "-";
    if (t.lease) {
      const leaseAgent = extractLeaseAgentId(t.lease) || "unknown";
      const roleStr =
        typeof t.lease.role === "string" && t.lease.role.length > 0 ? ` [${t.lease.role}]` : "";
      agentOrLock = `Leased (${leaseAgent}${roleStr})`;
    } else if (t.validations && t.validations.length > 0) {
      const activeVals = t.validations.filter((v) => v.verdict === undefined);
      if (activeVals.length > 0) {
        agentOrLock = `Validating (${activeVals.map((v) => `${v.validator_id} [${v.domain}]`).join(", ")})`;
      } else {
        agentOrLock = `Validated (${t.validations.map((v) => v.validator_id).join(", ")})`;
      }
    } else if (t.status === "validating") {
      agentOrLock = "Validating (Pending Probe)";
    } else if (t.status === "done") {
      agentOrLock = "Completed";
    } else if (t.status === "submitted") {
      agentOrLock = `Submitted (${t.original_implementer ?? "implementer"})`;
    } else if (t.status === "ready") {
      agentOrLock = "Standby (Ready)";
    } else if (t.status === "proposed") {
      agentOrLock = "Blocked (Prereqs)";
    } else if (t.status === "changes_requested") {
      agentOrLock = "Repair Required";
    }

    let statusEmoji = "⚪ Unknown";
    if (t.status === "done") statusEmoji = "✅ Satisfied";
    else if (t.status === "submitted") statusEmoji = "📦 Submitted";
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
  const leasedCount = tasks.filter((t) => t.status === "leased" || t.status === "running").length;
  const readyCount = tasks.filter((t) => t.status === "ready").length;
  const blockedCount = tasks.filter((t) => t.status === "proposed").length;
  const repairCount = tasks.filter((t) => t.status === "changes_requested").length;
  const progressSummary = `${satCount}/${tasks.length} Satisfied, ${valCount} Validating, ${leasedCount} Leased (Coding), ${readyCount} Standby (Ready), ${blockedCount} Blocked${repairCount > 0 ? `, ${repairCount} Repair` : ""}.`;

  const completionResult = state.completion_result as { status: string } | undefined;
  const phase =
    completionResult?.status === "complete" ? "Completed" : state.graph ? "Executing" : "Planning";
  const actualRunRoot = loaded?.runRoot ?? run;
  const catalogue = capsuleCatalogue(actualRunRoot);
  const activeCount = leasedCount + valCount;
  const { maxParallel, gateMaxParallel } = occupancyCeilings(actualRunRoot);
  const occupancySummary = `${leasedCount} Implementer(s) coding, ${valCount} Validator(s) testing/probing, ${readyCount} Standby ready | ${activeCount}/${maxParallel} active slots (gate ceiling ${gateMaxParallel}).`;
  const markdown = formatRunStatusBrief(
    basename(run),
    phase,
    taskItems,
    progressSummary,
    catalogueSummary(catalogue),
    occupancySummary,
  );

  let unified: ReturnType<typeof generateUnifiedReport> | undefined;
  try {
    unified = generateUnifiedReport(actualRunRoot, { detailed });
  } catch {
    // Non-blocking fallback
  }

  return {
    markdown,
    run_root: run,
    state: runStatus(run),
    detailed,
    catalogue,
    occupancy: {
      active: activeCount,
      implementers: leasedCount,
      validators: valCount,
      standby: readyCount,
      blocked: blockedCount,
      satisfied: satCount,
      repair: repairCount,
      max_parallel: maxParallel,
      gate_max_parallel: gateMaxParallel,
      summary: occupancySummary,
    },
    ...(unified === undefined
      ? {}
      : {
          unified,
          dag: unified.dag,
          doctor: unified.doctor,
          metrics: unified.metrics,
          lifecycle: unified.lifecycle,
          agent_matrix: unified.agent_matrix,
        }),
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
  const repoRoot = findRepoRoot(loaded.runRoot);
  const cwd = rawCwd
    ? isAbsolute(rawCwd)
      ? realpathSync(rawCwd)
      : resolve(repoRoot, rawCwd)
    : repoRoot;

  const declared = declaredToolFlags(flags);
  const commandDir = `${loaded.runRoot}/commands`;

  const metadata = readAgentMetadata(actor, loaded.runRoot);
  if (!metadata) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `[ROLE_BOUNDARY_VIOLATION] Cannot find AgentMetadata for actor: ${actor}`,
    );
  }

  const auth = verifyCommandAuthorization(metadata, argv);
  if (!auth.authorized) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      auth.message || `[${auth.error_code}] Command authorization failed`,
    );
  }

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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      if (lastAttempt.stderrPath) {
        stderrStr = readFileSync(lastAttempt.stderrPath, "utf-8");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
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
  const screenshotPaths = (evidencePayload.screenshot_records as ScreenshotRecord[]).map(
    (shot) => shot.path,
  );

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

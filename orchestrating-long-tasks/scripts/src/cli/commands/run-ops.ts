import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { JsonObject } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { inspectRepositoryBinding } from "../../packets/repository-identity.ts";
import { verifyCommandRecord } from "../../runner/verify-command.ts";
import { runCommand } from "../../runner/run-command.ts";
import { loadRun } from "../../store/index.ts";
import { transact } from "../../store/transaction.ts";
import { completeRun } from "../../workflow/completion/complete-run.ts";
import { gateTally } from "../../workflow/completion/completion-state.ts";
import type { CompletionArtifactRequirements } from "../../workflow/completion/artifact-verification.ts";
import type { TaskRecord, WorkflowState } from "../../workflow/types.ts";
import {
  formatRunCompleteBrief,
  formatRunExecBrief,
  formatRunStatusBrief,
} from "../formatters/index.ts";
import { boolFlag, textFlag, type Flags } from "../options.ts";
import { declaredToolFlags } from "../taxonomy-flags.ts";
import { generateSummarySuite } from "../../summary/generate-summary.ts";
import { ingestBrowserRun } from "../../reporting/browser-run-ingestion.ts";
import { refreshHandoff } from "../../reporting/handoff.ts";
import { ingestScreenshots, ingestVisualReport } from "../../reporting/screenshot-ingestion.ts";
import { commandEvidenceView, commandRecordPath } from "../../reporting/command-evidence.ts";

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

export function runCompleteCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const actor = textFlag(flags, "actor")!;

  const state = completeRun(workflowPort(run), actor, (lockedState, requirements) =>
    verifyCompletionArtifacts(run, lockedState, requirements),
  );

  try {
    generateSummarySuite({ capsulePath: run, writeToDisk: true });
  } catch {}

  // The restart document is regenerated against the sealed state, so a reader of the finished
  // capsule sees the run as it ended rather than as it looked at the last submission.
  const handoffPath = refreshHandoff(run);

  const tasks = Object.values(state.tasks);
  // Gate counts come from the gate ledger. Counting exit-zero commands against the requirement
  // total put two numbers under a heading neither of them measured.
  const gates = gateTally(state);
  const markdown = formatRunCompleteBrief({
    runId: basename(run),
    capsulePath: run,
    tasksCount: tasks.length,
    validationsCount: tasks.filter((t) => t.status === "done").length,
    gatesPassed: gates.green,
    totalGates: gates.total,
  });

  return {
    markdown,
    run_root: run,
    completion: state.completion_result,
    ...(handoffPath === undefined ? {} : { handoff_path: handoffPath }),
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
    else if (t.validation) agentOrLock = `Validating (${t.validation.validator_id})`;
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
  const markdown = formatRunStatusBrief(basename(run), phase, taskItems, progressSummary);

  return { markdown, run_root: run, state, detailed };
}

export async function runExecCommand(
  flags: Flags,
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
  const result = await runCommand(cmdOpts);

  // The event says what ran and how it ended. An empty payload left every reader to guess, and the
  // ones that guessed read an unrecorded command as a successful one.
  const recordedPayload: JsonObject = {
    command_id: result.record.id,
    argv: [...result.record.argv],
    status: result.record.status,
    exit_code: result.record.exit_code,
    ...(result.record.task_id === null ? {} : { task_id: result.record.task_id }),
    ...(result.record.gate_id === null ? {} : { gate_id: result.record.gate_id }),
  };
  transact(loaded.runRoot, actor, "command-recorded", recordedPayload, (draft) => {
    const d = draft as Record<string, unknown>;
    d.commands = (d.commands ?? {}) as Record<string, unknown>;
    (d.commands as Record<string, unknown>)[result.record.id] = result.record;
  });

  const record = result.record;
  const commandStr = argv.join(" ");
  // A command the runner could not collect an exit code for did not exit 0, and one whose clock
  // never closed took no measured time. Both stay unknown all the way to the brief.
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

  // The command's own clock bounds what it may claim to have captured: a file that already existed
  // when the command started was not produced by it.
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

  // A browser or visual suite leaves a report behind; that report, plus the harness's own clock and
  // exit status, is the whole of what the run is allowed to claim about the browser it drove.
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

  // The command record is the evidence. It is already durable under commands/<id>/ and already
  // bound to the event chain, so nothing here writes a second document describing the same run.
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

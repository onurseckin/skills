import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { HarnessError } from "../../errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { inspectRepositoryBinding } from "../../packets/repository-identity.ts";
import { verifyCommandRecord } from "../../runner/verify-command.ts";
import { runCommand } from "../../runner/run-command.ts";
import { loadRun } from "../../store/index.ts";
import { transact } from "../../store/transaction.ts";
import { completeRun } from "../../workflow/completion/complete-run.ts";
import type { CompletionArtifactRequirements } from "../../workflow/completion/artifact-verification.ts";
import type { TaskRecord, WorkflowState } from "../../workflow/types.ts";
import {
  formatRunCompleteBrief,
  formatRunExecBrief,
  formatRunStatusBrief,
} from "../formatters/index.ts";
import { assertFlags, boolFlag, textFlag, type Flags } from "../options.ts";

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
    else issues.push(...verifyCommandRecord(run, command).map((issue) => `command ${id}: ${issue}`));
  }
  if (issues.length > 0) {
    throw new HarnessError("INTEGRITY", `completion artifact verification failed: ${issues.join("; ")}`);
  }
  return {
    verified_at: new Date().toISOString(),
    command_ids: requirements.command_ids,
    packets: requirements.packets ?? [],
    repository_binding: liveRepositoryBinding(run),
  };
}

export function runCompleteCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "auth-token", "actor"]);
  const run = textFlag(flags, "run")!;
  const actor = textFlag(flags, "actor", false) ?? "coordinator";

  const state = completeRun(workflowPort(run), actor, (lockedState, requirements) =>
    verifyCompletionArtifacts(run, lockedState, requirements),
  );

  const tasks = Object.values(state.tasks);
  const markdown = formatRunCompleteBrief({
    runId: basename(run),
    capsulePath: run,
    tasksCount: tasks.length,
    validationsCount: tasks.filter((t) => t.status === "done").length,
    gatesPassed: Object.values(state.commands).filter((c) => c.exit_code === 0).length,
    totalGates: state.requirements.length,
  });

  return { markdown, run_root: run, completion: state.completion_result };
}

export function runStatusCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "detailed"]);
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
  const phase = completionResult?.status === "complete" ? "Completed" : state.graph ? "Executing" : "Planning";
  const markdown = formatRunStatusBrief(basename(run), phase, taskItems, progressSummary);

  return { markdown, run_root: run, state, detailed };
}

export async function runExecCommand(flags: Flags, argv: readonly string[]): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "task", "gate", "cwd", "save-evidence", "actor"]);
  const run = textFlag(flags, "run")!;
  const task = textFlag(flags, "task", false);
  const gate = textFlag(flags, "gate", false);
  const rawCwd = textFlag(flags, "cwd", false);
  const actor = textFlag(flags, "actor", false) ?? "coordinator";

  const loaded = loadRun(run);
  const repoRoot = dirname(dirname(loaded.runRoot));
  const cwd = rawCwd
    ? isAbsolute(rawCwd)
      ? realpathSync(rawCwd)
      : resolve(repoRoot, rawCwd)
    : repoRoot;

  const commandDir = `${loaded.runRoot}/commands`;
  const cmdOpts = {
    runRoot: loaded.runRoot,
    commandDir,
    cwd,
    actor,
    argv: [...argv],
    ...(task ? { taskId: task } : {}),
    ...(gate ? { gateId: gate } : {}),
  };
  const result = await runCommand(cmdOpts);

  transact(loaded.runRoot, actor, "command-recorded", {}, (draft) => {
    const d = draft as Record<string, unknown>;
    d.commands = (d.commands ?? {}) as Record<string, unknown>;
    (d.commands as Record<string, unknown>)[result.record.id] = result.record;
  });

  const record = result.record;
  const commandStr = argv.join(" ");
  const exitCode = record.exit_code ?? 0;
  const durationSec = ((record.finished_at ? Date.parse(record.finished_at) : 0) - (record.started_at ? Date.parse(record.started_at) : 0)) / 1000;
  const outputSummary = exitCode === 0 ? "Command completed successfully" : "Command returned non-zero exit code";

  const markdown = formatRunExecBrief({
    commandStr,
    exitCode,
    durationSeconds: durationSec > 0 ? durationSec : 0.1,
    outputSummary,
    evidencePath: `${run}/evidence/${record.id}.json`,
    logPath: result.recordPath,
  });

  return { markdown, run_root: run, command: record, command_id: record.id, exit_code: exitCode, ...result };
}

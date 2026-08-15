import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { HarnessError } from "../../errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { inspectRepositoryBinding } from "../../packets/repository-identity.ts";
import { packetEvidenceIssues } from "../../reporting/packet-evidence.ts";
import { verifyCommandRecord } from "../../runner/verify-command.ts";
import { loadRun } from "../../store/index.ts";
import { completeRun } from "../../workflow/completion/complete-run.ts";
import type { CompletionArtifactRequirements } from "../../workflow/completion/artifact-verification.ts";
import type { PacketRecord, TaskRecord, WorkflowState } from "../../workflow/types.ts";
import {
  formatRunCompleteBrief,
  formatRunExecBrief,
  formatRunStatusBrief,
} from "../formatters/index.ts";
import { assertFlags, boolFlag, textFlag, type Flags } from "../options.ts";
import { runCommandCli } from "./runner.ts";

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
  issues.push(...packetEvidenceIssues(run, state.packets ?? ({} as Record<string, PacketRecord>)));
  if (issues.length > 0) {
    throw new HarnessError("INTEGRITY", `completion artifact verification failed: ${issues.join("; ")}`);
  }
  return {
    verified_at: new Date().toISOString(),
    command_ids: requirements.command_ids,
    packets: requirements.packets,
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
    validationsCount: tasks.filter((t) => (t.validation_history ?? []).length > 0 || t.status === "done").length,
    gatesPassed: tasks.filter((t) => t.status === "done").length,
    totalGates: tasks.length,
  });

  return { markdown, run_root: run, completion: state.completion_result };
}

export function runStatusCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "detailed"]);
  const run = textFlag(flags, "run")!;
  const detailed = boolFlag(flags, "detailed");
  const loaded = loadRun(run);
  const state = loaded.state;
  const allTasksMap = (state.tasks ?? {}) as Record<string, TaskRecord>;
  const tasks = Object.values(allTasksMap);

  const taskItems = tasks.map((t) => {
    let agentOrLock = "-";
    if (t.status === "leased") agentOrLock = `Leased by \`${t.lease?.agent_id ?? "unknown"}\``;
    else if (t.status === "validating") agentOrLock = `Validating by \`${t.validation?.validator_id ?? "validator"}\``;
    else if (t.status === "done") agentOrLock = "Completed";
    else if (t.status === "proposed") {
      const remaining = t.dependencies.filter((d) => allTasksMap[d]?.status !== "done");
      agentOrLock = remaining.length > 0 ? `Waiting on ${remaining.join(", ")}` : "Proposed";
    }

    let statusEmoji = "⏳";
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

  const result = await runCommandCli(
    { run, cwd, actor, ...(task ? { task } : {}), ...(gate ? { gate } : {}) },
    [...argv],
  );

  const record = (result.record ?? {}) as { exit_code: number; duration_ms: number; stdout: string; id: string };
  const commandStr = argv.join(" ");
  const exitCode = record.exit_code ?? 0;
  const durationSec = (record.duration_ms ?? 0) / 1000;
  const outputSummary = exitCode === 0 ? "Command completed successfully" : "Command returned non-zero exit code";

  const markdown = formatRunExecBrief({
    commandStr,
    exitCode,
    durationSeconds: durationSec,
    outputSummary,
    evidencePath: `${run}/evidence/${record.id}.json`,
    logPath: `${result.record_path as string}`,
  });

  return { markdown, run_root: run, command: record, command_id: record.id, exit_code: exitCode, duration_ms: record.duration_ms, ...result };
}

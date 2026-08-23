import { basename, dirname, resolve } from "node:path";
import { getHarnessConfig } from "../../core/config/harness-config.ts";
import { isJsonObject, type JsonObject, type JsonValue } from "../../core/contracts/json.ts";
import { readBoundedBytes } from "../../core/json.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { partitionByGlob, slugifyScope } from "../../graph/auto-partition.ts";
import { compileGraphDocument } from "../../graph/compiler.ts";
import { projectPlan } from "../../graph/project-plan.ts";
import { guardPlanRevision } from "../../graph/revision-guard.ts";
import { analyzeScopeIndependence } from "../../graph/scope-analyzer.ts";
import { dependencyData } from "../../graph/topology.ts";
import { assertInstalledRuntimeFresh } from "../../installer/runtime-freshness.ts";
import {
  compileRequirementsFromPrompt,
  type TaskDeclaration,
} from "../../requirements/compiler.ts";
import { buildEnhancedPlan, writeEnhancedPlan } from "../../requirements/enhanced-plan.ts";
import { parseRequirementLines } from "../../requirements/requirement-lines.ts";
import { recordTopology } from "../../engine/scheduler/index.ts";
import { initRun, loadRun } from "../../engine/store/index.ts";
import { transact } from "../../engine/store/transaction.ts";
import { ensureHarnessIgnored } from "../git-ignore.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { discoverGatePaths, gateBreadthWarning } from "../../graph/gate-breadth.ts";
import {
  formatAutoPartitionBrief,
  formatCapsuleInitBrief,
  formatPlanCompileBrief,
  formatPlanEnhanceBrief,
  formatPlanStatusBrief,
  formatTaskRegisteredBrief,
} from "../formatters/index.ts";
import {
  actorFlag,
  boolFlag,
  integerFlag,
  listFlag,
  textFlag,
  type Flags,
  type CommandContext,
} from "../options.ts";

function promptText(prompt: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(prompt);
}

export async function planInitCommand(
  flags: Flags,
  context: CommandContext = {},
): Promise<Record<string, unknown>> {
  const runId = textFlag(flags, "run", false) ?? textFlag(flags, "run-id", false);
  if (!runId) throw new HarnessError("INVALID_ARGUMENT", "must provide --run or --run-id");

  const fromFile = textFlag(flags, "prompt-file", false);
  const fromStdin = boolFlag(flags, "prompt-stdin");
  const prompt =
    fromFile === undefined ? context.stdin : readBoundedBytes(fromFile, 64 * 1024 * 1024);
  if (prompt === undefined)
    throw new HarnessError("INVALID_ARGUMENT", "prompt source is unavailable");

  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const ignore_assurance = ensureHarnessIgnored(repo);
  const captureMode =
    textFlag(flags, "capture-mode", false) ?? (fromFile !== undefined ? "file" : "stdin");
  const sourceVerified =
    flags["source-verified"] === undefined
      ? captureMode === "file" || captureMode === "stdin" || captureMode === "argv"
      : boolFlag(flags, "source-verified");

  const runtimeSource =
    textFlag(flags, "runtime-source", false) ??
    (boolFlag(flags, "no-runtime-pin") ? undefined : context.executingRuntime);
  if (runtimeSource !== undefined && runtimeSource === context.executingRuntime) {
    await assertInstalledRuntimeFresh(runtimeSource);
  }
  const runRoot = initRun(
    repo,
    runId,
    prompt,
    captureMode,
    sourceVerified,
    runtimeSource === undefined ? {} : { runtimeSource },
  );
  const manifest = loadRun(runRoot).manifest;

  const markdown = formatCapsuleInitBrief({
    runId: manifest.run_id,
    runRoot,
    promptSha256: manifest.prompt_sha256,
    promptBytes: manifest.prompt_bytes,
    assurance: manifest.assurance,
    bunVersion: manifest.bun_version,
    ...(manifest.runtime_sha256 === undefined || manifest.runtime_files === undefined
      ? {}
      : { runtimePin: { sha256: manifest.runtime_sha256, files: manifest.runtime_files } }),
  });

  return { markdown, run_root: runRoot, manifest, ignore_assurance };
}

export function planEnhanceCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const actor = actorFlag(flags);
  const loaded = loadRun(run);
  const document = buildEnhancedPlan({
    runId: loaded.manifest.run_id,
    promptSha256: loaded.manifest.prompt_sha256,
    actor,
    recordedAt: new Date().toISOString(),
    summary: textFlag(flags, "summary", false),
    observations: listFlag(flags, "observation"),
    todos: listFlag(flags, "todo"),
    risks: listFlag(flags, "risk"),
    openQuestions: listFlag(flags, "open-question"),
    sources: listFlag(flags, "source"),
  });
  const artifacts = writeEnhancedPlan(loaded.runRoot, document);

  const counts = {
    observations: document.observations.length,
    todos: document.todos.length,
    risks: document.risks.length,
    open_questions: document.open_questions.length,
    sources: document.sources.length,
  };
  let revision = 1;
  transact(
    run,
    actor,
    "plan-enhanced",
    {
      prompt_sha256: document.prompt_sha256,
      markdown_sha256: artifacts.markdown_sha256,
      json_sha256: artifacts.json_sha256,
      todo_count: counts.todos,
      observation_count: counts.observations,
    },
    (state) => {
      const planning = isJsonObject(state.planning) ? state.planning : {};
      const previous = isJsonObject(planning.enhanced_plan) ? planning.enhanced_plan : undefined;
      const previousRevision = previous?.revision;
      revision = typeof previousRevision === "number" ? previousRevision + 1 : 1;
      const entry: JsonObject = {
        ...artifacts,
        revision,
        prompt_sha256: document.prompt_sha256,
        recorded_at: document.recorded_at,
        actor,
        evidence_class: "agent_reported",
        counts,
      };
      state.planning = { ...planning, enhanced_plan: entry };
    },
  );

  const markdown = formatPlanEnhanceBrief({
    runId: loaded.manifest.run_id,
    markdownPath: artifacts.markdown_path,
    jsonPath: artifacts.json_path,
    markdownSha256: artifacts.markdown_sha256,
    promptSha256: document.prompt_sha256,
    revision,
    summaryPresent: document.summary !== undefined,
    counts: {
      observations: counts.observations,
      todos: counts.todos,
      risks: counts.risks,
      openQuestions: counts.open_questions,
      sources: counts.sources,
    },
  });

  return {
    markdown,
    run_root: loaded.runRoot,
    revision,
    enhanced_plan: { ...artifacts, revision, counts },
    document,
  };
}

function parseDepReasons(entries: readonly string[] | undefined): Record<string, string> {
  const reasons: Record<string, string> = {};
  for (const entry of entries ?? []) {
    const separator = entry.indexOf(":");
    const depId = separator < 0 ? entry : entry.slice(0, separator).trim();
    const reason = separator < 0 ? "" : entry.slice(separator + 1).trim();
    if (!depId || !reason) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `--dep-reason must read "<dep-id>:<why this edge exists>", got "${entry}"`,
      );
    }
    reasons[depId] = reason;
  }
  return reasons;
}

function appendTaskToBuffer(run: string, actor: string, task: TaskDeclaration): number {
  let totalTasks = 0;
  transact(run, actor, "plan-task-added", { task_id: task.id }, (state) => {
    if (state.graph !== undefined && state.graph !== null) {
      throw new HarnessError("INVALID_STATE", "cannot add tasks to compiled plan");
    }
    const rawBuffer = Array.isArray(state.planning_buffer) ? state.planning_buffer : [];
    const buffer = rawBuffer as unknown as TaskDeclaration[];
    if (buffer.some((t) => t.id === task.id)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `task ${task.id} already exists in planning buffer`,
      );
    }
    buffer.push(task);
    state.planning_buffer = buffer as unknown as JsonValue;
    totalTasks = buffer.length;
  });
  return totalTasks;
}

function planAddSingleCommand(
  flags: Flags,
  run: string,
  id: string,
  label: string,
): Record<string, unknown> {
  const scopeRaw = textFlag(flags, "scope", false);
  if (scopeRaw === undefined) throw new HarnessError("INVALID_ARGUMENT", "--scope is required");
  const writeScope = scopeRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const gate = textFlag(flags, "gate", false);
  if (gate === undefined) throw new HarnessError("INVALID_ARGUMENT", "--gate is required");
  const depsRaw = textFlag(flags, "deps", false);
  const deps = depsRaw
    ? depsRaw
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
    : [];
  const depReasons = parseDepReasons(listFlag(flags, "dep-reason"));
  for (const depId of Object.keys(depReasons)) {
    if (!deps.includes(depId)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `--dep-reason names '${depId}', which is not in --deps (${deps.join(", ") || "none"})`,
      );
    }
  }
  const goal = textFlag(flags, "goal", false);
  const criteriaRaw = textFlag(flags, "criteria", false);
  const criteria = criteriaRaw
    ? criteriaRaw
        .split(";")
        .map((c) => c.trim())
        .filter(Boolean)
    : undefined;
  const priority = integerFlag(flags, "priority");
  const effort = integerFlag(flags, "effort");
  const actor = actorFlag(flags);
  const requirementLinesSpec = textFlag(flags, "requirement-lines", false);
  const requirementLines =
    requirementLinesSpec === undefined
      ? undefined
      : parseRequirementLines(requirementLinesSpec, promptText(loadRun(run).prompt));

  const newTask: TaskDeclaration = {
    id,
    label,
    writeScope,
    gate,
    ...(deps.length > 0 ? { deps } : {}),
    ...(Object.keys(depReasons).length > 0 ? { depReasons } : {}),
    ...(goal !== undefined ? { goal } : {}),
    ...(criteria !== undefined ? { criteria } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(effort !== undefined ? { effort } : {}),
    ...(requirementLines !== undefined ? { requirementLines } : {}),
  };

  const totalTasks = appendTaskToBuffer(run, actor, newTask);

  const breadthWarning = gateBreadthWarning(gate, writeScope);
  const suggestedGatePaths =
    breadthWarning === undefined ? [] : discoverGatePaths(findRepoRoot(run), writeScope);
  const breadthNote =
    breadthWarning === undefined
      ? undefined
      : suggestedGatePaths.length === 0
        ? breadthWarning
        : `${breadthWarning} This repository already has: ${suggestedGatePaths.join(", ")}.`;
  const unjustified = deps.filter((depId) => depReasons[depId] === undefined);
  const markdown = formatTaskRegisteredBrief({
    taskId: id,
    label,
    writeScope,
    gateCmd: gate,
    deps,
    totalTasks,
    requirementLines,
  });
  const notes = [
    ...(breadthNote === undefined ? [] : [`> **Gate breadth**: ${breadthNote}`]),
    ...(unjustified.length === 0
      ? []
      : [
          `> **Unjustified dependency**: ${unjustified.join(", ")} has no --dep-reason yet; plan:compile will refuse to seal without one.`,
        ]),
  ];
  return {
    markdown: notes.length === 0 ? markdown : `${markdown}\n\n${notes.join("\n\n")}`,
    run_root: run,
    task: newTask,
    total_tasks: totalTasks,
    ...(breadthWarning === undefined ? {} : { gate_breadth_warning: breadthWarning }),
    ...(suggestedGatePaths.length === 0 ? {} : { suggested_gate_paths: suggestedGatePaths }),
    ...(unjustified.length === 0 ? {} : { unjustified_dependencies: unjustified }),
  };
}

const AUTO_PARTITION_EXCLUSIVE_FLAGS = ["scope", "gate", "deps", "dep-reason"] as const;

function planAddAutoPartitionCommand(
  flags: Flags,
  run: string,
  idPrefix: string,
  labelPrefix: string,
  glob: string,
): Record<string, unknown> {
  for (const exclusive of AUTO_PARTITION_EXCLUSIVE_FLAGS) {
    if (Object.hasOwn(flags, exclusive)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `--auto-partition cannot be combined with --${exclusive}; auto-partitioned tasks derive their scope and gate from the glob and are independent roots by construction`,
      );
    }
  }
  const gateTemplate = textFlag(flags, "gate-template")!;
  if (!gateTemplate.includes("{scope}")) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--gate-template must contain the literal placeholder {scope}",
    );
  }
  const requestedGroupBy = textFlag(flags, "group-by", false);
  const groupBy = requestedGroupBy === undefined ? "file" : requestedGroupBy;
  if (groupBy !== "file" && groupBy !== "directory") {
    throw new HarnessError("INVALID_ARGUMENT", "--group-by must be 'file' or 'directory'");
  }
  const actor = actorFlag(flags);
  const repoRoot = resolve(run, "..", "..", "..");
  const partitions = partitionByGlob(repoRoot, glob, groupBy);

  const generated: TaskDeclaration[] = partitions.map((entry) => ({
    id: `${idPrefix}-${slugifyScope(entry.scope)}`,
    label: `${labelPrefix}: ${entry.scope}`,
    writeScope: [entry.scope],
    gate: gateTemplate.replaceAll("{scope}", entry.scope),
  }));

  let totalTasks = 0;
  transact(
    run,
    actor,
    "plan-task-added",
    { task_id: idPrefix, auto_partition_glob: glob, generated_count: generated.length },
    (state) => {
      if (state.graph !== undefined && state.graph !== null) {
        throw new HarnessError("INVALID_STATE", "cannot add tasks to compiled plan");
      }
      const rawBuffer = Array.isArray(state.planning_buffer) ? state.planning_buffer : [];
      const buffer = rawBuffer as unknown as TaskDeclaration[];
      for (const task of generated) {
        if (buffer.some((t) => t.id === task.id)) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `task ${task.id} already exists in planning buffer`,
          );
        }
      }
      buffer.push(...generated);
      state.planning_buffer = buffer as unknown as JsonValue;
      totalTasks = buffer.length;
    },
  );

  const breadthWarnings = generated
    .map((task) => {
      const warning = gateBreadthWarning(task.gate as string, task.writeScope);
      return warning === undefined ? undefined : `${task.id}: ${warning}`;
    })
    .filter((warning): warning is string => warning !== undefined);

  const markdown = formatAutoPartitionBrief({
    glob,
    groupBy,
    taskIds: generated.map((t) => t.id),
    totalTasks,
    breadthWarnings,
  });
  return {
    markdown,
    run_root: run,
    auto_partition: { glob, group_by: groupBy, generated_task_ids: generated.map((t) => t.id) },
    total_tasks: totalTasks,
    ...(breadthWarnings.length === 0 ? {} : { gate_breadth_warnings: breadthWarnings }),
  };
}

export function planAddCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const id = textFlag(flags, "id")!;
  const label = textFlag(flags, "label")!;
  const autoPartitionGlob = textFlag(flags, "auto-partition", false);
  return autoPartitionGlob === undefined
    ? planAddSingleCommand(flags, run, id, label)
    : planAddAutoPartitionCommand(flags, run, id, label, autoPartitionGlob);
}

export function planStatusCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const state = loadRun(run).state;
  const rawBuffer = Array.isArray(state.planning_buffer) ? state.planning_buffer : [];
  const buffer = rawBuffer as unknown as TaskDeclaration[];
  const isCompiled = state.graph !== undefined && state.graph !== null;
  const tasks = buffer.map((t) => ({
    id: t.id,
    label: t.label,
    writeScope: t.writeScope,
    gate: typeof t.gate === "string" ? t.gate : t.gate.join(" "),
    deps: t.deps ?? [],
  }));
  const markdown = formatPlanStatusBrief(basename(run), tasks, isCompiled);
  return { markdown, run_root: run, tasks, is_compiled: isCompiled };
}

export { planCompileCommand } from "./plan-compile.ts";
export { planReplanCommand } from "./plan-replan.ts";

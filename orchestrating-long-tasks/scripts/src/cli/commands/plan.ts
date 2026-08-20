import { basename, resolve } from "node:path";
import { getHarnessConfig } from "../../config/harness-config.ts";
import { isJsonObject, type JsonObject, type JsonValue } from "../../contracts/json.ts";
import { readBoundedBytes } from "../../core/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { compileGraphDocument } from "../../graph/compiler.ts";
import { projectPlan } from "../../graph/project-plan.ts";
import { guardPlanRevision } from "../../graph/revision-guard.ts";
import { analyzeScopeIndependence } from "../../graph/scope-analyzer.ts";
import { dependencyData } from "../../graph/topology.ts";
import {
  compileRequirementsFromPrompt,
  type TaskDeclaration,
} from "../../requirements/compiler.ts";
import { buildEnhancedPlan, writeEnhancedPlan } from "../../requirements/enhanced-plan.ts";
import { parseRequirementLines } from "../../requirements/requirement-lines.ts";
import { recordTopology } from "../../scheduler/index.ts";
import { initRun, loadRun } from "../../store/index.ts";
import { transact } from "../../store/transaction.ts";
import { ensureHarnessIgnored } from "../git-ignore.ts";
import { gateBreadthWarning } from "../../graph/gate-breadth.ts";
import {
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
      ? captureMode === "file" || captureMode === "stdin"
      : boolFlag(flags, "source-verified");

  // An explicit --runtime-source wins; otherwise the process that is running this very command
  // pins itself, so a run started through the real CLI is reproducible without the caller having
  // to know where the harness lives. --no-runtime-pin refuses even that default, for a throwaway
  // run that should not pay the copy.
  const runtimeSource =
    textFlag(flags, "runtime-source", false) ??
    (boolFlag(flags, "no-runtime-pin") ? undefined : context.executingRuntime);
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
    runId,
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

/**
 * The agent reads the repository host-side and reports what it found. Nothing here consults a model
 * or the filesystem under test, so every recorded value is a claim carrying `agent_reported`, and
 * the raw prompt keeps its authority over what the run is obliged to deliver.
 */
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
  // Written before the transaction so the digests recorded in state are of bytes that exist.
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
        // The artifacts were written and hashed by the harness; their contents are the agent's claim.
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

export function planAddCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const id = textFlag(flags, "id")!;
  const label = textFlag(flags, "label")!;
  const scopeRaw = textFlag(flags, "scope")!;
  const writeScope = scopeRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const gate = textFlag(flags, "gate")!;
  const depsRaw = textFlag(flags, "deps", false);
  const deps = depsRaw
    ? depsRaw
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
    : [];
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
  // Only read when a binding is declared: the positional path must keep working on a capsule the
  // caller has not otherwise touched.
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
    ...(goal !== undefined ? { goal } : {}),
    ...(criteria !== undefined ? { criteria } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(effort !== undefined ? { effort } : {}),
    ...(requirementLines !== undefined ? { requirementLines } : {}),
  };

  let totalTasks = 0;
  transact(run, actor, "plan-task-added", { task_id: id }, (state) => {
    if (state.graph !== undefined && state.graph !== null) {
      throw new HarnessError("INVALID_STATE", "cannot add tasks to compiled plan");
    }
    const rawBuffer = Array.isArray(state.planning_buffer) ? state.planning_buffer : [];
    const buffer = rawBuffer as unknown as TaskDeclaration[];
    if (buffer.some((t) => t.id === id)) {
      throw new HarnessError("INVALID_ARGUMENT", `task ${id} already exists in planning buffer`);
    }
    buffer.push(newTask);
    state.planning_buffer = buffer as unknown as JsonValue;
    totalTasks = buffer.length;
  });

  const breadthWarning = gateBreadthWarning(gate, writeScope);
  const markdown = formatTaskRegisteredBrief({
    taskId: id,
    label,
    writeScope,
    gateCmd: gate,
    deps,
    totalTasks,
    requirementLines,
  });
  return {
    markdown:
      breadthWarning === undefined
        ? markdown
        : `${markdown}\n\n> **Gate breadth**: ${breadthWarning}`,
    run_root: run,
    task: newTask,
    total_tasks: totalTasks,
    ...(breadthWarning === undefined ? {} : { gate_breadth_warning: breadthWarning }),
  };
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

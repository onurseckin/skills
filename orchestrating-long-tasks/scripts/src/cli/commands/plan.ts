import { basename } from "node:path";
import type { JsonValue } from "../../contracts/json.ts";
import { readBoundedBytes } from "../../core/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { compileGraphDocument } from "../../graph/compiler.ts";
import { projectPlan } from "../../graph/project-plan.ts";
import { guardPlanRevision } from "../../graph/revision-guard.ts";
import { analyzeScopeIndependence } from "../../graph/scope-analyzer.ts";
import { dependencyData } from "../../graph/topology.ts";
import { initializePlannerPacket } from "../../packets/planner-packet.ts";
import { compileRequirementsFromPrompt, type TaskDeclaration } from "../../requirements/compiler.ts";
import { initRun, loadRun } from "../../store/index.ts";
import { transact } from "../../store/transaction.ts";
import { ensureHarnessIgnored } from "../git-ignore.ts";
import {
  formatCapsuleInitBrief,
  formatPlanCompileBrief,
  formatPlanStatusBrief,
  formatTaskRegisteredBrief,
} from "../formatters/index.ts";
import { actorFlag, assertFlags, boolFlag, integerFlag, textFlag, type Flags } from "../options.ts";
import type { CommandContext } from "./capsule.ts";

export async function planInitCommand(
  flags: Flags,
  context: CommandContext = {},
): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "run-id", "prompt-file", "prompt-stdin", "repo", "capture-mode", "source-verified"]);
  const runId = textFlag(flags, "run", false) ?? textFlag(flags, "run-id", false);
  if (!runId) throw new HarnessError("INVALID_ARGUMENT", "must provide --run or --run-id");

  const fromFile = textFlag(flags, "prompt-file", false);
  const fromStdin = boolFlag(flags, "prompt-stdin");
  const prompt = fromFile === undefined ? context.stdin : readBoundedBytes(fromFile, 64 * 1024 * 1024);
  if (prompt === undefined) throw new HarnessError("INVALID_ARGUMENT", "prompt source is unavailable");

  const repo = textFlag(flags, "repo", false) ?? ".";
  const ignore_assurance = ensureHarnessIgnored(repo);
  const captureMode = textFlag(flags, "capture-mode", false) ?? (fromFile !== undefined ? "file" : "stdin");
  const sourceVerified = flags["source-verified"] === undefined
    ? (captureMode === "file" || captureMode === "stdin")
    : boolFlag(flags, "source-verified");

  const runRoot = initRun(repo, runId, prompt, captureMode, sourceVerified);
  const manifest = loadRun(runRoot).manifest;
  await initializePlannerPacket(runRoot, "planner");

  const markdown = formatCapsuleInitBrief({
    runId,
    runRoot,
    promptSha256: manifest.prompt_sha256,
    promptBytes: manifest.prompt_bytes,
    assurance: manifest.assurance,
    bunVersion: manifest.bun_version,
  });

  return { markdown, run_root: runRoot, manifest, ignore_assurance };
}

export function planAddCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "id", "label", "scope", "gate", "deps", "goal", "criteria", "priority", "effort", "actor"]);
  const run = textFlag(flags, "run")!;
  const id = textFlag(flags, "id")!;
  const label = textFlag(flags, "label")!;
  const scopeRaw = textFlag(flags, "scope")!;
  const writeScope = scopeRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const gate = textFlag(flags, "gate")!;
  const depsRaw = textFlag(flags, "deps", false);
  const deps = depsRaw ? depsRaw.split(",").map((d) => d.trim()).filter(Boolean) : [];
  const goal = textFlag(flags, "goal", false);
  const criteriaRaw = textFlag(flags, "criteria", false);
  const criteria = criteriaRaw ? criteriaRaw.split(";").map((c) => c.trim()).filter(Boolean) : undefined;
  const priority = integerFlag(flags, "priority");
  const effort = integerFlag(flags, "effort");
  const actor = actorFlag(flags);

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

  const markdown = formatTaskRegisteredBrief({ taskId: id, label, writeScope, gateCmd: gate, deps, totalTasks });
  return { markdown, run_root: run, task: newTask, total_tasks: totalTasks };
}

export function planStatusCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run"]);
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

export function planCompileCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "strict-parallel", "actor"]);
  const run = textFlag(flags, "run")!;
  const actor = actorFlag(flags);
  const loaded = loadRun(run);
  const prompt = new TextDecoder("utf-8", { fatal: true }).decode(loaded.prompt);
  const rawBuffer = Array.isArray(loaded.state.planning_buffer) ? loaded.state.planning_buffer : [];
  const buffer = rawBuffer as unknown as TaskDeclaration[];
  if (buffer.length === 0) throw new HarnessError("INVALID_STATE", "cannot compile empty planning buffer");

  const scopeAnalysis = analyzeScopeIndependence(
    buffer.map((t) => ({ taskId: t.id, writeScope: t.writeScope, dependencies: t.deps })),
  );
  if (scopeAnalysis.collisions.length > 0) {
    const c = scopeAnalysis.collisions[0]!;
    throw new HarnessError("INTEGRITY", `Scope collision detected between ${c.taskA} and ${c.taskB} on path '${c.conflictingPath}'.`);
  }

  const { requirementsDocument, requirementIdsByTask } = compileRequirementsFromPrompt(prompt, buffer);
  const { graphDocument } = compileGraphDocument(buffer, requirementsDocument, requirementIdsByTask, 1);
  const { dependencies } = dependencyData(graphDocument.nodes as Record<string, unknown>[], graphDocument.edges as Record<string, unknown>[]);

  transact(run, actor, "plan-compiled", { tasks_count: buffer.length }, (state) => {
    if (!Array.isArray(state.plan_history)) {
      state.plan_history = [];
    }
    guardPlanRevision(state as unknown as Record<string, unknown>, requirementsDocument, graphDocument, dependencies);
    projectPlan(state as unknown as Record<string, unknown>, requirementsDocument, graphDocument, dependencies);
    state.planning_tasks = buffer as unknown as JsonValue;
  });

  const advisories = scopeAnalysis.serializationWarnings.map((w) => w.message);
  const markdown = formatPlanCompileBrief({
    revision: 1,
    totalTasks: buffer.length,
    waves: scopeAnalysis.concurrencyWaves,
    collisions: scopeAnalysis.collisions.length,
    requirementsCount: requirementIdsByTask.size,
    runId: basename(run),
    advisories,
  });

  return { markdown, run_root: run, revision: 1, total_tasks: buffer.length, waves: scopeAnalysis.concurrencyWaves };
}

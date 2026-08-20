import { basename, resolve } from "node:path";
import { getHarnessConfig } from "../../config/harness-config.ts";
import type { JsonValue } from "../../contracts/json.ts";
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
import { recordTopology } from "../../scheduler/index.ts";
import { loadRun } from "../../store/index.ts";
import { transact } from "../../store/transaction.ts";
import { formatPlanCompileBrief } from "../formatters/index.ts";
import { actorFlag, boolFlag, textFlag, type Flags } from "../options.ts";
import { parseGateArgv } from "./plan-replan-bindings.ts";

function promptText(prompt: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(prompt);
}

export function planCompileCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const actor = actorFlag(flags);
  // The run-completion gate is the command the whole run is finally held to; the caller declares it
  // here, because the harness has no way to know what proves this repository.
  const completionGate = parseGateArgv(textFlag(flags, "completion-gate")!);
  if (completionGate === undefined)
    throw new HarnessError("INVALID_ARGUMENT", "--completion-gate must name a command");
  const loaded = loadRun(run);
  const prompt = promptText(loaded.prompt);
  const rawBuffer = Array.isArray(loaded.state.planning_buffer) ? loaded.state.planning_buffer : [];
  const buffer = rawBuffer as unknown as TaskDeclaration[];
  if (buffer.length === 0)
    throw new HarnessError("INVALID_STATE", "cannot compile empty planning buffer");

  const scopeAnalysis = analyzeScopeIndependence(
    buffer.map((t) => ({ taskId: t.id, writeScope: t.writeScope, dependencies: t.deps })),
  );
  if (scopeAnalysis.collisions.length > 0) {
    const c = scopeAnalysis.collisions[0]!;
    throw new HarnessError(
      "INTEGRITY",
      `Scope collision detected between ${c.taskA} and ${c.taskB} on path '${c.conflictingPath}'.`,
    );
  }

  // --strict-parallel was accepted and never read, so a caller asking for advisories to be fatal got
  // a compile that quietly ignored them.
  const advisories = scopeAnalysis.serializationWarnings.map((w) => w.message);
  if (advisories.length > 0 && boolFlag(flags, "strict-parallel")) {
    throw new HarnessError(
      "INTEGRITY",
      `--strict-parallel: serialization advisories are fatal: ${advisories.join("; ")}`,
    );
  }

  const { requirementsDocument, requirementIdsByTask, warnings } = compileRequirementsFromPrompt(
    prompt,
    buffer,
  );
  const { graphDocument } = compileGraphDocument(
    buffer,
    requirementsDocument,
    requirementIdsByTask,
    1,
    completionGate,
  );
  const { dependencies } = dependencyData(
    graphDocument.nodes as Record<string, unknown>[],
    graphDocument.edges as Record<string, unknown>[],
  );

  transact(run, actor, "plan-compiled", { tasks_count: buffer.length }, (state) => {
    if (!Array.isArray(state.plan_history)) {
      state.plan_history = [];
    }
    guardPlanRevision(
      state as unknown as Record<string, unknown>,
      requirementsDocument,
      graphDocument,
      dependencies,
    );
    projectPlan(
      state as unknown as Record<string, unknown>,
      requirementsDocument,
      graphDocument,
      dependencies,
    );
    state.planning_tasks = buffer as unknown as JsonValue;
  });

  // The parallelism decision is made once, here, and recorded; the queue obeys the record instead of
  // re-deriving waves at dispatch time.
  const { topology } = recordTopology(run, actor, getHarnessConfig(resolve(run, "..", ".."), run));

  const markdown = formatPlanCompileBrief({
    revision: 1,
    totalTasks: buffer.length,
    topology: {
      revision: topology.revision,
      maxParallel: topology.max_parallel,
      waves: topology.waves.map((wave) => ({ wave: wave.wave, taskIds: wave.task_ids })),
    },
    collisions: scopeAnalysis.collisions.length,
    requirementsCount: requirementIdsByTask.size,
    runId: basename(run),
    advisories,
    warnings,
  });

  return {
    markdown,
    run_root: run,
    revision: 1,
    total_tasks: buffer.length,
    warnings,
    topology,
  };
}

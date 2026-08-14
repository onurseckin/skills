import { applyPlan } from "../../graph/apply-plan.ts";
import { planningPort } from "../../integration/store-ports.ts";
import { proposeBatch } from "../../scheduler/propose-batch.ts";
import { loadRun } from "../../store/index.ts";
import { scheduleReady } from "../../integration/schedule-ready.ts";
import { actorFlag, assertFlags, integerFlag, textFlag, type Flags } from "../options.ts";

export async function planApplyCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "requirements", "graph", "expected-revision", "actor"]);
  const run = textFlag(flags, "run")!;
  const state = await applyPlan(
    planningPort(run),
    actorFlag(flags),
    textFlag(flags, "requirements")!,
    textFlag(flags, "graph")!,
    integerFlag(flags, "expected-revision", { required: true, minimum: 0 })!,
  );
  return {
    run_root: run,
    revision: state.revision,
    graph_revision: (state.graph as { revision: number }).revision,
  };
}

export function readyCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "max-parallel"]);
  const run = textFlag(flags, "run")!;
  const maximum = integerFlag(flags, "max-parallel", { required: true, minimum: 1 })!;
  const tasks = proposeBatch(loadRun(run).state, maximum);
  return { run_root: run, tasks };
}

export function scheduleCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "max-parallel", "actor"]);
  const run = textFlag(flags, "run")!;
  const maximum = integerFlag(flags, "max-parallel", { required: true, minimum: 1 })!;
  const result = scheduleReady(run, actorFlag(flags), maximum);
  return { run_root: run, revision: result.state.revision, tasks: result.tasks };
}

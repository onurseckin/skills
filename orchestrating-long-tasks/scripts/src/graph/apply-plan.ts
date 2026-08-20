import { HarnessError } from "../errors/harness-error.ts";
import { isInteger } from "../requirements/predicates.ts";
import { validateRequirements } from "../requirements/validate-requirements.ts";
import { dependencyMap } from "./dependency-map.ts";
import { projectPlan } from "./project-plan.ts";
import { readPlanObject } from "./read-plan.ts";
import { guardPlanRevision } from "./revision-guard.ts";
import { validateGraph } from "./validate-graph.ts";

export interface PlanningSnapshot {
  prompt: Uint8Array;
  state: Record<string, unknown>;
}

export type PlanningMutation = (state: Record<string, unknown>) => void | Promise<void>;

export interface PlanningStore {
  load(): Promise<PlanningSnapshot>;
  transact(
    actor: string,
    kind: string,
    payload: Record<string, unknown>,
    mutation: PlanningMutation,
  ): Promise<Record<string, unknown>>;
}

export async function applyPlan(
  store: PlanningStore,
  actor: string,
  requirementsPath: string,
  graphPath: string,
  expectedRevision: number | null,
): Promise<Record<string, unknown>> {
  if (expectedRevision !== null && (!isInteger(expectedRevision) || expectedRevision < 0)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "expectedRevision must be a non-negative integer or null",
    );
  }
  const loaded = await store.load();
  const [requirements, graph] = await Promise.all([
    readPlanObject(requirementsPath, "requirements plan"),
    readPlanObject(graphPath, "graph plan"),
  ]);
  const issues = [
    ...validateRequirements(loaded.prompt, requirements),
    ...validateGraph(graph, requirements),
  ];
  if (issues.length) throw new HarnessError("INTEGRITY", "plan is invalid", issues);
  const dependencies = dependencyMap(graph);
  return store.transact(actor, "plan-applied", { graph_revision: graph.revision }, (state) => {
    const currentGraph = state.graph;
    const graphRevision =
      typeof currentGraph === "object" &&
      currentGraph !== null &&
      !Array.isArray(currentGraph) &&
      isInteger((currentGraph as Record<string, unknown>).revision)
        ? ((currentGraph as Record<string, unknown>).revision as number)
        : 0;
    if (expectedRevision !== null && graphRevision !== expectedRevision) {
      throw new HarnessError(
        "INVALID_STATE",
        `graph revision is ${String(graphRevision)}, expected ${expectedRevision}`,
      );
    }
    // projectPlan requires plan_history to already be a list; a fresh capsule's initial state
    // carries no such key, and the memory-store test fixture pre-seeding it masked that until this
    // ran against a real store.
    if (!Array.isArray(state.plan_history)) state.plan_history = [];
    guardPlanRevision(state, requirements, graph, dependencies);
    projectPlan(state, requirements, graph, dependencies);
  });
}

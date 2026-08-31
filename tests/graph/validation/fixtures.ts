import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { requirementsDocument } from "../../requirements/validation/fixtures.ts";
import {
  applyPlan,
  type PlanningMutation,
  type PlanningSnapshot,
  type PlanningStore,
} from "../../../olt/scripts/src/graph/apply-plan.ts";

export function graphDocument(
  requirements: Record<string, unknown>,
  revision = 1,
): Record<string, unknown> {
  const requirementIds = (requirements.requirements as Record<string, unknown>[]).map(
    ({ id }) => id as string,
  );
  const nodes: Record<string, unknown>[] = [];
  const edges: Record<string, unknown>[] = [];
  requirementIds.forEach((requirementId, offset) => {
    const index = offset + 1;
    const taskId = `task-${index}`;
    const artifactId = `artifact-${index}`;
    nodes.push(
      {
        id: `requirement-${index}`,
        type: "requirement",
        label: requirementId,
        requirement_id: requirementId,
      },
      { id: artifactId, type: "artifact", label: `Artifact ${index}` },
      {
        id: taskId,
        type: "task",
        label: `Task ${index}`,
        requirement_ids: [requirementId],
        write_scope: [`src/area-${index}`],
        resource_scope: [],
        status: index === 1 ? "ready" : "proposed",
        priority: 10 - index,
        effort: index,
        created_order: index,
      },
    );
    edges.push({ source: taskId, target: artifactId, type: "produces" });
  });
  if (requirementIds.length > 1)
    edges.push({ source: "task-2", target: "task-1", type: "depends_on" });
  return {
    schema: "harness.graph",
    version: 1,
    revision,
    nodes,
    edges,
    gates: [
      {
        id: "gate-required",
        command: ["bun", "test", "tests/planning"],
        cwd: ".",
        scope: "task",
        requirement_ids: requirementIds,
        mandatory: true,
      },
      {
        id: "gate-final",
        command: ["bun", "test", "tests"],
        cwd: ".",
        scope: "run",
        requirement_ids: [],
        mandatory: true,
      },
    ],
  };
}

export function validPlanningDocuments(prompt = "First\n\nThird"): {
  prompt: string;
  requirements: Record<string, unknown>;
  graph: Record<string, unknown>;
} {
  const requirements = requirementsDocument(prompt);
  return { prompt, requirements, graph: graphDocument(requirements) };
}

export function taskById(graph: Record<string, unknown>, id: string): Record<string, unknown> {
  const task = (graph.nodes as Record<string, unknown>[]).find((node) => node.id === id);
  if (!task) throw new Error(`Missing fixture task ${id}`);
  return task;
}

export class MemoryPlanningStore implements PlanningStore {
  public state: Record<string, unknown>;
  public readonly events: Record<string, unknown>[] = [];
  private readonly prompt: Uint8Array;

  public constructor(prompt: string) {
    this.prompt = new TextEncoder().encode(prompt);
    this.state = { revision: 0, tasks: {}, plan_history: [] };
  }

  public async load(): Promise<PlanningSnapshot> {
    return { prompt: this.prompt.slice(), state: structuredClone(this.state) };
  }

  public async transact(
    actor: string,
    kind: string,
    payload: Record<string, unknown>,
    mutation: PlanningMutation,
  ): Promise<Record<string, unknown>> {
    const next = structuredClone(this.state);
    await mutation(next);
    next.revision = (next.revision as number) + 1;
    this.state = next;
    this.events.push({ actor, kind, payload: structuredClone(payload) });
    return structuredClone(next);
  }

  public mutateRuntime(mutation: (state: Record<string, unknown>) => void): number {
    const next = structuredClone(this.state);
    mutation(next);
    next.revision = (next.revision as number) + 1;
    this.state = next;
    return next.revision as number;
  }
}

export class PlanFixture {
  public readonly prompt = "First\n\nThird";
  public requirements: Record<string, unknown>;
  public graph: Record<string, unknown>;
  public store = new MemoryPlanningStore(this.prompt);
  public root = "";
  public requirementsPath = "";
  public graphPath = "";

  public constructor() {
    const documents = validPlanningDocuments(this.prompt);
    this.requirements = documents.requirements;
    this.graph = documents.graph;
  }

  public async setup(): Promise<void> {
    this.root = await mkdtemp(join(tmpdir(), "harness-plan-"));
    this.requirementsPath = join(this.root, "requirements.json");
    this.graphPath = join(this.root, "graph.json");
    await this.write();
  }

  public async cleanup(): Promise<void> {
    if (this.root) await rm(this.root, { force: true, recursive: true });
  }

  public async write(): Promise<void> {
    await Promise.all([
      writeFile(this.requirementsPath, JSON.stringify(this.requirements), "utf8"),
      writeFile(this.graphPath, JSON.stringify(this.graph), "utf8"),
    ]);
  }

  public apply(expectedRevision: number | null = 0): Promise<Record<string, unknown>> {
    return applyPlan(
      this.store,
      "planner",
      this.requirementsPath,
      this.graphPath,
      expectedRevision,
    );
  }

  public resetGraph(revision = 1): void {
    this.graph = graphDocument(this.requirements, revision);
  }
}

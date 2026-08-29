import { describe, expect, test } from "bun:test";
import { dependencyMap } from "../../../../olt/scripts/src/graph/dependency-map.ts";
import { SchedulerEngine } from "../../../../olt/scripts/src/engine/scheduler/index.ts";

interface TestTaskOptions {
  readonly priority?: number;
  readonly created?: number;
  readonly effort?: number;
  readonly status?: string;
  readonly domain?: string;
  readonly primary_domain?: string;
  readonly validator_domain?: string;
  readonly resource_scope?: string[];
  readonly requirement_ids?: string[];
}

function createTask(
  id: string,
  writeScope: string | string[],
  options: TestTaskOptions = {},
): Record<string, unknown> {
  const scopes = Array.isArray(writeScope) ? writeScope : [writeScope];
  return {
    id,
    type: "task",
    label: id,
    requirement_ids: options.requirement_ids ?? ["R-001"],
    write_scope: scopes,
    resource_scope: options.resource_scope ?? [],
    artifact_ids: ["artifact-all"],
    status: options.status ?? "ready",
    priority: options.priority ?? 1,
    created_order: options.created ?? 10,
    effort: options.effort ?? 1,
    domain: options.domain,
    primary_domain: options.primary_domain,
    validator_domain: options.validator_domain,
  };
}

function createMultiDomainState(
  tasks: Array<Record<string, unknown>>,
  dependencies: Array<[string, string]> = [],
): Record<string, unknown> {
  const graph = {
    schema: "harness.graph",
    version: 1,
    revision: 1,
    nodes: [
      { id: "requirement-1", type: "requirement", label: "R-001", requirement_id: "R-001" },
      { id: "artifact-all", type: "artifact", label: "All output" },
      ...tasks,
    ],
    edges: dependencies.map(([source, target]) => ({ source, target, type: "depends_on" })),
    gates: [
      {
        id: "gate-one",
        command: ["bun", "test"],
        cwd: ".",
        scope: "task",
        requirement_ids: ["R-001"],
        mandatory: true,
      },
    ],
  };

  const dependencySets = dependencyMap(graph);
  return {
    graph,
    requirements: {
      schema: "harness.requirements",
      version: 1,
      prompt_sha256: "0".repeat(64),
      requirements: [{ id: "R-001", disposition: "actionable", dependencies: [] }],
      dispositions: [],
    },
    tasks: Object.fromEntries(
      tasks.map((item) => {
        const id = String(item.id);
        return [id, { ...item, dependencies: [...(dependencySets.get(id) ?? [])] }];
      }),
    ),
  };
}

describe("Multi-Domain Dispatch: SchedulerEngine Instance Methods", () => {
  test("SchedulerEngine executes evaluateMultiDomainBatch, dispatchMultiDomainValidators, and proposeMultiDomainWave", () => {
    const engine = new SchedulerEngine({ maxParallel: 4 });

    const tasks = [
      createTask("ui-task", "src/ui/Panel.tsx", { status: "ready", priority: 10 }),
      createTask("backend-task", "src/api/Data.ts", { status: "ready", priority: 9 }),
      createTask("sub-task", "src/auth/Jwt.ts", { status: "submitted", priority: 8 }),
    ];

    const state = createMultiDomainState(tasks);

    const batch = engine.evaluateMultiDomainBatch(state, { parallelismFactor: 3.0 });
    expect(batch.isMultiDomainActive).toBeTrue();
    expect(batch.distinctDomainCount).toBe(3);
    expect(batch.maxParallel).toBe(4);

    const valDispatch = engine.dispatchMultiDomainValidators(state, { parallelismFactor: 3.0 });
    expect(valDispatch.validatorDispatches).toHaveLength(1);
    expect(valDispatch.validatorDispatches[0]!.taskId).toBe("sub-task");

    const wave = engine.proposeMultiDomainWave(state, { parallelismFactor: 3.0 });
    expect(wave.wave).toBe(1);
    expect(wave.allDispatches).toHaveLength(3);
  });
});

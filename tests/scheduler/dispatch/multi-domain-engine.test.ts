import { describe, expect, test } from "bun:test";
import { dependencyMap } from "../../../olt/scripts/src/graph/dependency-map.ts";
import { SchedulerEngine } from "../../../olt/scripts/src/engine/scheduler/index.ts";

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

  test("maintains state immutability across repeated invocations", () => {
    const engine = new SchedulerEngine({ maxParallel: 4 });
    const tasks = [
      createTask("ui-task", "src/ui/Panel.tsx", { status: "ready", priority: 10 }),
      createTask("backend-task", "src/api/Data.ts", { status: "ready", priority: 9 }),
    ];
    const state = createMultiDomainState(tasks);
    const beforeJson = JSON.stringify(state);

    engine.evaluateMultiDomainBatch(state, { parallelismFactor: 3.0 });
    engine.dispatchMultiDomainValidators(state, { parallelismFactor: 3.0 });
    engine.proposeMultiDomainWave(state, { parallelismFactor: 3.0 });

    const afterJson = JSON.stringify(state);
    expect(afterJson).toBe(beforeJson);
  });

  test("handles proposeMultiDomainWave with 0 ready tasks and dependency chains", () => {
    const engine = new SchedulerEngine({ maxParallel: 4 });
    const tasks = [
      createTask("parent", "src/parent.ts", { status: "in_progress" }),
      createTask("child", "src/child.ts", { status: "blocked" }),
    ];
    const state = createMultiDomainState(tasks, [["child", "parent"]]);

    const wave = engine.proposeMultiDomainWave(state, { parallelismFactor: 3.0 });
    expect(wave.wave).toBe(1);
    expect(wave.allDispatches).toHaveLength(0);
  });

  test("method-level options override constructor-level engine defaults", () => {
    const engine = new SchedulerEngine({ maxParallel: 5 });
    const tasks = [
      createTask("ui-1", "src/ui/1.tsx", { priority: 10 }),
      createTask("api-1", "src/api/1.ts", { priority: 9 }),
      createTask("auth-1", "src/auth/1.ts", { priority: 8 }),
      createTask("core-1", "src/core/1.ts", { priority: 7 }),
    ];
    const state = createMultiDomainState(tasks);

    // Method-level maxParallel: 2 strictly overrides constructor maxParallel: 5
    const batch = engine.evaluateMultiDomainBatch(state, {
      maxParallel: 2,
      parallelismFactor: 4.0,
    });

    expect(batch.maxParallel).toBe(2);
    expect(batch.implementerDispatches.length).toBeLessThanOrEqual(2);
  });

  test("handles tasks with malformed write_scope or missing metadata gracefully", () => {
    const engine = new SchedulerEngine({ maxParallel: 4 });
    const tasks = [
      {
        id: "malformed-task",
        type: "task",
        status: "ready",
        write_scope: "not-an-array" as unknown as string[],
        requirement_ids: null as unknown as string[],
      },
    ];
    const state = createMultiDomainState(tasks);

    const batch = engine.evaluateMultiDomainBatch(state, { parallelismFactor: 3.0 });
    expect(batch).toBeDefined();
    expect(batch.scopeIsolated).toBeTrue();
  });
});

import { describe, expect, test } from "bun:test";
import { dependencyMap } from "../../../olt/scripts/src/graph/dependency-map.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  dispatchMultiDomainValidators,
  evaluateMultiDomainBatch,
} from "../../../olt/scripts/src/engine/scheduler/index.ts";

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

describe("Multi-Domain Dispatch: Edge Cases & Options", () => {
  test("throws HarnessError on invalid state or missing plan", () => {
    expect(() => evaluateMultiDomainBatch(null)).toThrow(HarnessError);
    expect(() => evaluateMultiDomainBatch({ graph: {} })).toThrow(HarnessError);
    expect(() => dispatchMultiDomainValidators(null)).toThrow(HarnessError);
  });

  test("throws HarnessError on invalid maxParallel", () => {
    const state = createMultiDomainState([createTask("t1", "src/t1")]);
    expect(() => evaluateMultiDomainBatch(state, { maxParallel: 0 })).toThrow(HarnessError);
    expect(() => evaluateMultiDomainBatch(state, { maxParallel: -5 })).toThrow(HarnessError);
    expect(() => dispatchMultiDomainValidators(state, { maxParallel: 0 })).toThrow(HarnessError);
  });

  test("handles empty tasks gracefully", () => {
    const state = createMultiDomainState([]);
    const result = evaluateMultiDomainBatch(state, { parallelismFactor: 3.0 });
    expect(result.allDispatches).toHaveLength(0);
    expect(result.distinctDomainCount).toBe(0);
    expect(result.scopeIsolated).toBeTrue();
  });

  test("handles all tasks in a single domain when P >= 2.5 without error", () => {
    const tasks = [
      createTask("ui-1", "src/ui/1.tsx", { priority: 10 }),
      createTask("ui-2", "src/ui/2.tsx", { priority: 9 }),
    ];

    const state = createMultiDomainState(tasks);

    const result = evaluateMultiDomainBatch(state, {
      parallelismFactor: 3.0,
      maxParallel: 2,
    });

    expect(result.isMultiDomainActive).toBeTrue();
    expect(result.implementerDispatches).toHaveLength(2);
    expect(result.distinctDomainCount).toBe(1);
    expect(result.activeDomains).toEqual(["frontend-ui"]);
  });

  test("filters out tasks with unsatisfied prerequisites", () => {
    const tasks = [
      createTask("parent-task", "src/parent.ts", { status: "ready", priority: 10 }),
      createTask("child-task", "src/child.ts", { status: "ready", priority: 9 }),
    ];

    const state = createMultiDomainState(tasks, [["child-task", "parent-task"]]);

    const result = evaluateMultiDomainBatch(state, {
      parallelismFactor: 3.0,
      maxParallel: 2,
    });

    expect(result.implementerDispatches).toHaveLength(1);
    expect(result.implementerDispatches[0]!.taskId).toBe("parent-task");
  });

  test("dispatches sequential validators when forced with allowSimultaneousValidators: true and P < 2.5", () => {
    const tasks = [
      createTask("impl-1", "src/ui/1.tsx", { status: "ready", priority: 10 }),
      createTask("sub-1", "src/api/1.ts", { status: "submitted", priority: 8 }),
      createTask("sub-2", "src/api/2.ts", { status: "submitted", priority: 7 }),
    ];

    const state = createMultiDomainState(tasks);

    const result = evaluateMultiDomainBatch(state, {
      parallelismFactor: 1.5,
      maxParallel: 3,
      allowSimultaneousValidators: true,
    });

    expect(result.isMultiDomainActive).toBeFalse();
    expect(result.implementerDispatches).toHaveLength(1);
    expect(result.validatorDispatches).toHaveLength(2);
    expect(result.allDispatches).toHaveLength(3);
  });

  test("dispatchMultiDomainValidators dispatches sequentially when P < 2.5", () => {
    const tasks = [
      createTask("sub-1", "src/api/1.ts", { status: "submitted", priority: 10 }),
      createTask("sub-2", "src/api/2.ts", { status: "submitted", priority: 8 }),
    ];

    const state = createMultiDomainState(tasks);

    const result = dispatchMultiDomainValidators(state, {
      parallelismFactor: 1.5,
      maxParallel: 2,
    });

    expect(result.isMultiDomainActive).toBeFalse();
    expect(result.validatorDispatches).toHaveLength(2);
    expect(result.dispatchedDomains).toEqual(["backend-system"]);
  });

  test("enforces strict floating point boundary gating for multi-domain batching", () => {
    const tasks = [
      createTask("ui-1", "src/ui/1.tsx", { priority: 10 }),
      createTask("api-1", "src/api/1.ts", { priority: 9 }),
    ];
    const state = createMultiDomainState(tasks);

    // resolveParallelismFactor rounds to 2 decimal places via Number(factor.toFixed(2))
    // 2.494 rounds to 2.49 (< 2.5 threshold => isMultiDomainActive: false)
    const subThreshold = evaluateMultiDomainBatch(state, {
      parallelismFactor: 2.494,
      maxParallel: 2,
    });
    expect(subThreshold.isMultiDomainActive).toBeFalse();

    // 2.50 meets threshold (>= 2.5 threshold => isMultiDomainActive: true)
    const atThreshold = evaluateMultiDomainBatch(state, {
      parallelismFactor: 2.5,
      maxParallel: 2,
    });
    expect(atThreshold.isMultiDomainActive).toBeTrue();
    expect(atThreshold.distinctDomainCount).toBe(2);
  });

  test("isolates scope conflicts across domains and handles large parallelism bounds", () => {
    // Two tasks in different domains with overlapping write_scope
    const tasks = [
      createTask("ui-task", ["src/ui/1.tsx", "src/shared/types.ts"], { priority: 10 }),
      createTask("api-task", ["src/api/1.ts", "src/shared/types.ts"], { priority: 9 }),
    ];
    const state = createMultiDomainState(tasks);

    const batch = evaluateMultiDomainBatch(state, {
      parallelismFactor: 5.0,
      maxParallel: 1000,
    });

    expect(batch.isMultiDomainActive).toBeTrue();
    // Scope conflict on src/shared/types.ts prevents concurrent dispatch of conflicting tasks
    expect(batch.implementerDispatches).toHaveLength(1);
    expect(batch.implementerDispatches[0]!.taskId).toBe("ui-task");
  });

  test("rejects cyclic dependencies at the graph boundary with HarnessError", () => {
    // Tasks forming a mutual dependency cycle are rejected at graph dependency construction
    const tasks = [
      createTask("cycle-1", "src/c1.ts", { status: "ready" }),
      createTask("cycle-2", "src/c2.ts", { status: "ready" }),
    ];
    expect(() =>
      createMultiDomainState(tasks, [
        ["cycle-1", "cycle-2"],
        ["cycle-2", "cycle-1"],
      ]),
    ).toThrow(HarnessError);
  });

  test("respects strict maxParallel option override over larger task pools", () => {
    const tasks = [
      createTask("t1", "src/ui/1.tsx", { priority: 10 }),
      createTask("t2", "src/api/1.ts", { priority: 9 }),
      createTask("t3", "src/auth/1.ts", { priority: 8 }),
    ];
    const state = createMultiDomainState(tasks);

    const batch = evaluateMultiDomainBatch(state, {
      parallelismFactor: 4.0,
      maxParallel: 1,
    });
    expect(batch.implementerDispatches).toHaveLength(1);
    expect(batch.implementerDispatches[0]!.taskId).toBe("t1");
  });

  test("prevents validator dispatch when active implementer scopes conflict", () => {
    const tasks = [createTask("sub-task", "src/shared/file.ts", { status: "submitted" })];
    const state = createMultiDomainState(tasks);

    const result = dispatchMultiDomainValidators(state, {
      parallelismFactor: 3.0,
      activeImplementerScopes: [["src/shared/file.ts"]],
    });

    expect(result.validatorDispatches).toHaveLength(0);
  });
});

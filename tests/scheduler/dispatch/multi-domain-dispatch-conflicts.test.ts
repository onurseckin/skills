import { describe, expect, test } from "bun:test";
import { dependencyMap } from "../../../../olt/scripts/src/graph/dependency-map.ts";
import {
  dispatchMultiDomainValidators,
  evaluateMultiDomainBatch,
  proposeMultiDomainWave,
  resolveParallelismFactor,
} from "../../../../olt/scripts/src/engine/scheduler/index.ts";

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

describe("Multi-Domain Dispatch: Conflicts & Sorting", () => {
  test("handles validator intra-domain conflicts during round-robin selection", () => {
    const tasks = [
      createTask("sub-ui-1", "src/ui/Button.tsx", { status: "submitted", priority: 10 }),
      createTask("sub-ui-2", "src/ui/Button.tsx", { status: "submitted", priority: 9 }),
      createTask("sub-sec-1", "src/auth/token.ts", { status: "submitted", priority: 8 }),
    ];

    const state = createMultiDomainState(tasks);

    const result = dispatchMultiDomainValidators(state, {
      parallelismFactor: 3.0,
      maxParallel: 3,
    });

    expect(result.validatorDispatches).toHaveLength(2);
    const dispatchedIds = result.validatorDispatches.map((d) => d.taskId);
    expect(dispatchedIds).toContain("sub-ui-1");
    expect(dispatchedIds).toContain("sub-sec-1");
    expect(dispatchedIds).not.toContain("sub-ui-2");
  });

  test("falls back gracefully when graph has dependency cycle during parallelism factor resolution", () => {
    const state = {
      graph: {
        nodes: [{ id: "t1" }, { id: "t2" }],
        edges: [
          { source: "t1", target: "t2", type: "depends_on" },
          { source: "t2", target: "t1", type: "depends_on" },
        ],
      },
      tasks: {
        t1: createTask("t1", "src/t1.ts"),
        t2: createTask("t2", "src/t2.ts"),
      },
      workParallelismRatio: 2.75,
    };

    const factor = resolveParallelismFactor(state);
    expect(factor).toBe(2.75);
  });

  test("sorts domain groups alphabetically on equal priority during multi-domain dispatch", () => {
    const tasks = [
      createTask("task-b", "src/api/b.ts", { priority: 5 }),
      createTask("task-f", "src/ui/f.tsx", { priority: 5 }),
    ];

    const state = createMultiDomainState(tasks);

    const result = evaluateMultiDomainBatch(state, {
      parallelismFactor: 3.0,
      maxParallel: 2,
    });

    expect(result.implementerDispatches).toHaveLength(2);
    expect(result.implementerDispatches[0]!.taskId).toBe("task-b");
    expect(result.implementerDispatches[1]!.taskId).toBe("task-f");
  });

  test("proposeMultiDomainWave supports custom clock", () => {
    const tasks = [createTask("t1", "src/ui/1.tsx")];
    const state = createMultiDomainState(tasks);
    const customDate = new Date("2026-08-22T12:00:00.000Z");

    const wave = proposeMultiDomainWave(state, {
      clock: { now: () => customDate },
    });

    expect(wave.evaluatedAt).toBe("2026-08-22T12:00:00.000Z");
  });

  test("filters submitted tasks that conflict with occupied running tasks in evaluateMultiDomainBatch", () => {
    const tasks = [
      createTask("t-running", "src/auth/token.ts", { status: "running", priority: 10 }),
      createTask("t-submitted", "src/auth/token.ts", { status: "submitted", priority: 9 }),
      createTask("t-ready", "src/ui/1.tsx", { status: "ready", priority: 8 }),
    ];

    const state = createMultiDomainState(tasks);

    const result = evaluateMultiDomainBatch(state, {
      parallelismFactor: 3.0,
      maxParallel: 3,
    });

    expect(result.validatorDispatches).toHaveLength(0);
    expect(result.implementerDispatches).toHaveLength(1);
    expect(result.implementerDispatches[0]!.taskId).toBe("t-ready");
  });

  test("dispatchMultiDomainValidators filters out tasks that conflict with occupied tasks", () => {
    const tasks = [
      createTask("t-running", "src/auth/token.ts", { status: "running", priority: 10 }),
      createTask("t-sub-conflict", "src/auth/token.ts", { status: "submitted", priority: 9 }),
      createTask("t-sub-clean", "src/ui/1.tsx", { status: "submitted", priority: 8 }),
    ];

    const state = createMultiDomainState(tasks);

    const result = dispatchMultiDomainValidators(state, {
      parallelismFactor: 3.0,
      maxParallel: 2,
    });

    expect(result.validatorDispatches).toHaveLength(1);
    expect(result.validatorDispatches[0]!.taskId).toBe("t-sub-clean");
  });

  test("handles validator resource conflicts in multi-domain batch and validator dispatch", () => {
    const tasks = [
      createTask("impl-1", "src/ui/1.tsx", { status: "ready", priority: 10 }),
      createTask("sub-res-1", "src/api/1.ts", {
        status: "submitted",
        priority: 9,
        resource_scope: ["res:db"],
      }),
      createTask("sub-res-2", "src/api/2.ts", {
        status: "submitted",
        priority: 8,
        resource_scope: ["res:db"],
      }),
    ];

    const state = createMultiDomainState(tasks);

    const batchResult = evaluateMultiDomainBatch(state, {
      parallelismFactor: 3.0,
      maxParallel: 3,
    });
    expect(batchResult.validatorDispatches).toHaveLength(1);
    expect(batchResult.validatorDispatches[0]!.taskId).toBe("sub-res-1");

    const valResult = dispatchMultiDomainValidators(state, {
      parallelismFactor: 3.0,
      maxParallel: 3,
      activeResourceScopes: [["res:db"]],
    });
    expect(valResult.validatorDispatches).toHaveLength(0);
  });
});

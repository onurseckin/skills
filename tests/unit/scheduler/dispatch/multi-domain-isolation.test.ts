import { describe, expect, test } from "bun:test";
import { dependencyMap } from "../../../../olt/scripts/src/graph/dependency-map.ts";
import {
  evaluateMultiDomainBatch,
  proposeMultiDomainWave,
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

describe("Multi-Domain Dispatch: Scope Isolation & Waves", () => {
  describe("1. Strict Scope Isolation Across Disjoint Domains", () => {
    test("Prevents simultaneous dispatch of cross-domain tasks with overlapping write scopes", () => {
      const tasks = [
        createTask("task-ui", "src/shared/types.ts", {
          priority: 10,
          domain: "frontend-ui",
        }),
        createTask("task-backend-conflicting", "src/shared/types.ts", {
          priority: 9,
          domain: "backend-system",
        }),
        createTask("task-backend-clean", "src/api/clean.ts", {
          priority: 8,
          domain: "backend-system",
        }),
      ];

      const state = createMultiDomainState(tasks);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 3.0,
        maxParallel: 3,
      });

      const dispatchedIds = result.implementerDispatches.map((d) => d.taskId);
      expect(dispatchedIds).toContain("task-ui");
      expect(dispatchedIds).toContain("task-backend-clean");
      expect(dispatchedIds).not.toContain("task-backend-conflicting");
      expect(result.scopeIsolated).toBeTrue();
    });

    test("Prevents concurrent validator dispatch when submitted task conflicts with dispatched implementer scope", () => {
      const tasks = [
        createTask("task-impl", "src/shared/kernel.ts", {
          status: "ready",
          priority: 10,
          domain: "frontend-ui",
        }),
        createTask("task-sub-conflict", "src/shared/kernel.ts", {
          status: "submitted",
          priority: 9,
          domain: "backend-system",
        }),
        createTask("task-sub-clean", "src/auth/safe.ts", {
          status: "submitted",
          priority: 8,
          domain: "security-auth",
        }),
      ];

      const state = createMultiDomainState(tasks);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 3.0,
        maxParallel: 3,
      });

      const dispatchedIds = result.allDispatches.map((d) => d.taskId);
      expect(dispatchedIds).toContain("task-impl");
      expect(dispatchedIds).toContain("task-sub-clean");
      expect(dispatchedIds).not.toContain("task-sub-conflict");
      expect(result.scopeIsolated).toBeTrue();
    });

    test("Prevents dispatch of tasks that conflict with occupied/running tasks in state", () => {
      const tasks = [
        createTask("task-running", "src/api/active.ts", {
          status: "running",
          priority: 10,
          domain: "backend-system",
        }),
        createTask("task-candidate-conflict", "src/api/active.ts", {
          status: "ready",
          priority: 9,
          domain: "backend-system",
        }),
        createTask("task-candidate-clean", "src/ui/clean.tsx", {
          status: "ready",
          priority: 8,
          domain: "frontend-ui",
        }),
      ];

      const state = createMultiDomainState(tasks);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 3.0,
        maxParallel: 3,
      });

      const dispatchedIds = result.implementerDispatches.map((d) => d.taskId);
      expect(dispatchedIds).toContain("task-candidate-clean");
      expect(dispatchedIds).not.toContain("task-candidate-conflict");
      expect(result.scopeIsolated).toBeTrue();
    });

    test("Prevents simultaneous dispatch on resource scope collision", () => {
      const tasks = [
        createTask("task-res-1", "src/ui/1.tsx", {
          priority: 10,
          resource_scope: ["db:postgres_main"],
          domain: "frontend-ui",
        }),
        createTask("task-res-2", "src/api/2.ts", {
          priority: 9,
          resource_scope: ["db:postgres_main"],
          domain: "backend-system",
        }),
      ];

      const state = createMultiDomainState(tasks);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 3.0,
        maxParallel: 3,
      });

      expect(result.implementerDispatches).toHaveLength(1);
      expect(result.implementerDispatches[0]!.taskId).toBe("task-res-1");
      expect(result.scopeIsolated).toBeTrue();
    });
  });

  describe("2. Multi-Domain Wave Evaluation & Blocked Tasks Diagnostics", () => {
    test("proposeMultiDomainWave produces structured wave with blocked and occupied tasks", () => {
      const tasks = [
        createTask("task-ready", "src/ui/App.tsx", { status: "ready", priority: 10 }),
        createTask("task-running", "src/api/Run.ts", { status: "running", priority: 9 }),
        createTask("task-blocked", "src/auth/Block.ts", { status: "blocked", priority: 8 }),
      ];

      const state = createMultiDomainState(tasks);

      const wave = proposeMultiDomainWave(state, {
        parallelismFactor: 3.0,
        maxParallel: 2,
      });

      expect(wave.wave).toBe(1);
      expect(typeof wave.evaluatedAt).toBe("string");
      expect(wave.implementerDispatches).toHaveLength(1);
      expect(wave.implementerDispatches[0]!.taskId).toBe("task-ready");
      expect(wave.activeOccupiedTasks).toContain("task-running");
      expect(wave.blockedTasks).toHaveLength(1);
      expect(wave.blockedTasks[0]!.taskId).toBe("task-blocked");
    });
  });
});

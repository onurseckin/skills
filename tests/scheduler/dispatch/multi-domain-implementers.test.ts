import { describe, expect, test } from "bun:test";
import { dependencyMap } from "../../../../olt/scripts/src/graph/dependency-map.ts";
import { evaluateMultiDomainBatch } from "../../../../olt/scripts/src/engine/scheduler/index.ts";

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

describe("Multi-Domain Dispatch: Implementer Concurrent Dispatch", () => {
  describe("Multi-Domain Implementer Concurrent Dispatch (P >= 2.5 vs P < 2.5)", () => {
    test("When P >= 2.5, mandates simultaneous multi-domain round-robin dispatch across distinct domains", () => {
      const tasks = [
        createTask("ui-1", "src/ui/CompA.tsx", { priority: 10 }),
        createTask("ui-2", "src/ui/CompB.tsx", { priority: 9 }),
        createTask("backend-1", "src/api/UserApi.ts", { priority: 8 }),
        createTask("backend-2", "src/api/OrderApi.ts", { priority: 7 }),
        createTask("sec-1", "src/auth/AuthService.ts", { priority: 6 }),
      ];

      const state = createMultiDomainState(tasks);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 3.0,
        maxParallel: 3,
      });

      expect(result.isMultiDomainActive).toBeTrue();
      expect(result.mandatedConcurrentDomains).toBeTrue();
      expect(result.parallelismFactor).toBe(3.0);
      expect(result.implementerDispatches).toHaveLength(3);

      const dispatchedTaskIds = result.implementerDispatches.map((d) => d.taskId);
      expect(dispatchedTaskIds).toEqual(["ui-1", "backend-1", "sec-1"]);

      expect(result.distinctDomainCount).toBe(3);
      expect(result.activeDomains).toEqual(["backend-system", "frontend-ui", "security-auth"]);
      expect(result.scopeIsolated).toBeTrue();
    });

    test("When P < 2.5, executes normal sequential / single-domain priority dispatch", () => {
      const tasks = [
        createTask("ui-1", "src/ui/CompA.tsx", { priority: 10 }),
        createTask("ui-2", "src/ui/CompB.tsx", { priority: 9 }),
        createTask("backend-1", "src/api/UserApi.ts", { priority: 8 }),
        createTask("backend-2", "src/api/OrderApi.ts", { priority: 7 }),
        createTask("sec-1", "src/auth/AuthService.ts", { priority: 6 }),
      ];

      const state = createMultiDomainState(tasks);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 1.8,
        maxParallel: 3,
      });

      expect(result.isMultiDomainActive).toBeFalse();
      expect(result.mandatedConcurrentDomains).toBeFalse();
      expect(result.parallelismFactor).toBe(1.8);
      expect(result.implementerDispatches).toHaveLength(3);

      const dispatchedTaskIds = result.implementerDispatches.map((d) => d.taskId);
      expect(dispatchedTaskIds).toEqual(["ui-1", "ui-2", "backend-1"]);

      expect(result.distinctDomainCount).toBe(2);
      expect(result.activeDomains).toEqual(["backend-system", "frontend-ui"]);
      expect(result.scopeIsolated).toBeTrue();
    });

    test("Multi-domain round-robin distributes fairly across multiple passes when maxParallel > domain count", () => {
      const tasks = [
        createTask("ui-1", "src/ui/CompA.tsx", { priority: 10 }),
        createTask("ui-2", "src/ui/CompB.tsx", { priority: 9 }),
        createTask("backend-1", "src/api/UserApi.ts", { priority: 8 }),
        createTask("sec-1", "src/auth/AuthService.ts", { priority: 6 }),
      ];

      const state = createMultiDomainState(tasks);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 3.0,
        maxParallel: 4,
      });

      expect(result.implementerDispatches).toHaveLength(4);
      const dispatchedTaskIds = result.implementerDispatches.map((d) => d.taskId);
      expect(dispatchedTaskIds).toEqual(["ui-1", "backend-1", "sec-1", "ui-2"]);
    });
  });
});

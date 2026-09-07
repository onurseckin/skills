import { describe, expect, test } from "bun:test";
import {
  computeResourceDisjointness,
  partitionOrchestratorDomains,
  calculateValidatorAllocations,
  calculateCriticConcurrency,
} from "../../../olt/scripts/src/engine/scheduler/index.ts";

describe("Dynamic Topology: Partitions, Allocations & Disjointness", () => {
  describe("partitionOrchestratorDomains", () => {
    test("partitions tasks into domain clusters based on write scopes", () => {
      const tasks = [
        {
          id: "ui-task-1",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/ui/Button.tsx"],
        },
        {
          id: "ui-task-2",
          priority: 1,
          created_order: 2,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/ui/Nav.tsx"],
        },
        {
          id: "sys-task-1",
          priority: 1,
          created_order: 3,
          effort: 2,
          requirement_ids: [],
          write_scope: ["src/contracts/schema.graphql"],
        },
        {
          id: "core-task-1",
          priority: 1,
          created_order: 4,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/utils/math.ts"],
        },
      ];
      const deps = new Map([
        ["ui-task-1", new Set<string>()],
        ["ui-task-2", new Set<string>()],
        ["sys-task-1", new Set<string>()],
        ["core-task-1", new Set<string>()],
      ]);

      const partitions = partitionOrchestratorDomains(tasks, deps);
      expect(partitions.length).toBeGreaterThanOrEqual(3);
      const frontendPart = partitions.find((p) => p.domain === "frontend-ui");
      expect(frontendPart).toBeDefined();
      expect(frontendPart?.taskIds).toEqual(["ui-task-1", "ui-task-2"]);

      const backendPart = partitions.find((p) => p.domain === "backend-system");
      expect(backendPart).toBeDefined();
      expect(backendPart?.taskIds).toEqual(["sys-task-1"]);

      const corePart = partitions.find((p) => p.domain === "core-engine");
      expect(corePart).toBeDefined();
      expect(corePart?.taskIds).toEqual(["core-task-1"]);
    });

    test("identifies cross-orchestrator partition dependencies", () => {
      const tasks = [
        {
          id: "schema-task",
          priority: 1,
          created_order: 1,
          effort: 2,
          requirement_ids: [],
          write_scope: ["src/contracts/schema.proto"],
        },
        {
          id: "ui-task",
          priority: 1,
          created_order: 2,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/components/View.tsx"],
        },
      ];
      const deps = new Map([
        ["schema-task", new Set<string>()],
        ["ui-task", new Set(["schema-task"])],
      ]);

      const partitions = partitionOrchestratorDomains(tasks, deps);
      const uiPart = partitions.find((p) => p.domain === "frontend-ui");
      expect(uiPart).toBeDefined();
      expect(uiPart?.dependencies).toContain("orchestrator-domain-backend-system");
    });

    test("partitionOrchestratorDomains assigns core-engine domain for general paths", () => {
      const tasks = [
        {
          id: "core-1",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/utils/math.ts"],
        },
      ];
      const deps = new Map([["sec-1", new Set<string>()]]);
      const partitions = partitionOrchestratorDomains(tasks, deps);
      expect(partitions.some((p) => p.domain === "core-engine")).toBe(true);
    });

    test("partitionOrchestratorDomains limits partitions when maxPartitions is specified", () => {
      const tasks = [
        {
          id: "t-ui",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/ui/app.tsx"],
        },
        {
          id: "t-sec",
          priority: 1,
          created_order: 2,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/auth/token.ts"],
        },
        {
          id: "t-sys",
          priority: 1,
          created_order: 3,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/contracts/api.graphql"],
        },
        {
          id: "t-core",
          priority: 1,
          created_order: 4,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/core/math.ts"],
        },
      ];
      const deps = new Map([
        ["t-ui", new Set<string>()],
        ["t-sec", new Set<string>()],
        ["t-sys", new Set<string>()],
        ["t-core", new Set<string>()],
      ]);
      const partitions = partitionOrchestratorDomains(tasks, deps, 2);
      expect(partitions.length).toBe(2);
      const composite = partitions.find((p) => p.domain === "composite");
      expect(composite).toBeDefined();
      expect(composite?.partitionId).toBe("orchestrator-domain-composite");
      expect(composite?.taskIds.length).toBeGreaterThanOrEqual(2);
      expect(composite?.work).toBeGreaterThanOrEqual(2);
    });

    test("partitionOrchestratorDomains returns empty array for empty task list", () => {
      const partitions = partitionOrchestratorDomains([], new Map());
      expect(partitions).toEqual([]);
    });

    test("partitionOrchestratorDomains maps system-design paths to backend-system domain", () => {
      const tasks = [
        {
          id: "sys-1",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/contracts/user.graphql"],
        },
      ];
      const deps = new Map([["sys-1", new Set<string>()]]);
      const partitions = partitionOrchestratorDomains(tasks, deps);
      expect(partitions.some((p) => p.domain === "backend-system")).toBe(true);
    });

    test("partitionOrchestratorDomains assigns core-engine domain when write_scope is empty", () => {
      const tasks = [
        {
          id: "empty-scope-task",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: [],
        },
      ];
      const deps = new Map([["empty-scope-task", new Set<string>()]]);
      const partitions = partitionOrchestratorDomains(tasks, deps);
      expect(partitions.length).toBe(1);
      expect(partitions[0]?.domain).toBe("core-engine");
      expect(partitions[0]?.taskIds).toEqual(["empty-scope-task"]);
    });
  });

  describe("calculateValidatorAllocations", () => {
    test("calculates validator demand and fleet sizing based on task write scopes", () => {
      const tasks = [
        {
          id: "t1",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/index.ts"],
        },
        {
          id: "t2",
          priority: 1,
          created_order: 2,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/view.tsx"],
        },
        {
          id: "t3",
          priority: 1,
          created_order: 3,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/schema.graphql"],
        },
      ];

      const { demands, fleet } = calculateValidatorAllocations(tasks);
      expect(fleet["code-quality"]).toBeGreaterThanOrEqual(1);
      expect(fleet["ui-design"]).toBeGreaterThanOrEqual(1);
      expect(fleet["system-design"]).toBeGreaterThanOrEqual(1);

      const codeQual = demands.find((d) => d.domain === "code-quality");
      expect(codeQual?.taskCount).toBe(3);
    });

    test("returns zeroed demands and fleet allocations for empty tasks", () => {
      const { demands, fleet } = calculateValidatorAllocations([]);
      expect(fleet["code-quality"]).toBe(0);
      expect(fleet["ui-design"]).toBe(0);
      expect(fleet["system-design"]).toBe(0);
      expect(fleet.product).toBe(0);
      expect(fleet.security).toBe(0);
      expect(demands.every((d) => d.taskCount === 0 && d.recommendedValidators === 0)).toBe(true);
    });

    test("handles tasks with duplicate requirement IDs consistently", () => {
      const tasks = [
        {
          id: "dup-req-task",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: ["R-001", "R-001", "R-002"],
          write_scope: ["src/ui/Component.tsx"],
        },
      ];
      const { demands, fleet } = calculateValidatorAllocations(tasks);
      expect(fleet["code-quality"]).toBe(1);
      expect(fleet["ui-design"]).toBe(1);
      const uiDemand = demands.find((d) => d.domain === "ui-design");
      expect(uiDemand?.taskCount).toBe(1);
    });
  });

  describe("calculateCriticConcurrency", () => {
    test("sizes critic concurrency dynamically bounded between 1 and 4", () => {
      expect(calculateCriticConcurrency(0, 1, 1)).toBe(1);
      expect(calculateCriticConcurrency(2, 1, 1)).toBe(1);
      expect(calculateCriticConcurrency(10, 2, 3)).toBe(3);
      expect(calculateCriticConcurrency(50, 2, 8)).toBe(4);
    });

    test("handles zero values and edge bounds gracefully", () => {
      expect(calculateCriticConcurrency(0, 0, 0)).toBe(1);
      expect(calculateCriticConcurrency(10, 0, 0)).toBe(1);
      expect(calculateCriticConcurrency(100, 1, 10)).toBe(4);
    });
  });

  describe("computeResourceDisjointness", () => {
    test("computes disjoint components for independent tasks with disjoint write scopes", () => {
      const tasks = [
        {
          id: "t1",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/a.ts"],
        },
        {
          id: "t2",
          priority: 1,
          created_order: 2,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/b.ts"],
        },
        {
          id: "t3",
          priority: 1,
          created_order: 3,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/c.ts"],
        },
      ];
      const metrics = computeResourceDisjointness(tasks);
      expect(metrics.disjointComponentCount).toBe(3);
      expect(metrics.disjointnessScore).toBe(1);
      expect(metrics.componentTaskIds.length).toBe(3);
    });

    test("merges conflicting tasks into same connected component", () => {
      const tasks = [
        {
          id: "t1",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/shared.ts"],
        },
        {
          id: "t2",
          priority: 1,
          created_order: 2,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/shared.ts"],
        },
        {
          id: "t3",
          priority: 1,
          created_order: 3,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/isolated.ts"],
        },
      ];
      const metrics = computeResourceDisjointness(tasks);
      expect(metrics.disjointComponentCount).toBe(2);
      expect(metrics.disjointnessScore).toBe(0.67);
    });

    test("merges hierarchical path containment into the same connected component", () => {
      const tasks = [
        {
          id: "parent-dir-task",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/components"],
        },
        {
          id: "child-file-task",
          priority: 1,
          created_order: 2,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/components/Button.tsx"],
        },
        {
          id: "other-task",
          priority: 1,
          created_order: 3,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/services/api.ts"],
        },
      ];
      const metrics = computeResourceDisjointness(tasks);
      expect(metrics.disjointComponentCount).toBe(2);
      const parentComp = metrics.componentTaskIds.find((c) => c.includes("parent-dir-task"));
      expect(parentComp).toContain("child-file-task");
    });

    test("returns zero components on empty task array", () => {
      const metrics = computeResourceDisjointness([]);
      expect(metrics.disjointComponentCount).toBe(0);
      expect(metrics.disjointnessScore).toBe(1);
      expect(metrics.componentTaskIds).toEqual([]);
    });

    test("merges glob wildcard scopes and child paths into the same connected component", () => {
      const tasks = [
        {
          id: "glob-task",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/components/**"],
        },
        {
          id: "child-task",
          priority: 1,
          created_order: 2,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/components/Button.tsx"],
        },
      ];
      const metrics = computeResourceDisjointness(tasks);
      expect(metrics.disjointComponentCount).toBe(1);
      expect(metrics.disjointnessScore).toBe(0.5);
    });
  });
});

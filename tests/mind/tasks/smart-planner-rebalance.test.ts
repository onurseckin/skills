import { describe, expect, it, spyOn, afterEach } from "bun:test";
import * as memoryMod from "../../../olt/scripts/src/mind/tasks/smart/planner/memory.ts";
import * as queueMod from "../../../olt/scripts/src/task/queue/index.ts";
import {
  rebalanceTasksWithBrentLimits,
  integrateMacroMetricsIntoMemory,
  rebalanceTaskQueueWithBrentLimits,
} from "../../../olt/scripts/src/mind/tasks/smart/planner/rebalance.ts";
import type { SmartTaskPlan } from "../../../olt/scripts/src/mind/tasks/smart/planner/models.ts";
import type { TaskQueueItem } from "../../../olt/scripts/src/task/queue/index.ts";

describe("Smart Planner Rebalance with Brent Limits", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  });

  const dummyMemory = {
    version: 1,
    last_updated: "",
    strategic_focus: [],
    active_hypotheses: [],
    roadmaps: [],
  };

  const makeTask = (overrides: Partial<SmartTaskPlan> = {}): SmartTaskPlan => ({
    id: "task-1",
    label: "Task 1",
    write_scope: ["src/a.ts"],
    gate: "bun test",
    charter_goals: ["G1"],
    acceptance_criteria: ["pass"],
    dependencies: [],
    source_type: "direct_prompt",
    priority: "HIGH",
    rationale: "Initial task",
    assigned_tier: "Tier_3_Implementer",
    assigned_implementer: "imp-1",
    assigned_validator: "val-1",
    ...overrides,
  });

  describe("rebalanceTasksWithBrentLimits", () => {
    it("handles empty tasks array without updating memory", () => {
      const result = rebalanceTasksWithBrentLimits([]);
      expect(result.total_tasks).toBe(0);
      expect(result.total_waves).toBe(0);
      expect(result.waves).toHaveLength(0);
      expect(result.optimal_lanes).toBe(1);
      expect(result.decoupled_edges_count).toBe(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.macro_metrics).toEqual({ work: 0, span: 0, parallelism: 0, efficiency: 0 });
    });

    it("handles empty tasks array with autoUpdateMemory true and swallows update errors", () => {
      let memoryUpdated = false;
      spies.push(
        spyOn(memoryMod, "updateCognitiveMemory").mockImplementation((u) => {
          memoryUpdated = true;
          return u(dummyMemory);
        }),
      );
      const result = rebalanceTasksWithBrentLimits([], { autoUpdateMemory: true });
      expect(memoryUpdated).toBe(true);
      expect(result.total_tasks).toBe(0);

      spies.push(
        spyOn(memoryMod, "updateCognitiveMemory").mockImplementation(() => {
          throw new Error("Disk error");
        }),
      );
      expect(() => rebalanceTasksWithBrentLimits([], { autoUpdateMemory: true })).not.toThrow();
    });

    it("preserves missing dependency IDs not found in task map", () => {
      const t1 = makeTask({ id: "t1", dependencies: ["t-nonexistent"] });
      const result = rebalanceTasksWithBrentLimits([t1]);
      expect(result.total_tasks).toBe(1);
      expect(result.decoupled_edges_count).toBe(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("preserves dependency when write scopes overlap", () => {
      const t1 = makeTask({ id: "t1", write_scope: ["src/shared.ts"] });
      const t2 = makeTask({ id: "t2", write_scope: ["src/shared.ts"], dependencies: ["t1"] });
      const result = rebalanceTasksWithBrentLimits([t1, t2]);
      expect(result.decoupled_edges_count).toBe(0);
      expect(result.total_waves).toBe(2);
    });

    it("decouples artificial dependency when write scopes are disjoint and unjustified", () => {
      const t1 = makeTask({ id: "t1", write_scope: ["src/a.ts"] });
      const t2 = makeTask({
        id: "t2",
        write_scope: ["src/b.ts"],
        dependencies: ["t1"],
        rationale: "Work",
      });
      const result = rebalanceTasksWithBrentLimits([t1, t2]);
      expect(result.decoupled_edges_count).toBe(1);
      expect(result.warnings[0]).toContain("Decoupled artificial dependency: t2 -> t1");
    });

    it("preserves disjoint dependency when justified by dataflow, artifact, or metadata", () => {
      const t1 = makeTask({ id: "t1", write_scope: ["src/a.ts"] });
      const tDataflow = makeTask({
        id: "td",
        write_scope: ["src/b.ts"],
        dependencies: ["t1"],
        rationale: "dataflow edge",
      });
      const tArtifact = makeTask({
        id: "ta",
        write_scope: ["src/c.ts"],
        dependencies: ["t1"],
        rationale: "artifact dep",
      });
      const tMeta = makeTask({
        id: "tm",
        write_scope: ["src/d.ts"],
        dependencies: ["t1"],
        rationale: "custom",
        metadata: { justification: "explicit" },
      });

      const preserved = rebalanceTasksWithBrentLimits([t1, tDataflow, tArtifact, tMeta]);
      expect(preserved.decoupled_edges_count).toBe(0);

      const decoupled = rebalanceTasksWithBrentLimits([t1, tDataflow], {
        preserveJustified: false,
      });
      expect(decoupled.decoupled_edges_count).toBe(1);
    });

    it("calculates optimal lanes respecting maxLanes and autoUpdates memory with non-empty tasks", () => {
      let memoryUpdated = false;
      spies.push(
        spyOn(memoryMod, "updateCognitiveMemory").mockImplementation((u) => {
          memoryUpdated = true;
          return u(dummyMemory);
        }),
      );
      const t1 = makeTask({ id: "t1", write_scope: ["src/1.ts"] });
      const t2 = makeTask({ id: "t2", write_scope: ["src/2.ts"] });
      const t3 = makeTask({ id: "t3", write_scope: ["src/3.ts"] });

      const result = rebalanceTasksWithBrentLimits([t1, t2, t3], {
        maxLanes: 2,
        autoUpdateMemory: true,
      });
      expect(memoryUpdated).toBe(true);
      expect(result.total_tasks).toBe(3);
      expect(result.optimal_lanes).toBeLessThanOrEqual(2);
      expect(result.hierarchy_scaling).toBeDefined();
      expect(result.fast_path_compaction).toBeDefined();
      expect(result.multi_coordinator_partitions).toBeDefined();

      spies.push(
        spyOn(memoryMod, "updateCognitiveMemory").mockImplementation(() => {
          throw new Error("Update failure");
        }),
      );
      expect(() => rebalanceTasksWithBrentLimits([t1], { autoUpdateMemory: true })).not.toThrow();
    });
  });

  describe("integrateMacroMetricsIntoMemory", () => {
    it("integrates explicit tasks into cognitive memory", () => {
      let capturedState: memoryMod.CognitiveMemoryState | undefined;
      spies.push(
        spyOn(memoryMod, "updateCognitiveMemory").mockImplementation((u) => {
          capturedState = u(dummyMemory);
          return capturedState;
        }),
      );
      const t1 = makeTask({ id: "t1", write_scope: ["src/a.ts"] });
      const state = integrateMacroMetricsIntoMemory([t1], { maxLanes: 10 });
      expect(state.macro_metrics).toBeDefined();
      expect(capturedState?.macro_metrics?.work).toBe(1);
    });

    it("falls back to reading task queue when tasksOrQueue is omitted or empty", () => {
      const queueItem: TaskQueueItem = {
        id: "q-1",
        label: "Queue Item",
        category: "CORE_ENGINE",
        write_scope: ["src/core.ts"],
        gate: "bun test",
        dependencies: [],
        status: "PENDING",
        priority: "NORMAL",
        created_at: new Date().toISOString(),
      };
      spies.push(spyOn(queueMod, "readTaskQueue").mockReturnValue([queueItem]));
      spies.push(
        spyOn(memoryMod, "updateCognitiveMemory").mockImplementation((u) => u(dummyMemory)),
      );

      const state1 = integrateMacroMetricsIntoMemory(undefined, {
        queuePath: "/custom/queue.json",
      });
      expect(state1.macro_metrics).toBeDefined();
      const state2 = integrateMacroMetricsIntoMemory([], { queuePath: "/custom/queue.json" });
      expect(state2.macro_metrics).toBeDefined();
    });
  });

  describe("rebalanceTaskQueueWithBrentLimits", () => {
    it("rebalances queue items, computes metrics, and updates memory", () => {
      const queueItems: TaskQueueItem[] = [
        {
          id: "q-1",
          label: "Q1",
          category: "CORE_ENGINE",
          write_scope: ["src/a.ts"],
          gate: "bun test",
          dependencies: [],
          status: "PENDING",
          priority: "NORMAL",
          created_at: "",
        },
        {
          id: "q-2",
          label: "Q2",
          category: "CORE_ENGINE",
          write_scope: ["src/b.ts"],
          gate: "bun test",
          dependencies: [],
          status: "PENDING",
          priority: "NORMAL",
          created_at: "",
        },
      ];
      spies.push(spyOn(queueMod, "readTaskQueue").mockReturnValue(queueItems));
      spies.push(
        spyOn(memoryMod, "updateCognitiveMemory").mockImplementation((u) => u(dummyMemory)),
      );

      const result = rebalanceTaskQueueWithBrentLimits({ maxLanes: 10 });
      expect(result.updated_tasks).toEqual(queueItems);
      expect(result.macro_metrics.work).toBe(2);
      expect(result.optimal_lanes).toBeGreaterThanOrEqual(1);
      expect(result.optimal_lanes).toBeLessThanOrEqual(10);
    });

    it("handles empty queue correctly with fallback lane calculations", () => {
      spies.push(spyOn(queueMod, "readTaskQueue").mockReturnValue([]));
      spies.push(
        spyOn(memoryMod, "updateCognitiveMemory").mockImplementation((u) => u(dummyMemory)),
      );

      const result = rebalanceTaskQueueWithBrentLimits();
      expect(result.updated_tasks).toEqual([]);
      expect(result.optimal_lanes).toBe(1);
    });
  });
});

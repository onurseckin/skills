import { describe, expect, it } from "bun:test";
import {
  DEFAULT_DIMENSIONAL_WEIGHTS,
  clampScore,
  extractSystemMetricsFromState,
  extractTasksFromState,
} from "../../../../olt/scripts/src/mind/lifecycle/cognition/state.ts";
import {
  MAX_COGNITIVE_SCORE,
  MIN_COGNITIVE_SCORE,
} from "../../../../olt/scripts/src/mind/lifecycle/cognition/types.ts";

describe("Mind Lifecycle Cognition State Suite (state.ts)", () => {
  describe("DEFAULT_DIMENSIONAL_WEIGHTS", () => {
    it("defines valid default dimensional weights summing to 1.0", () => {
      expect(DEFAULT_DIMENSIONAL_WEIGHTS.simplicity).toBe(0.15);
      expect(DEFAULT_DIMENSIONAL_WEIGHTS.performance).toBe(0.2);
      expect(DEFAULT_DIMENSIONAL_WEIGHTS.observability).toBe(0.15);
      expect(DEFAULT_DIMENSIONAL_WEIGHTS.type_safety).toBe(0.2);
      expect(DEFAULT_DIMENSIONAL_WEIGHTS.ast_purity).toBe(0.15);
      expect(DEFAULT_DIMENSIONAL_WEIGHTS.dag_concurrency).toBe(0.15);

      const sum =
        DEFAULT_DIMENSIONAL_WEIGHTS.simplicity +
        DEFAULT_DIMENSIONAL_WEIGHTS.performance +
        DEFAULT_DIMENSIONAL_WEIGHTS.observability +
        DEFAULT_DIMENSIONAL_WEIGHTS.type_safety +
        DEFAULT_DIMENSIONAL_WEIGHTS.ast_purity +
        DEFAULT_DIMENSIONAL_WEIGHTS.dag_concurrency;
      expect(Number(sum.toFixed(2))).toBe(1.0);
    });
  });

  describe("clampScore", () => {
    it("clamps scores below MIN_COGNITIVE_SCORE to minimum", () => {
      expect(clampScore(MIN_COGNITIVE_SCORE - 10)).toBe(MIN_COGNITIVE_SCORE);
      expect(clampScore(-50)).toBe(0);
    });

    it("clamps scores above MAX_COGNITIVE_SCORE to maximum", () => {
      expect(clampScore(MAX_COGNITIVE_SCORE + 25)).toBe(MAX_COGNITIVE_SCORE);
      expect(clampScore(150)).toBe(100);
    });

    it("rounds valid floating scores to two decimal places", () => {
      expect(clampScore(75.556)).toBe(75.56);
      expect(clampScore(42.10001)).toBe(42.1);
      expect(clampScore(50)).toBe(50);
      expect(clampScore(MIN_COGNITIVE_SCORE)).toBe(MIN_COGNITIVE_SCORE);
      expect(clampScore(MAX_COGNITIVE_SCORE)).toBe(MAX_COGNITIVE_SCORE);
    });
  });

  describe("extractTasksFromState", () => {
    it("returns empty array for non-record state values", () => {
      expect(extractTasksFromState(null)).toEqual([]);
      expect(extractTasksFromState(undefined)).toEqual([]);
      expect(extractTasksFromState("string-state")).toEqual([]);
      expect(extractTasksFromState(12345)).toEqual([]);
      expect(extractTasksFromState(true)).toEqual([]);
      expect(extractTasksFromState(["array", "state"])).toEqual([]);
    });

    it("returns empty array when tasks field is missing or not a record", () => {
      expect(extractTasksFromState({})).toEqual([]);
      expect(extractTasksFromState({ tasks: null })).toEqual([]);
      expect(extractTasksFromState({ tasks: "invalid" })).toEqual([]);
      expect(extractTasksFromState({ tasks: [1, 2, 3] })).toEqual([]);
      expect(extractTasksFromState({ tasks: 99 })).toEqual([]);
    });

    it("extracts structured tasks and normalizes properties", () => {
      const state = {
        tasks: {
          "task-key-1": {
            id: "task-custom-id",
            status: "ready",
            dependencies: ["dep-1", 123, null],
            write_scope: ["src/a", 456, undefined],
            gate_command: "bun test tests/a.test.ts",
          },
          "task-key-2": {
            // Missing id should fall back to key
            status: "done",
            dependencies: "not-an-array",
            write_scope: "not-an-array",
          },
          "task-key-3": {
            id: "", // Empty string should fall back to key
            // Missing status should fall back to unknown
            dependencies: ["dep-x"],
            write_scope: ["src/c"],
            gate_command: 123, // non-string ignored
          },
          "task-key-invalid": "not-an-object",
        },
      };

      const tasks = extractTasksFromState(state);
      expect(tasks).toHaveLength(3);

      expect(tasks[0]).toEqual({
        id: "task-custom-id",
        status: "ready",
        dependencies: ["dep-1"],
        write_scope: ["src/a"],
        gate_command: "bun test tests/a.test.ts",
      });

      expect(tasks[1]).toEqual({
        id: "task-key-2",
        status: "done",
        dependencies: [],
        write_scope: [],
        gate_command: undefined,
      });

      expect(tasks[2]).toEqual({
        id: "task-key-3",
        status: "unknown",
        dependencies: ["dep-x"],
        write_scope: ["src/c"],
        gate_command: undefined,
      });
    });
  });

  describe("extractSystemMetricsFromState", () => {
    it("extracts baseline metrics from empty state", () => {
      const metrics = extractSystemMetricsFromState({});
      expect(metrics).toEqual({
        totalTasks: 0,
        completedTasks: 0,
        readyTasks: 0,
        pendingTasks: 0,
        failedTasks: 0,
        totalFiles: 0,
        hasCycles: false,
        falseBarrierCount: 0,
        astViolationCount: 0,
        untypedFieldCount: 0,
      });
    });

    it("counts custom files when provided", () => {
      const metrics = extractSystemMetricsFromState({}, ["file1.ts", "file2.ts", "file3.ts"]);
      expect(metrics.totalFiles).toBe(3);
    });

    it("categorizes all task statuses accurately", () => {
      const state = {
        tasks: {
          t1: { status: "done" },
          t2: { status: "succeeded" },
          t3: { status: "satisfied" },
          t4: { status: "ready" },
          t5: { status: "leased" },
          t6: { status: "pending" },
          t7: { status: "draft" },
          t8: { status: "failed" },
          t9: { status: "rejected" },
          t10: { status: "changes_requested" },
          t11: { status: "in_progress" }, // unrecognized, increments totalTasks only
        },
      };

      const metrics = extractSystemMetricsFromState(state);
      expect(metrics.totalTasks).toBe(11);
      expect(metrics.completedTasks).toBe(3);
      expect(metrics.readyTasks).toBe(2);
      expect(metrics.pendingTasks).toBe(2);
      expect(metrics.failedTasks).toBe(3);
    });

    it("identifies false barriers when dependent tasks have completely disjoint write scopes", () => {
      const state = {
        tasks: {
          t1: {
            id: "t1",
            status: "ready",
            dependencies: [],
            write_scope: ["src/engine/a.ts"],
          },
          t2: {
            id: "t2",
            status: "pending",
            dependencies: ["t1"],
            write_scope: ["src/engine/b.ts"], // Disjoint scope from t1 -> False barrier!
          },
          t3: {
            id: "t3",
            status: "pending",
            dependencies: ["t1"],
            write_scope: ["src/engine/a.ts"], // Overlapping scope -> Legitimate barrier
          },
          t4: {
            id: "t4",
            status: "pending",
            dependencies: ["t1"],
            write_scope: [], // Empty write_scope -> Not counted as false barrier
          },
          t5: {
            id: "t5",
            status: "pending",
            dependencies: ["non_existent_dep"], // Missing dep -> Safely skipped
            write_scope: ["src/engine/c.ts"],
          },
        },
      };

      const metrics = extractSystemMetricsFromState(state);
      expect(metrics.totalTasks).toBe(5);
      expect(metrics.falseBarrierCount).toBe(1);
    });
  });
});

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertNoUnfulfilledDemands,
  evaluateUnfulfilledDemands,
} from "../../../olt/scripts/src/platform/index.ts";

describe("Aggressive Unfulfilled-Demand Pushback Engine", () => {
  test("returns clean report when all planned tasks are fulfilled (done / validated)", () => {
    const fullyFulfilledState: JsonObject = {
      tasks: {
        "task-1": {
          status: "done",
          write_scope: ["src/a.ts"],
          label: "Task 1",
        },
        "task-2": {
          status: "validated",
          write_scope: ["src/b.ts"],
          label: "Task 2",
        },
      },
      graph: {
        nodes: [
          { id: "task-1", type: "task", status: "done" },
          { id: "task-2", type: "task", status: "validated" },
        ],
      },
    };

    const report = evaluateUnfulfilledDemands(fullyFulfilledState);
    expect(report.hasUnfulfilledDemands).toBeFalse();
    expect(report.totalPlanned).toBe(2);
    expect(report.totalUnfulfilled).toBe(0);
    expect(report.unfulfilledItems.length).toBe(0);
    expect(report.blockingPushbackMessage).toBeUndefined();

    expect(() => assertNoUnfulfilledDemands(fullyFulfilledState)).not.toThrow();
  });

  test("detects unfulfilled planned tasks and isolates root causes accurately", () => {
    const unfulfilledState: JsonObject = {
      tasks: {
        "task-1": {
          status: "done",
          write_scope: ["src/a.ts"],
        },
        "task-2": {
          status: "ready",
          write_scope: ["src/b.ts"],
          label: "Task 2 Ready",
        },
        "task-3": {
          status: "leased",
          write_scope: ["src/c.ts"],
          label: "Task 3 Leased",
          lease: {
            agent_id: "worker-3",
          },
        },
        "task-4": {
          status: "changes_requested",
          write_scope: ["src/d.ts"],
          label: "Task 4 Changes",
        },
        "task-5": {
          status: "stale",
          write_scope: ["src/e.ts"],
          label: "Task 5 Stale",
        },
      },
      graph: {
        nodes: [
          { id: "task-1", type: "task" },
          { id: "task-2", type: "task" },
          { id: "task-3", type: "task" },
          { id: "task-4", type: "task" },
          { id: "task-5", type: "task" },
        ],
      },
    };

    const report = evaluateUnfulfilledDemands(unfulfilledState);
    expect(report.hasUnfulfilledDemands).toBeTrue();
    expect(report.totalPlanned).toBe(5);
    expect(report.totalUnfulfilled).toBe(4);
    expect(report.unfulfilledItems.length).toBe(4);

    const task2Item = report.unfulfilledItems.find((i) => i.id === "task-2");
    expect(task2Item).toBeDefined();
    expect(task2Item?.rootCause).toContain("never claimed by an implementer");

    const task3Item = report.unfulfilledItems.find((i) => i.id === "task-3");
    expect(task3Item).toBeDefined();
    expect(task3Item?.rootCause).toContain("submission evidence was never recorded");
    expect(task3Item?.assignedAgentId).toBe("worker-3");

    const task4Item = report.unfulfilledItems.find((i) => i.id === "task-4");
    expect(task4Item).toBeDefined();
    expect(task4Item?.rootCause).toContain("open validator findings");

    const task5Item = report.unfulfilledItems.find((i) => i.id === "task-5");
    expect(task5Item).toBeDefined();
    expect(task5Item?.rootCause).toContain("lease expired before completion");

    expect(report.blockingPushbackMessage).toContain("[AGGRESSIVE UNFULFILLED-DEMAND PUSHBACK]");
    expect(report.blockingPushbackMessage).toContain("4 planned action(s)/lane(s)/task(s)");
  });

  test("evaluates wave lanes and surfaces blocked execution lanes", () => {
    const stateWithTopology: JsonObject = {
      tasks: {
        "task-1": { status: "done", write_scope: ["src/a.ts"] },
        "task-2": { status: "proposed", write_scope: ["src/b.ts"] },
      },
      topology: {
        waves: [
          { wave: 1, task_ids: ["task-1"] },
          { wave: 2, task_ids: ["task-2"] },
        ],
      },
    };

    const reportWave1 = evaluateUnfulfilledDemands(stateWithTopology, { targetWave: 1 });
    expect(reportWave1.unfulfilledItems.some((i) => i.kind === "lane")).toBeFalse();

    const reportWave2 = evaluateUnfulfilledDemands(stateWithTopology, { targetWave: 2 });
    expect(reportWave2.hasUnfulfilledDemands).toBeTrue();
    const wave2Lane = reportWave2.unfulfilledItems.find((i) => i.id === "lane-wave-2");
    expect(wave2Lane).toBeDefined();
    expect(wave2Lane?.kind).toBe("lane");
    expect(wave2Lane?.rootCause).toContain("Wave 2 lane has 1 unfulfilled tasks: [task-2]");
  });

  test("assertNoUnfulfilledDemands throws harsh blocking HarnessError with root-cause isolation", () => {
    const blockedState: JsonObject = {
      tasks: {
        "task-core": {
          status: "proposed",
          write_scope: ["src/core.ts"],
        },
      },
    };

    expect(() => assertNoUnfulfilledDemands(blockedState)).toThrow(HarnessError);

    try {
      assertNoUnfulfilledDemands(blockedState);
    } catch (err) {
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_STATE");
      expect(harnessErr.message).toContain("[AGGRESSIVE UNFULFILLED-DEMAND PUSHBACK]");
      expect(harnessErr.message).toContain("task-core");
      expect(harnessErr.fix).toContain("bun harness.ts task:claim --task task-core");
      expect(harnessErr.issues.length).toBe(1);
    }
  });

  test("evaluates strict gates and admitted candidates when requested", () => {
    const strictState: JsonObject = {
      tasks: {
        "task-1": { status: "done", write_scope: ["src/a.ts"] },
      },
      graph: {
        gates: [{ id: "gate-platform", mandatory: true, status: "pending" }],
      },
      candidates: [{ id: "cand-new-feature", status: "admitted", write_scope: ["src/feature.ts"] }],
    };

    const report = evaluateUnfulfilledDemands(strictState, {
      strictGates: true,
      strictCandidates: true,
    });

    expect(report.hasUnfulfilledDemands).toBeTrue();
    const gateItem = report.unfulfilledItems.find((i) => i.id === "gate-platform");
    expect(gateItem).toBeDefined();
    expect(gateItem?.kind).toBe("gate");
    expect(gateItem?.rootCause).toContain("Mandatory gate 'gate-platform' has not passed");
  });

  test("handles tasks defined only in graph.nodes, validating/submitted statuses, and targetTaskIds filter", () => {
    const state: JsonObject = {
      tasks: {
        "task-sub": {
          status: "submitted",
          write_scope: ["src/sub.ts"],
        },
        "task-val": {
          status: "validating",
          write_scope: ["src/val.ts"],
        },
        "task-ignored": {
          status: "ready",
          write_scope: ["src/ignored.ts"],
        },
      },
      graph: {
        nodes: [
          {
            id: "task-graph-only",
            type: "task",
            status: "proposed",
            write_scope: ["src/g.ts"],
            label: "Graph Only",
          },
        ],
      },
    };

    const report = evaluateUnfulfilledDemands(state, {
      targetTaskIds: ["task-sub", "task-val", "task-graph-only"],
    });

    expect(report.hasUnfulfilledDemands).toBeTrue();
    expect(report.unfulfilledItems.length).toBe(3);

    const subItem = report.unfulfilledItems.find((i) => i.id === "task-sub");
    expect(subItem?.rootCause).toContain("awaiting independent validator sign-off");

    const valItem = report.unfulfilledItems.find((i) => i.id === "task-val");
    expect(valItem?.rootCause).toContain("awaiting independent validator sign-off");

    const graphOnlyItem = report.unfulfilledItems.find((i) => i.id === "task-graph-only");
    expect(graphOnlyItem?.label).toBe("Graph Only");
    expect(graphOnlyItem?.rootCause).toContain("never claimed by an implementer");
  });

  test("flags admitted candidates when 0 tasks exist in plan under strictCandidates", () => {
    const state: JsonObject = {
      candidates: [{ id: "cand-1", status: "admitted", write_scope: ["src/c1.ts"] }],
    };

    const report = evaluateUnfulfilledDemands(state, { strictCandidates: true });
    expect(report.hasUnfulfilledDemands).toBeTrue();
    const candItem = report.unfulfilledItems.find((i) => i.id === "cand-1");
    expect(candItem).toBeDefined();
    expect(candItem?.kind).toBe("action");
    expect(candItem?.status).toBe("admitted_unplanned");
    expect(candItem?.rootCause).toContain("no execution tasks were planned or completed");
  });
});

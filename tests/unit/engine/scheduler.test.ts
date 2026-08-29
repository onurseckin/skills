import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  scopeConflict,
  resourceConflict,
  hasActiveOwnership,
  proposeBatch,
  readySet,
  computeTopology,
  type SchedulingMetrics,
} from "../../../olt/scripts/src/engine/scheduler/index.ts";
import {
  rankTasks,
  type ScheduledTask,
} from "../../../olt/scripts/src/engine/scheduler/conflict/rank.ts";
import {
  computeReceiptHash,
  generateReceiptBadge,
  generateReceiptSummaryBadge,
  type CliDiagnosticReceipt,
} from "../../../olt/scripts/src/engine/scheduler/diagnostics/index.ts";

describe("Scheduler Conflicts", () => {
  test("scopeConflict correctly identifies overlapping directory and glob scopes", () => {
    expect(scopeConflict(["src/engine"], ["src/engine"])).toBe(true);
    expect(scopeConflict(["src/engine/runner"], ["src/engine/**"])).toBe(true);
    expect(scopeConflict(["src/auth/*"], ["src/auth/login.ts"])).toBe(true);
    expect(scopeConflict(["src/feature-a"], ["src/feature-b"])).toBe(false);
    expect(scopeConflict(["tests/unit"], ["src/unit"])).toBe(false);
  });

  test("resourceConflict detects shared external resources", () => {
    expect(resourceConflict(["db:postgres"], ["db:postgres"])).toBe(true);
    expect(resourceConflict(["db:postgres", "port:8080"], ["port:8080"])).toBe(true);
    expect(resourceConflict(["db:postgres"], ["db:mysql"])).toBe(false);
    expect(resourceConflict([], ["db:postgres"])).toBe(false);
  });

  test("hasActiveOwnership identifies statuses that hold write locks", () => {
    expect(hasActiveOwnership("leased")).toBe(true);
    expect(hasActiveOwnership("active")).toBe(true);
    expect(hasActiveOwnership("submitted")).toBe(true);
    expect(hasActiveOwnership("validating")).toBe(true);
    expect(hasActiveOwnership("failed")).toBe(true);
    expect(hasActiveOwnership("proposed")).toBe(false);
    expect(hasActiveOwnership("done")).toBe(false);
  });
});

describe("Scheduler Rank", () => {
  const dummyMetrics: SchedulingMetrics = {
    criticalDepth: new Map([
      ["task-1", 5],
      ["task-2", 10],
      ["task-3", 5],
    ]),
    descendants: new Map([
      ["task-1", 2],
      ["task-2", 4],
      ["task-3", 3],
    ]),
  };

  test("rankTasks sorts primarily by priority (descending)", () => {
    const tasks: ScheduledTask[] = [
      {
        id: "task-low",
        priority: 1,
        created_order: 0,
        effort: 1,
        requirement_ids: ["r1"],
        write_scope: ["a"],
      },
      {
        id: "task-high",
        priority: 10,
        created_order: 0,
        effort: 1,
        requirement_ids: ["r2"],
        write_scope: ["b"],
      },
    ];
    const ranked = rankTasks(tasks, { criticalDepth: new Map(), descendants: new Map() });
    expect(ranked[0]?.id).toBe("task-high");
    expect(ranked[1]?.id).toBe("task-low");
  });

  test("rankTasks breaks ties by criticalDepth then descendants then created_order then effort then id", () => {
    const tasks: ScheduledTask[] = [
      {
        id: "task-1",
        priority: 5,
        created_order: 2,
        effort: 5,
        requirement_ids: ["r1"],
        write_scope: ["a"],
      },
      {
        id: "task-2",
        priority: 5,
        created_order: 1,
        effort: 3,
        requirement_ids: ["r2"],
        write_scope: ["b"],
      },
      {
        id: "task-3",
        priority: 5,
        created_order: 1,
        effort: 3,
        requirement_ids: ["r3"],
        write_scope: ["c"],
      },
    ];
    const ranked = rankTasks(tasks, dummyMetrics);
    // task-2 has criticalDepth 10, task-3 has criticalDepth 5 with 3 descendants, task-1 has criticalDepth 5 with 2 descendants
    expect(ranked.map((t) => t.id)).toEqual(["task-2", "task-3", "task-1"]);
  });
});

describe("Scheduler Batch Proposal and Ready Set", () => {
  const baseState = {
    schema: "harness.run-state",
    version: 1,
    graph: {
      schema: "harness.graph",
      version: 1,
      revision: 1,
      nodes: [
        { id: "task-1", type: "task" },
        { id: "task-2", type: "task" },
        { id: "task-3", type: "task" },
      ],
      edges: [{ source: "task-2", target: "task-1", type: "depends_on" }],
      gates: [],
    },
    tasks: {
      "task-1": {
        id: "task-1",
        label: "Task 1",
        status: "ready",
        priority: 10,
        created_order: 1,
        effort: 2,
        requirement_ids: ["req-1"],
        write_scope: ["src/module1"],
      },
      "task-2": {
        id: "task-2",
        label: "Task 2",
        status: "proposed",
        priority: 5,
        created_order: 2,
        effort: 2,
        requirement_ids: ["req-2"],
        write_scope: ["src/module2"],
      },
      "task-3": {
        id: "task-3",
        label: "Task 3",
        status: "ready",
        priority: 8,
        created_order: 3,
        effort: 1,
        requirement_ids: ["req-3"],
        write_scope: ["src/module1"], // Conflicts with task-1
      },
    },
    requirements: [
      { id: "req-1", disposition: "actionable" },
      { id: "req-2", disposition: "actionable" },
      { id: "req-3", disposition: "actionable" },
    ],
  };

  test("proposeBatch schedules non-conflicting tasks without unmet dependencies", () => {
    const batch = proposeBatch(baseState, 5);
    // task-1 is eligible. task-2 depends on task-1 (unmet). task-3 conflicts with task-1.
    expect(batch.map((t) => t.id)).toEqual(["task-1"]);
  });

  test("proposeBatch schedules task-2 once task-1 is marked done", () => {
    const state = structuredClone(baseState);
    (state.tasks["task-1"] as Record<string, unknown>).status = "done";

    const batch = proposeBatch(state, 5);
    // task-2 dependencies are now done. task-3 is also eligible.
    // task-3 priority 8 > task-2 priority 5, no write scope overlap between module1 and module2
    expect(batch.map((t) => t.id)).toEqual(["task-3", "task-2"]);
  });

  test("proposeBatch respects maxParallel constraint", () => {
    const state = structuredClone(baseState);
    (state.tasks["task-1"] as Record<string, unknown>).status = "done";

    const batch = proposeBatch(state, 1);
    expect(batch).toHaveLength(1);
    expect(batch[0]?.id).toBe("task-3");
  });

  test("proposeBatch throws HarnessError on invalid maxParallel or state", () => {
    expect(() => proposeBatch(baseState, 0)).toThrow(HarnessError);
    expect(() => proposeBatch(baseState, -1)).toThrow(HarnessError);
    expect(() => proposeBatch({}, 2)).toThrow(HarnessError);
  });

  test("readySet generates ReadySetSelection with formatted entries", () => {
    const selection = readySet(baseState, 2);
    expect(selection.max_parallel).toBe(2);
    expect(selection.topology_source).toBe("absent");
    expect(selection.entries).toHaveLength(1);
    expect(selection.entries[0]?.task_id).toBe("task-1");
    expect(selection.entries[0]?.label).toBe("Task 1");
    expect(selection.entries[0]?.write_scope).toEqual(["src/module1"]);
  });
});

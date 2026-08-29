import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  scopeConflict,
  resourceConflict,
  hasActiveOwnership,
} from "../../../olt/scripts/src/engine/scheduler/conflicts.ts";
import { rankTasks, type ScheduledTask } from "../../../olt/scripts/src/engine/scheduler/rank.ts";
import { proposeBatch } from "../../../olt/scripts/src/engine/scheduler/propose-batch.ts";
import { readySet } from "../../../olt/scripts/src/engine/scheduler/ready-set.ts";
import { computeTopology } from "../../../olt/scripts/src/engine/scheduler/topology.ts";
import {
  computeReceiptHash,
  generateReceiptBadge,
  generateReceiptSummaryBadge,
  type CliDiagnosticReceipt,
} from "../../../olt/scripts/src/engine/scheduler/diagnostics.ts";
import type { SchedulingMetrics } from "../../../olt/scripts/src/engine/scheduler/metrics.ts";

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

describe("Scheduler Topology", () => {
  const topologyState = {
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
        status: "ready",
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

  test("computeTopology computes multi-wave schedule with reasonings", () => {
    const topology = computeTopology(
      topologyState,
      { default_max_parallel: 2 },
      {
        rationales: { "task-1": "Implement core first" },
      },
    );

    expect(topology.revision).toBe(1);
    expect(topology.max_parallel).toBe(2);
    expect(topology.waves.length).toBeGreaterThanOrEqual(2);

    const wave1 = topology.waves[0];
    expect(wave1?.wave).toBe(1);
    expect(wave1?.task_ids).toContain("task-1");

    const decision1 = topology.decisions.find((d) => d.task_id === "task-1");
    expect(decision1?.wave).toBe(1);
    expect(decision1?.evidence_class).toBe("agent_reported");
    expect(decision1?.rationale).toBe("Implement core first");
  });

  test("computeTopology throws HarnessError on invalid config or state", () => {
    expect(() => computeTopology(topologyState, { default_max_parallel: 0 })).toThrow(HarnessError);
    expect(() => computeTopology({}, { default_max_parallel: 2 })).toThrow(HarnessError);
    const missingRevisionState = structuredClone(topologyState);
    (missingRevisionState.graph as Record<string, unknown>).revision = 0;
    expect(() => computeTopology(missingRevisionState, { default_max_parallel: 2 })).toThrow(
      HarnessError,
    );
  });
});

describe("Scheduler Diagnostics", () => {
  test("computeReceiptHash creates deterministic SHA-256 digests", () => {
    const hash1 = computeReceiptHash("doctor", "2026-08-24T12:00:00Z", "passed", "healthy");
    const hash2 = computeReceiptHash("doctor", "2026-08-24T12:00:00Z", "passed", "healthy");
    const hashDiff = computeReceiptHash("doctor", "2026-08-24T12:00:00Z", "failed", "unhealthy");

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hashDiff);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  test("generateReceiptBadge returns expected badges for statuses", () => {
    const passReceipt: CliDiagnosticReceipt = {
      inspector: "doctor",
      status: "passed",
      timestamp: "2026-08-24T12:00:00Z",
      durationMs: 15,
      summary: "all checks passed",
      receiptHash: "abcdef",
      badge: "",
    };
    expect(generateReceiptBadge(passReceipt)).toBe("[RECEIPT: doctor PASS]");

    const failReceipt: CliDiagnosticReceipt = { ...passReceipt, status: "failed" };
    expect(generateReceiptBadge(failReceipt)).toBe("[RECEIPT: doctor FAIL]");

    const warnReceipt: CliDiagnosticReceipt = { ...passReceipt, status: "warning" };
    expect(generateReceiptBadge(warnReceipt)).toBe("[RECEIPT: doctor WARN]");

    const skipReceipt: CliDiagnosticReceipt = { ...passReceipt, status: "skipped" };
    expect(generateReceiptBadge(skipReceipt)).toBe("[RECEIPT: doctor SKIP]");
  });

  test("generateReceiptSummaryBadge summarizes multiple receipts", () => {
    expect(generateReceiptSummaryBadge([])).toBe("[CLI-RECEIPTS: none]");

    const receipts: CliDiagnosticReceipt[] = [
      {
        inspector: "doctor",
        status: "passed",
        timestamp: "2026-08-24T12:00:00Z",
        durationMs: 10,
        summary: "ok",
        receiptHash: "123",
        badge: "",
      },
      {
        inspector: "health",
        status: "warning",
        timestamp: "2026-08-24T12:00:00Z",
        durationMs: 12,
        summary: "warn",
        receiptHash: "456",
        badge: "",
      },
    ];
    const summary = generateReceiptSummaryBadge(receipts);
    expect(summary).toContain("doctor ✓");
    expect(summary).toContain("health ⚠️");
  });
});

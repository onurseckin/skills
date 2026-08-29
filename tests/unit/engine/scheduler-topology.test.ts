import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { computeTopology } from "../../../olt/scripts/src/engine/scheduler/index.ts";
import {
  computeReceiptHash,
  generateReceiptBadge,
  generateReceiptSummaryBadge,
  type CliDiagnosticReceipt,
} from "../../../olt/scripts/src/engine/scheduler/diagnostics/index.ts";

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
        effort: 3,
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
        write_scope: ["src/module1"],
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

import { describe, expect, test } from "bun:test";
import type { HarnessEvent, Manifest } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { CommandRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { TaskRecord, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";
import { collectMetrics } from "../../../olt/scripts/src/summary/metrics-collector.ts";
import { generateGraphDataset } from "../../../olt/scripts/src/summary/graph-generator.ts";

describe("metrics collector", () => {
  test("computes rollup metrics accurately", () => {
    const manifest: Manifest = {
      schema: "harness.manifest",
      version: 1,
      run_id: "test-run",
      capsule_id: "cap-1",
      prompt_sha256: "abc",
      prompt_bytes: 4000,
      capture_mode: "file",
      source_verified: true,
      assurance: "source-verified",
      bun_version: "1.3.14",
      runtime_version: "1.0.0",
    };

    const task1: TaskRecord = {
      id: "T-1",
      status: "done",
      requirement_ids: ["R-1"],
      write_scope: ["src/a.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 1,
      report: { summary: "Implemented A", files_changed: ["src/a.ts"] },
    };

    const task2: TaskRecord = {
      id: "T-2",
      status: "done",
      requirement_ids: ["R-2"],
      write_scope: ["src/b.ts"],
      dependencies: ["T-1"],
      attempts: [],
      history: [],
      repair_round: 0,
      report: { summary: "Implemented B", files_changed: ["src/b.ts"] },
    };

    const state: WorkflowState = {
      tasks: { "T-1": task1, "T-2": task2 },
      requirements: [],
      gates: [],
      commands: {},
      orphan_evidence: [],
      graph_revision: 1,
    };

    const cmd1: CommandRecord = {
      id: "C-1",
      argv: ["bun", "test"],
      cwd: "/repo",
      cwd_relative: ".",
      repository_root: "/repo",
      status: "succeeded",
      task_id: "T-1",
      gate_id: "G-1",
      started_at: "2026-08-14T20:00:00.000Z",
      finished_at: "2026-08-14T20:00:02.500Z",
      exit_code: 0,
      signal: null,
      fingerprint: "fp1",
      attempt_signing_public_key: "pk1",
      record_path: "commands/C-1/record.json",
      actor: "val",
      logs: {
        stdout: { path: "stdout.log", bytes: 500, sha256: "s1" },
        stderr: { path: "stderr.log", bytes: 0, sha256: "s2" },
      },
    };

    const events: HarnessEvent[] = [
      {
        schema: "harness.event",
        version: 1,
        run_id: "test-run",
        capsule_id: "cap-1",
        sequence: 1,
        revision: 1,
        timestamp: "2026-08-14T20:00:00.000Z",
        actor: "coord",
        kind: "plan-init",
        payload: {},
        previous_hash: null,
        projection: {
          schema: "harness.state",
          version: 1,
          revision: 1,
          event_sequence: 1,
          event_head: null,
        },
        hash: "h1",
      },
      {
        schema: "harness.event",
        version: 1,
        run_id: "test-run",
        capsule_id: "cap-1",
        sequence: 2,
        revision: 1,
        timestamp: "2026-08-14T20:01:00.000Z",
        actor: "coord",
        kind: "run-completed",
        payload: {},
        previous_hash: null,
        projection: {
          schema: "harness.state",
          version: 1,
          revision: 1,
          event_sequence: 2,
          event_head: null,
        },
        hash: "h2",
      },
    ];

    const metrics = collectMetrics({
      runId: "test-run",
      manifest,
      state,
      events,
      commands: { "C-1": cmd1 },
    });

    expect(metrics.run_id).toBe("test-run");
    expect(metrics.total_tasks).toBe(2);
    expect(metrics.satisfied_tasks).toBe(2);
    expect(metrics.failed_tasks).toBe(0);
    expect(metrics.repair_rounds_total).toBe(1);
    expect(metrics.pushbacks_total).toBe(1);
    expect(metrics.pushback_rounds).toHaveLength(1);
    expect(metrics.pushback_rounds[0]?.task_id).toBe("T-1");
    // No graph was generated for this call, so there is no exchange count to report.
    expect(metrics.total_edge_traffic_exchanges).toBeUndefined();
    expect(metrics.wall_duration_ms).toBe(60_000);
    expect(metrics.active_command_duration_ms).toBe(2_500);
    expect(metrics.total_commands_executed).toBe(1);
    expect(metrics.total_gates_passed).toBe(1);
    expect(metrics.estimated_tokens.tokens_in).toBeGreaterThan(0);
    expect(metrics.files_touched).toHaveLength(2);
  });

  test("counts the exchanges the emitted graph carries and reports no invented token volume", () => {
    const taskA: TaskRecord = {
      id: "T-A",
      status: "done",
      requirement_ids: ["R-A"],
      write_scope: ["src/a.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 2,
      findings: [
        {
          id: "F-A1",
          requirement_id: "R-A",
          severity: "important",
          observation: "Pushback 1",
          remediation: "Fix 1",
          revalidation: "Val 1",
          status: "resolved",
        },
        {
          id: "F-A2",
          requirement_id: "R-A",
          severity: "important",
          observation: "Pushback 2",
          remediation: "Fix 2",
          revalidation: "Val 2",
          status: "resolved",
        },
      ],
    };

    const taskB: TaskRecord = {
      id: "T-B",
      status: "done",
      requirement_ids: ["R-B"],
      write_scope: ["src/b.ts"],
      dependencies: ["T-A"],
      attempts: [],
      history: [],
      repair_round: 0,
    };

    const taskC: TaskRecord = {
      id: "T-C",
      status: "done",
      requirement_ids: ["R-C"],
      write_scope: ["src/c.ts"],
      dependencies: ["T-A", "T-B"],
      attempts: [],
      history: [],
      repair_round: 0,
    };

    const state: WorkflowState = {
      tasks: { "T-A": taskA, "T-B": taskB, "T-C": taskC },
      requirements: [],
      gates: [],
      commands: {},
      orphan_evidence: [],
      graph_revision: 1,
    };

    const graph = generateGraphDataset({ runId: "traffic-test-run", state });
    const metrics = collectMetrics({
      runId: "traffic-test-run",
      state,
      events: [],
      graph,
    });

    const emitted = graph.edges.reduce((total, edge) => total + (edge.exchanges?.length ?? 0), 0);
    expect(metrics.total_tasks).toBe(3);
    expect(metrics.total_edge_traffic_exchanges).toBe(emitted);
    expect(emitted).toBeGreaterThan(0);
    expect(JSON.stringify(metrics)).not.toContain("total_edge_traffic_tokens");
  });
});

import { describe, expect, test } from "bun:test";
import type {
  HarnessEvent,
  Manifest,
} from "../../../orchestrating-long-tasks/scripts/src/contracts/capsule.ts";
import type { CommandRecord } from "../../../orchestrating-long-tasks/scripts/src/contracts/commands.ts";
import type {
  TaskRecord,
  WorkflowState,
} from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { collectMetrics } from "../../../orchestrating-long-tasks/scripts/src/summary/metrics-collector.ts";

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
    expect(metrics.total_edge_traffic_exchanges).toBeGreaterThanOrEqual(5);
    expect(metrics.wall_duration_ms).toBe(60_000);
    expect(metrics.active_command_duration_ms).toBe(2_500);
    expect(metrics.total_commands_executed).toBe(1);
    expect(metrics.total_gates_passed).toBe(1);
    expect(metrics.estimated_tokens.tokens_in).toBeGreaterThan(0);
    expect(metrics.files_touched).toHaveLength(2);
  });

  test("calculates edge traffic exchanges and token volume with dependencies and critic join edges", () => {
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

    const metrics = collectMetrics({
      runId: "traffic-test-run",
      state,
      events: [],
    });

    expect(metrics.total_tasks).toBe(3);
    expect(metrics.total_edge_traffic_exchanges).toBe(16);
    expect(metrics.total_edge_traffic_tokens).toBe(6370);
  });
});

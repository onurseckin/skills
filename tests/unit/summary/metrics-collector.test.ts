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
import {
  collectMetrics,
  computeGateTiming,
  computeGateTokens,
  computeTaskTiming,
  computeTaskTokens,
  extractTaskTimestamps,
} from "../../../orchestrating-long-tasks/scripts/src/summary/metrics-collector.ts";

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

  test("computes high-resolution task timing breakdown accurately", () => {
    const task: TaskRecord = {
      id: "T-10",
      status: "done",
      requirement_ids: ["R-10"],
      write_scope: ["src/feature.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      report: { summary: "Implemented feature", files_changed: ["src/feature.ts"] },
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
        actor: "agent-1",
        kind: "task-claimed",
        payload: { task_id: "T-10", role: "implementer" },
        previous_hash: null,
        projection: { schema: "harness.state", version: 1, revision: 1, event_sequence: 1, event_head: null },
        hash: "h1",
      },
      {
        schema: "harness.event",
        version: 1,
        run_id: "test-run",
        capsule_id: "cap-1",
        sequence: 2,
        revision: 1,
        timestamp: "2026-08-14T20:00:10.000Z",
        actor: "agent-1",
        kind: "task-submitted",
        payload: { task_id: "T-10" },
        previous_hash: null,
        projection: { schema: "harness.state", version: 1, revision: 1, event_sequence: 2, event_head: null },
        hash: "h2",
      },
      {
        schema: "harness.event",
        version: 1,
        run_id: "test-run",
        capsule_id: "cap-1",
        sequence: 3,
        revision: 1,
        timestamp: "2026-08-14T20:00:10.500Z",
        actor: "val-1",
        kind: "task-validation-started",
        payload: { task_id: "T-10" },
        previous_hash: null,
        projection: { schema: "harness.state", version: 1, revision: 1, event_sequence: 3, event_head: null },
        hash: "h3",
      },
      {
        schema: "harness.event",
        version: 1,
        run_id: "test-run",
        capsule_id: "cap-1",
        sequence: 4,
        revision: 1,
        timestamp: "2026-08-14T20:00:12.500Z",
        actor: "val-1",
        kind: "review-recorded",
        payload: { task_id: "T-10", verdict: "pass" },
        previous_hash: null,
        projection: { schema: "harness.state", version: 1, revision: 1, event_sequence: 4, event_head: null },
        hash: "h4",
      },
    ];

    const cmd: CommandRecord = {
      id: "C-10",
      argv: ["bun", "run", "build"],
      cwd: "/repo",
      cwd_relative: ".",
      repository_root: "/repo",
      status: "succeeded",
      task_id: "T-10",
      started_at: "2026-08-14T20:00:02.000Z",
      finished_at: "2026-08-14T20:00:05.000Z",
      exit_code: 0,
      signal: null,
      fingerprint: "fp10",
      attempt_signing_public_key: "pk10",
      record_path: "commands/C-10/record.json",
      actor: "agent-1",
    };

    const timing = computeTaskTiming(task, events, [cmd]);
    expect(timing.wallDurationMs).toBe(10_000);
    expect(timing.activeCommandMs).toBe(3_000);
    expect(timing.cognitiveLatencyMs).toBe(7_000); // 10_000 - 3_000
    expect(timing.validationDurationMs).toBe(2_000); // 12_500 - 10_500

    const gateTiming = computeGateTiming(task, events, []);
    expect(gateTiming?.wallDurationMs).toBe(2_000);
    expect(gateTiming?.activeCommandMs).toBe(0);
    expect(gateTiming?.cognitiveLatencyMs).toBe(2_000);
  });

  test("computes multi-dimensional token usage with reasoning and cache tokens", () => {
    const task: TaskRecord = {
      id: "T-20",
      status: "done",
      requirement_ids: ["R-20"],
      write_scope: ["src/x.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      report: { summary: "Refactored module", files_changed: ["src/x.ts"] },
    };

    const hostTokens = {
      inputTokens: 1200,
      outputTokens: 400,
      reasoningTokens: 800,
      cacheCreationTokens: 300,
      cacheReadTokens: 100,
      costUsd: 0.015,
      isEstimated: false,
    };

    const tokens = computeTaskTokens(task, undefined, [], hostTokens);
    expect(tokens.inputTokens).toBe(1200);
    expect(tokens.outputTokens).toBe(400);
    expect(tokens.reasoningTokens).toBe(800);
    expect(tokens.cacheCreationTokens).toBe(300);
    expect(tokens.cacheReadTokens).toBe(100);
    expect(tokens.totalTokens).toBe(2800);
    expect(tokens.costUsd).toBe(0.015);
    expect(tokens.isEstimated).toBe(false);
  });

  test("preserves hostTokens.costUsd even when token calculation is estimated", () => {
    const task: TaskRecord = {
      id: "T-21",
      status: "done",
      requirement_ids: ["R-21"],
      write_scope: ["src/y.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      report: { summary: "Implemented module Y", files_changed: ["src/y.ts"] },
    };

    const hostTokens = {
      reasoningTokens: 100,
      cacheCreationTokens: 50,
      cacheReadTokens: 25,
      costUsd: 0.0085,
      isEstimated: true,
    };

    const tokens = computeTaskTokens(task, undefined, [], hostTokens);
    expect(tokens.isEstimated).toBe(true);
    expect(tokens.reasoningTokens).toBe(100);
    expect(tokens.cacheCreationTokens).toBe(50);
    expect(tokens.cacheReadTokens).toBe(25);
    expect(tokens.costUsd).toBe(0.0085);
  });

  test("isolates multi-round validation durations and prevents repair latency inflation", () => {
    const task: TaskRecord = {
      id: "T-30",
      status: "done",
      requirement_ids: ["R-30"],
      write_scope: ["src/repair.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 1,
      report: { summary: "Repaired feature after pushback", files_changed: ["src/repair.ts"] },
    };

    // Timeline:
    // Round 1 Implementation: 20:00:00 - 20:00:10 (10s)
    // Round 1 Validation:     20:00:11 - 20:00:13 (2s) -> reject
    // Implementer repair work: 20:05:00 - 20:05:15 (15s) [5 min repair gap]
    // Round 2 Validation:     20:05:16 - 20:05:19 (3s) -> pass
    const events: HarnessEvent[] = [
      // Round 1 Implementation
      {
        schema: "harness.event",
        version: 1,
        run_id: "multi-round-run",
        capsule_id: "cap-mr",
        sequence: 1,
        revision: 1,
        timestamp: "2026-08-14T20:00:00.000Z",
        actor: "impl-1",
        kind: "task-claimed",
        payload: { task_id: "T-30", role: "implementer" },
        previous_hash: null,
        projection: { schema: "harness.state", version: 1, revision: 1, event_sequence: 1, event_head: null },
        hash: "e1",
      },
      {
        schema: "harness.event",
        version: 1,
        run_id: "multi-round-run",
        capsule_id: "cap-mr",
        sequence: 2,
        revision: 1,
        timestamp: "2026-08-14T20:00:10.000Z",
        actor: "impl-1",
        kind: "task-submitted",
        payload: { task_id: "T-30" },
        previous_hash: null,
        projection: { schema: "harness.state", version: 1, revision: 1, event_sequence: 2, event_head: null },
        hash: "e2",
      },
      // Round 1 Validation
      {
        schema: "harness.event",
        version: 1,
        run_id: "multi-round-run",
        capsule_id: "cap-mr",
        sequence: 3,
        revision: 1,
        timestamp: "2026-08-14T20:00:11.000Z",
        actor: "val-1",
        kind: "task-validation-started",
        payload: { task_id: "T-30" },
        previous_hash: null,
        projection: { schema: "harness.state", version: 1, revision: 1, event_sequence: 3, event_head: null },
        hash: "e3",
      },
      {
        schema: "harness.event",
        version: 1,
        run_id: "multi-round-run",
        capsule_id: "cap-mr",
        sequence: 4,
        revision: 1,
        timestamp: "2026-08-14T20:00:13.000Z",
        actor: "val-1",
        kind: "review-recorded",
        payload: { task_id: "T-30", verdict: "reject" },
        previous_hash: null,
        projection: { schema: "harness.state", version: 1, revision: 1, event_sequence: 4, event_head: null },
        hash: "e4",
      },
      // Round 2 Repair (claimed after 5 minutes)
      {
        schema: "harness.event",
        version: 1,
        run_id: "multi-round-run",
        capsule_id: "cap-mr",
        sequence: 5,
        revision: 1,
        timestamp: "2026-08-14T20:05:00.000Z",
        actor: "impl-1",
        kind: "task-claimed",
        payload: { task_id: "T-30", role: "repairer" },
        previous_hash: null,
        projection: { schema: "harness.state", version: 1, revision: 1, event_sequence: 5, event_head: null },
        hash: "e5",
      },
      {
        schema: "harness.event",
        version: 1,
        run_id: "multi-round-run",
        capsule_id: "cap-mr",
        sequence: 6,
        revision: 1,
        timestamp: "2026-08-14T20:05:15.000Z",
        actor: "impl-1",
        kind: "task-submitted",
        payload: { task_id: "T-30" },
        previous_hash: null,
        projection: { schema: "harness.state", version: 1, revision: 1, event_sequence: 6, event_head: null },
        hash: "e6",
      },
      // Round 2 Validation
      {
        schema: "harness.event",
        version: 1,
        run_id: "multi-round-run",
        capsule_id: "cap-mr",
        sequence: 7,
        revision: 1,
        timestamp: "2026-08-14T20:05:16.000Z",
        actor: "val-1",
        kind: "task-validation-started",
        payload: { task_id: "T-30" },
        previous_hash: null,
        projection: { schema: "harness.state", version: 1, revision: 1, event_sequence: 7, event_head: null },
        hash: "e7",
      },
      {
        schema: "harness.event",
        version: 1,
        run_id: "multi-round-run",
        capsule_id: "cap-mr",
        sequence: 8,
        revision: 1,
        timestamp: "2026-08-14T20:05:19.000Z",
        actor: "val-1",
        kind: "review-recorded",
        payload: { task_id: "T-30", verdict: "pass" },
        previous_hash: null,
        projection: { schema: "harness.state", version: 1, revision: 1, event_sequence: 8, event_head: null },
        hash: "e8",
      },
    ];

    const implCmd1: CommandRecord = {
      id: "C-impl-1",
      argv: ["bun", "run", "build"],
      cwd: "/repo",
      cwd_relative: ".",
      repository_root: "/repo",
      status: "succeeded",
      task_id: "T-30",
      started_at: "2026-08-14T20:00:02.000Z",
      finished_at: "2026-08-14T20:00:05.000Z", // 3,000ms
      exit_code: 0,
      signal: null,
      fingerprint: "fp-i1",
      attempt_signing_public_key: "pk-i1",
      record_path: "commands/C-impl-1/record.json",
      actor: "impl-1",
    };

    const implCmd2: CommandRecord = {
      id: "C-impl-2",
      argv: ["bun", "run", "fix"],
      cwd: "/repo",
      cwd_relative: ".",
      repository_root: "/repo",
      status: "succeeded",
      task_id: "T-30",
      started_at: "2026-08-14T20:05:02.000Z",
      finished_at: "2026-08-14T20:05:06.000Z", // 4,000ms
      exit_code: 0,
      signal: null,
      fingerprint: "fp-i2",
      attempt_signing_public_key: "pk-i2",
      record_path: "commands/C-impl-2/record.json",
      actor: "impl-1",
    };

    const valCmd1: CommandRecord = {
      id: "C-val-1",
      argv: ["bun", "test"],
      cwd: "/repo",
      cwd_relative: ".",
      repository_root: "/repo",
      status: "failed",
      task_id: "T-30",
      gate_id: "G-30",
      started_at: "2026-08-14T20:00:11.500Z",
      finished_at: "2026-08-14T20:00:12.000Z", // 500ms
      exit_code: 1,
      signal: null,
      fingerprint: "fp-v1",
      attempt_signing_public_key: "pk-v1",
      record_path: "commands/C-val-1/record.json",
      actor: "val",
    };

    const valCmd2: CommandRecord = {
      id: "C-val-2",
      argv: ["bun", "test"],
      cwd: "/repo",
      cwd_relative: ".",
      repository_root: "/repo",
      status: "succeeded",
      task_id: "T-30",
      gate_id: "G-30",
      started_at: "2026-08-14T20:05:16.500Z",
      finished_at: "2026-08-14T20:05:17.500Z", // 1,000ms
      exit_code: 0,
      signal: null,
      fingerprint: "fp-v2",
      attempt_signing_public_key: "pk-v2",
      record_path: "commands/C-val-2/record.json",
      actor: "val",
    };

    const timestamps = extractTaskTimestamps(task, events);
    expect(timestamps.validationIntervals).toHaveLength(2);
    expect(timestamps.validationIntervals[0]?.durationMs).toBe(2_000); // 20:00:11 to 20:00:13
    expect(timestamps.validationIntervals[1]?.durationMs).toBe(3_000); // 20:05:16 to 20:05:19
    expect(timestamps.validationDurationMs).toBe(5_000); // 2_000 + 3_000
    expect(timestamps.executionDurationMs).toBe(25_000); // 10_000 + 15_000

    // Compute gate timing with validation commands
    const gateTiming = computeGateTiming(task, events, [valCmd1, valCmd2]);
    expect(gateTiming).toBeDefined();
    expect(gateTiming?.wallDurationMs).toBe(5_000); // Accumulated discrete validation duration (NOT 308_000ms!)
    expect(gateTiming?.activeCommandMs).toBe(1_500); // 500 + 1_000
    expect(gateTiming?.cognitiveLatencyMs).toBe(3_500); // 5_000 - 1_500
    expect(gateTiming?.validationDurationMs).toBe(5_000);

    // Compute task timing
    const taskTiming = computeTaskTiming(task, events, [implCmd1, implCmd2]);
    expect(taskTiming.wallDurationMs).toBe(25_000);
    expect(taskTiming.activeCommandMs).toBe(7_000); // 3_000 + 4_000
    expect(taskTiming.cognitiveLatencyMs).toBe(18_000); // 25_000 - 7_000
    expect(taskTiming.validationDurationMs).toBe(5_000);
  });

  test("computes gate token usage accurately with validator hostTokens", () => {
    const task: TaskRecord = {
      id: "T-40",
      status: "done",
      requirement_ids: ["R-40"],
      write_scope: ["src/gate.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      findings: [
        {
          id: "F-40",
          requirement_id: "R-40",
          severity: "important",
          observation: "Gate observation",
          remediation: "Remediate",
          revalidation: "Reval",
          status: "resolved",
        },
      ],
    };

    const hostTokens = {
      inputTokens: 800,
      outputTokens: 250,
      reasoningTokens: 600,
      cacheCreationTokens: 150,
      cacheReadTokens: 50,
      costUsd: 0.0092,
      isEstimated: false,
    };

    const directTokens = computeGateTokens(task, [], hostTokens);
    expect(directTokens.inputTokens).toBe(800);
    expect(directTokens.outputTokens).toBe(250);
    expect(directTokens.reasoningTokens).toBe(600);
    expect(directTokens.cacheCreationTokens).toBe(150);
    expect(directTokens.cacheReadTokens).toBe(50);
    expect(directTokens.totalTokens).toBe(1850);
    expect(directTokens.costUsd).toBe(0.0092);
    expect(directTokens.isEstimated).toBe(false);

    // Test with estimated hostTokens (preserving reasoning, cache, and cost)
    const estimatedHostTokens = {
      reasoningTokens: 120,
      cacheCreationTokens: 40,
      cacheReadTokens: 10,
      costUsd: 0.0035,
      isEstimated: true,
    };

    const estimatedTokens = computeGateTokens(task, [], estimatedHostTokens);
    expect(estimatedTokens.isEstimated).toBe(true);
    expect(estimatedTokens.reasoningTokens).toBe(120);
    expect(estimatedTokens.cacheCreationTokens).toBe(40);
    expect(estimatedTokens.cacheReadTokens).toBe(10);
    expect(estimatedTokens.costUsd).toBe(0.0035);
    expect(estimatedTokens.totalTokens).toBe(
      (estimatedTokens.inputTokens ?? 0) + (estimatedTokens.outputTokens ?? 0) + 120 + 40 + 10,
    );
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

    // Accounting:
    // Total tasks = 3 (spawn + submit + join = 3 * 3 = 9 exchanges, 3 * 1300 = 3900 tokens)
    // Dependencies = 0 (A) + 1 (B) + 2 (C) = 3 dependencies (3 exchanges, 3 * 420 = 1260 tokens)
    // Pushbacks: T-A has 2 findings -> 2 exchanges, 2 * 280 = 560 tokens
    // Global edges: prompt (1 exch, 200 tok) + critic complete (1 exch, 450 tok) = 2 exchanges, 650 tokens
    // Total exchanges = 2 + 9 + 3 + 2 = 16
    // Total tokens = 650 + 3900 + 1260 + 560 = 6370
    expect(metrics.total_tasks).toBe(3);
    expect(metrics.total_edge_traffic_exchanges).toBe(16);
    expect(metrics.total_edge_traffic_tokens).toBe(6370);
  });

  test("strictly enforces 5-part token summation formula across all execution paths", () => {
    const task: TaskRecord = {
      id: "T-strict",
      status: "done",
      requirement_ids: ["R-S"],
      write_scope: ["src/s.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      report: { summary: "Strict token test", files_changed: ["src/s.ts"] },
    };

    // 1. Task tokens with authentic host tokens and mismatched totalTokens in input
    const hostWithMismatchedTotal = {
      inputTokens: 500,
      outputTokens: 200,
      reasoningTokens: 100,
      cacheCreationTokens: 50,
      cacheReadTokens: 25,
      totalTokens: 999999, // Should be overridden by strict 5-part summation (500 + 200 + 100 + 50 + 25 = 875)
      costUsd: 0.005,
      isEstimated: false,
    };

    const taskTokens = computeTaskTokens(task, undefined, [], hostWithMismatchedTotal);
    expect(taskTokens.totalTokens).toBe(875);
    expect(taskTokens.totalTokens).toBe(
      (taskTokens.inputTokens ?? 0) +
        (taskTokens.outputTokens ?? 0) +
        (taskTokens.reasoningTokens ?? 0) +
        (taskTokens.cacheCreationTokens ?? 0) +
        (taskTokens.cacheReadTokens ?? 0),
    );

    // 2. Gate tokens with authentic host tokens and mismatched totalTokens
    const gateTokens = computeGateTokens(task, [], hostWithMismatchedTotal);
    expect(gateTokens.totalTokens).toBe(875);
    expect(gateTokens.totalTokens).toBe(
      (gateTokens.inputTokens ?? 0) +
        (gateTokens.outputTokens ?? 0) +
        (gateTokens.reasoningTokens ?? 0) +
        (gateTokens.cacheCreationTokens ?? 0) +
        (gateTokens.cacheReadTokens ?? 0),
    );

    // 3. Task tokens without host tokens (heuristic estimation path)
    const estimatedTaskTokens = computeTaskTokens(task, undefined, []);
    expect(estimatedTaskTokens.totalTokens).toBe(
      (estimatedTaskTokens.inputTokens ?? 0) +
        (estimatedTaskTokens.outputTokens ?? 0) +
        (estimatedTaskTokens.reasoningTokens ?? 0) +
        (estimatedTaskTokens.cacheCreationTokens ?? 0) +
        (estimatedTaskTokens.cacheReadTokens ?? 0),
    );

    // 4. Gate tokens without host tokens (heuristic estimation path)
    const estimatedGateTokens = computeGateTokens(task, []);
    expect(estimatedGateTokens.totalTokens).toBe(
      (estimatedGateTokens.inputTokens ?? 0) +
        (estimatedGateTokens.outputTokens ?? 0) +
        (estimatedGateTokens.reasoningTokens ?? 0) +
        (estimatedGateTokens.cacheCreationTokens ?? 0) +
        (estimatedGateTokens.cacheReadTokens ?? 0),
    );
  });
});

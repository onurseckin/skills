import { describe, expect, test } from "bun:test";
import type { HarnessEvent } from "../../olt/scripts/src/core/contracts/index.ts";
import type { CommandRecord } from "../../olt/scripts/src/core/contracts/index.ts";
import type { TaskRecord } from "../../olt/scripts/src/workflow/types.ts";
import {
  computeGateTiming,
  computeTaskTiming,
  extractTaskTimestamps,
} from "../../olt/scripts/src/summary/metrics/index.ts";

describe("metrics timing collector - multi-round timing", () => {
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

    const events: HarnessEvent[] = [
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
        projection: {
          schema: "harness.state",
          version: 1,
          revision: 1,
          event_sequence: 1,
          event_head: null,
        },
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
        projection: {
          schema: "harness.state",
          version: 1,
          revision: 1,
          event_sequence: 2,
          event_head: null,
        },
        hash: "e2",
      },
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
        projection: {
          schema: "harness.state",
          version: 1,
          revision: 1,
          event_sequence: 3,
          event_head: null,
        },
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
        projection: {
          schema: "harness.state",
          version: 1,
          revision: 1,
          event_sequence: 4,
          event_head: null,
        },
        hash: "e4",
      },
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
        projection: {
          schema: "harness.state",
          version: 1,
          revision: 1,
          event_sequence: 5,
          event_head: null,
        },
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
        projection: {
          schema: "harness.state",
          version: 1,
          revision: 1,
          event_sequence: 6,
          event_head: null,
        },
        hash: "e6",
      },
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
        projection: {
          schema: "harness.state",
          version: 1,
          revision: 1,
          event_sequence: 7,
          event_head: null,
        },
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
        projection: {
          schema: "harness.state",
          version: 1,
          revision: 1,
          event_sequence: 8,
          event_head: null,
        },
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
      finished_at: "2026-08-14T20:00:05.000Z",
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
      finished_at: "2026-08-14T20:05:06.000Z",
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
      finished_at: "2026-08-14T20:00:12.000Z",
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
      finished_at: "2026-08-14T20:05:17.500Z",
      exit_code: 0,
      signal: null,
      fingerprint: "fp-v2",
      attempt_signing_public_key: "pk-v2",
      record_path: "commands/C-val-2/record.json",
      actor: "val",
    };

    const timestamps = extractTaskTimestamps(task, events);
    expect(timestamps.validationIntervals).toHaveLength(2);
    expect(timestamps.validationIntervals[0]?.durationMs).toBe(2_000);
    expect(timestamps.validationIntervals[1]?.durationMs).toBe(3_000);
    expect(timestamps.validationDurationMs).toBe(5_000);
    expect(timestamps.executionDurationMs).toBe(25_000);

    const gateTiming = computeGateTiming(task, events, [valCmd1, valCmd2]);
    expect(gateTiming).toBeDefined();
    expect(gateTiming?.wallDurationMs).toBe(5_000);
    expect(gateTiming?.activeCommandMs).toBe(1_500);
    expect(gateTiming?.cognitiveLatencyMs).toBe(3_500);
    expect(gateTiming?.validationDurationMs).toBe(5_000);

    const taskTiming = computeTaskTiming(task, events, [implCmd1, implCmd2]);
    expect(taskTiming.wallDurationMs).toBe(25_000);
    expect(taskTiming.activeCommandMs).toBe(7_000);
    expect(taskTiming.cognitiveLatencyMs).toBe(18_000);
    expect(taskTiming.validationDurationMs).toBe(5_000);
  });
});

import { describe, expect, test } from "bun:test";
import type { HarnessEvent } from "../../../orchestrating-long-tasks/scripts/src/contracts/capsule.ts";
import type { CommandRecord } from "../../../orchestrating-long-tasks/scripts/src/contracts/commands.ts";
import type { TaskRecord } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import {
  computeGateTiming,
  computeTaskTiming,
} from "../../../orchestrating-long-tasks/scripts/src/summary/metrics-collector.ts";

describe("metrics timing collector - basic task timing", () => {
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
        timestamp: "2026-08-14T20:00:10.000Z",
        actor: "agent-1",
        kind: "task-submitted",
        payload: { task_id: "T-10" },
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
        projection: {
          schema: "harness.state",
          version: 1,
          revision: 1,
          event_sequence: 3,
          event_head: null,
        },
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
        projection: {
          schema: "harness.state",
          version: 1,
          revision: 1,
          event_sequence: 4,
          event_head: null,
        },
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
    expect(timing.cognitiveLatencyMs).toBe(7_000);
    expect(timing.validationDurationMs).toBe(2_000);

    const gateTiming = computeGateTiming(task, events, []);
    expect(gateTiming?.wallDurationMs).toBe(2_000);
    expect(gateTiming?.activeCommandMs).toBe(0);
    expect(gateTiming?.cognitiveLatencyMs).toBe(2_000);
  });
});

import { describe, expect, test } from "bun:test";
import type { HarnessEvent } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { CommandRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";
import {
  computeGateTiming,
  computeTaskTiming,
  extractTaskTimestamps,
} from "../../../olt/scripts/src/summary/metrics-collector.ts";
import { makeCommand, makeEvent, makeTask } from "./graph-fixtures.ts";

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

describe("extractTaskTimestamps: a validation interval still open when the log ends", () => {
  test("credits it using the review already on record, once that review is not earlier than it", () => {
    // Harness events are not guaranteed to arrive in strict timestamp order — concurrent agents on
    // unsynchronized clocks can log a later-timestamped event before an earlier one. Here the
    // validation-started event is processed second but its own timestamp is the earlier one, so
    // the review already on record legitimately closes it.
    const events = [
      makeEvent("review-recorded", 1, "2026-08-14T21:00:00.000Z", "val-1", { task_id: "T-1" }),
      makeEvent("task-validation-started", 2, "2026-08-14T20:00:00.000Z", "val-1", {
        task_id: "T-1",
      }),
    ];
    const summary = extractTaskTimestamps(makeTask("T-1"), events);
    expect(summary.validationIntervals).toEqual([
      { start: "2026-08-14T20:00:00.000Z", end: "2026-08-14T21:00:00.000Z", durationMs: 3_600_000 },
    ]);
    expect(summary.validationDurationMs).toBe(3_600_000);
  });

  test("a second round left open at the end of the log is not closed by the first round's stale review", () => {
    const events = [
      makeEvent("task-validation-started", 1, "2026-08-14T20:00:00.000Z", "val-1", {
        task_id: "T-1",
      }),
      makeEvent("review-recorded", 2, "2026-08-14T20:10:00.000Z", "val-1", { task_id: "T-1" }),
      makeEvent("task-validation-started", 3, "2026-08-14T20:20:00.000Z", "val-1", {
        task_id: "T-1",
      }),
    ];
    const summary = extractTaskTimestamps(makeTask("T-1"), events);
    expect(summary.validationIntervals).toEqual([
      { start: "2026-08-14T20:00:00.000Z", end: "2026-08-14T20:10:00.000Z", durationMs: 600_000 },
      { start: "2026-08-14T20:20:00.000Z", end: undefined, durationMs: 0 },
    ]);
    // Round 2's still-open interval contributes nothing; only round 1's closed 10 minutes count.
    expect(summary.validationDurationMs).toBe(600_000);
  });
});

describe("timing fallbacks below the interval-based measurement", () => {
  test("task timing: an exec span with no closed interval falls back to claim/submit, then to claim/review", () => {
    // Out-of-order events (task-submitted logged before its own task-claimed) leave no closed exec
    // interval, so wallDurationMs must fall back to the raw claim/submit timestamps.
    const submitFirst = [
      makeEvent("task-submitted", 1, "2026-08-14T20:00:10.000Z", "agent-1", { task_id: "T-1" }),
      makeEvent("task-claimed", 2, "2026-08-14T20:00:00.000Z", "agent-1", { task_id: "T-1" }),
    ];
    expect(computeTaskTiming(makeTask("T-1"), submitFirst, []).wallDurationMs).toBe(10_000);

    // No task-submitted event at all (e.g. an older log format): falls back one step further, to
    // claim/review.
    const noSubmit = [
      makeEvent("task-claimed", 1, "2026-08-14T20:00:00.000Z", "agent-1", { task_id: "T-1" }),
      makeEvent("review-recorded", 2, "2026-08-14T20:00:20.000Z", "val-1", { task_id: "T-1" }),
    ];
    expect(computeTaskTiming(makeTask("T-1"), noSubmit, []).wallDurationMs).toBe(20_000);
  });

  test("validation duration: an open interval with no accumulated total falls back to valStart/review, floored at zero", () => {
    // task-finished (from an earlier no-op decision) is logged before a later, separate
    // validation-started that the log never closes — so there is no closed interval to accumulate,
    // yet both valStart and review are on record.
    const events = [
      makeEvent("task-finished", 1, "2026-08-14T20:10:00.000Z", "orchestrator", {
        task_id: "T-1",
      }),
      makeEvent("task-validation-started", 2, "2026-08-14T20:20:00.000Z", "val-1", {
        task_id: "T-1",
      }),
    ];
    const task = makeTask("T-1");

    const taskTiming = computeTaskTiming(task, events, []);
    // review (20:10) predates valStart (20:20): parseDurationMs's own floor keeps this at zero
    // rather than reporting a negative validation duration.
    expect(taskTiming.validationDurationMs).toBe(0);

    const gateTiming = computeGateTiming(task, events, []);
    expect(gateTiming?.validationDurationMs).toBe(0);
  });

  test("validation duration: with no timestamps at all, falls back to the validator's own command spans", () => {
    const task = makeTask("T-1", {
      validations: [
        {
          validator_id: "val-9",
          domain: "code-quality",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-14T20:00:00.000Z",
          deadline_at: "2026-08-14T20:10:00.000Z",
        },
      ],
    });
    const cmd = makeCommand("C-v", {
      task_id: "T-1",
      actor: "val-9",
      started_at: "2026-08-14T20:00:00.000Z",
      finished_at: "2026-08-14T20:00:05.000Z",
    });

    expect(computeTaskTiming(task, [], [cmd]).validationDurationMs).toBe(5_000);
  });
});

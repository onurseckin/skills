import { describe, expect, test } from "bun:test";
import type { HarnessEvent } from "../../../orchestrating-long-tasks/scripts/src/contracts/capsule.ts";
import { collectTimeline } from "../../../orchestrating-long-tasks/scripts/src/summary/timeline-collector.ts";

function createEvent(
  kind: string,
  payload: Record<string, unknown> = {},
  sequence = 1,
): HarnessEvent {
  return {
    schema: "harness.event",
    version: 1,
    run_id: "test-run",
    capsule_id: "test-capsule",
    sequence,
    revision: 1,
    timestamp: "2026-08-14T20:00:00.000Z",
    actor: "test-actor",
    kind,
    payload,
    previous_hash: null,
    projection: {
      schema: "harness.state",
      version: 1,
      revision: 1,
      event_sequence: sequence,
      event_head: null,
    },
    hash: "hash",
  };
}

describe("timeline collector", () => {
  test("collects planning events", () => {
    const events: HarnessEvent[] = [
      createEvent("capsule-initialized", {}, 1),
      createEvent("plan-task-added", { id: "T-1", label: "Core Types" }, 2),
      createEvent("plan-compiled", {}, 3),
    ];

    const timeline = collectTimeline(events, 1024);
    expect(timeline).toHaveLength(3);
    expect(timeline[0]!.phase).toBe("planning");
    expect(timeline[0]!.payload_ref).toBe("prompt.md");
    expect(timeline[1]!.task_id).toBe("T-1");
    expect(timeline[2]!.summary).toContain("Plan compiled");
  });

  test("collects execution and repair events", () => {
    const events: HarnessEvent[] = [
      createEvent("task-claimed", { task_id: "T-1", role: "implementer" }, 1),
      createEvent("task-heartbeat", { task_id: "T-1" }, 2),
      createEvent("task-submitted", { task_id: "T-1" }, 3),
      createEvent("task-validation-started", { task_id: "T-1" }, 4),
      createEvent(
        "review-recorded",
        {
          task_id: "T-1",
          verdict: "reject",
          findings: [{ id: "F-1" }],
          round: 1,
        },
        5,
      ),
      createEvent("review-recorded", { task_id: "T-1", verdict: "pass" }, 6),
      createEvent("task-finished", { task_id: "T-1" }, 7),
    ];

    const timeline = collectTimeline(events);
    expect(timeline).toHaveLength(7);
    expect(timeline[0]!.phase).toBe("execution");
    expect(timeline[4]!.phase).toBe("repair");
    expect(timeline[4]!.round).toBe(1);
    expect(timeline[5]!.phase).toBe("validation");
    expect(timeline[6]!.summary).toContain("marked done");
  });

  test("collects command, critic, and completion events", () => {
    const events: HarnessEvent[] = [
      createEvent(
        "command-recorded",
        { command_id: "C-1", argv: ["bun", "test"], exit_code: 0 },
        1,
      ),
      createEvent("critic-started", {}, 2),
      createEvent("critic-reviewed", { verdict: "clean" }, 3),
      createEvent("run-completed", {}, 4),
    ];

    const timeline = collectTimeline(events);
    expect(timeline).toHaveLength(4);
    expect(timeline[0]!.command_id).toBe("C-1");
    expect(timeline[1]!.phase).toBe("review");
    expect(timeline[2]!.phase).toBe("review");
    expect(timeline[3]!.phase).toBe("completion");
  });

  test("propagates optional telemetry fields (tokens, cost_usd, duration_ms) when present in event payloads", () => {
    const events: HarnessEvent[] = [
      createEvent(
        "command-recorded",
        {
          command_id: "C-100",
          argv: ["bun", "test"],
          exit_code: 0,
          duration_ms: 1250,
          tokens: 450,
          cost_usd: 0.0025,
        },
        1,
      ),
      createEvent(
        "task-submitted",
        {
          task_id: "T-1",
          total_tokens: 1500,
          cost_usd: 0.012,
          duration_ms: 45000,
        },
        2,
      ),
      createEvent(
        "gate-completed",
        {
          task_id: "T-1",
          verdict: "pass",
          totalTokens: 800,
          costUsd: 0.004,
          durationMs: 3200,
        },
        3,
      ),
    ];

    const timeline = collectTimeline(events);
    expect(timeline).toHaveLength(3);

    // Event 1 (command-recorded with snake_case fields)
    expect(timeline[0]!.command_id).toBe("C-100");
    expect(timeline[0]!.duration_ms).toBe(1250);
    expect(timeline[0]!.tokens).toBe(450);
    expect(timeline[0]!.cost_usd).toBe(0.0025);

    // Event 2 (task-submitted with total_tokens & duration_ms)
    expect(timeline[1]!.task_id).toBe("T-1");
    expect(timeline[1]!.tokens).toBe(1500);
    expect(timeline[1]!.cost_usd).toBe(0.012);
    expect(timeline[1]!.duration_ms).toBe(45000);

    // Event 3 (gate-completed with camelCase totalTokens / costUsd / durationMs)
    expect(timeline[2]!.task_id).toBe("T-1");
    expect(timeline[2]!.tokens).toBe(800);
    expect(timeline[2]!.cost_usd).toBe(0.004);
    expect(timeline[2]!.duration_ms).toBe(3200);
  });

  test("a review verdict is read from the event, and an unstated one is not a rejection", () => {
    const timeline = collectTimeline([
      createEvent("review-recorded", { task_id: "T-1", verdict: "reject", finding_count: 2 }, 1),
      createEvent("review-recorded", { task_id: "T-1", verdict: "pass", resolved_count: 2 }, 2),
      createEvent("review-recorded", { task_id: "T-1" }, 3),
    ]);

    expect(timeline[0]!.phase).toBe("repair");
    expect(timeline[0]!.summary).toBe("Task T-1 review requested changes (2 findings)");
    expect(timeline[1]!.phase).toBe("validation");
    expect(timeline[1]!.summary).toBe("Task T-1 passed validation review");
    expect(timeline[2]!.phase).toBe("general");
    expect(timeline[2]!.summary).toBe("Task T-1 review recorded; the event states no verdict");
  });

  test("a command event states only the exit code and argv it carries", () => {
    const timeline = collectTimeline([
      createEvent(
        "command-recorded",
        { command_id: "C-1", argv: ["bun", "test"], exit_code: 1 },
        1,
      ),
      createEvent("command-recorded", {}, 2),
    ]);

    expect(timeline[0]!.summary).toBe("Command executed: bun test (exit 1)");
    expect(timeline[1]!.summary).toBe("Command recorded");
  });
});

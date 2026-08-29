import { describe, expect, test } from "bun:test";
import type { HarnessEvent } from "../../../olt/scripts/src/core/contracts/index.ts";
// The B15.1 contract itself: imported from graph-types.ts directly, not the types.ts re-export
// barrel, since ActionStepRecord is new enough that no prior test ever settled on either style.
import type { ActionStepRecord } from "../../../olt/scripts/src/summary/graph-types.ts";
import {
  collectActionSteps,
  collectTimeline,
} from "../../../olt/scripts/src/summary/timeline-collector.ts";

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
      createEvent("validation-started", { task_id: "T-1" }, 4),
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

  test("an event missing an optional descriptive field says so, never a plausible-looking filler", () => {
    const timeline = collectTimeline([
      createEvent("plan-task-added", { id: "T-9" }, 1),
      createEvent("task-escalated-by-supervisor", { task_id: "T-9" }, 2),
      createEvent("critic-reviewed", {}, 3),
    ]);

    expect(timeline[0]!.summary).toBe("Task T-9 added: an unrecorded label");
    expect(timeline[1]!.summary).toBe("Task T-9 escalated by test-actor: no reason recorded");
    expect(timeline[2]!.summary).toBe("Completeness critic review completed (no verdict recorded)");
  });

  test("lease-renewed and lease-revoked each name the task the lease belongs to", () => {
    const timeline = collectTimeline([
      createEvent("lease-renewed", { task_id: "T-1" }, 1),
      createEvent("lease-revoked", { task_id: "T-1" }, 2),
    ]);
    expect(timeline[0]!.phase).toBe("execution");
    expect(timeline[0]!.summary).toBe("Lease renewed for task T-1 by test-actor");
    expect(timeline[0]!.task_id).toBe("T-1");
    expect(timeline[1]!.summary).toBe("Lease revoked for task T-1");
    expect(timeline[1]!.task_id).toBe("T-1");
  });

  test("command-intent-recorded and command-reconciled each state the command's own progress", () => {
    const timeline = collectTimeline([
      createEvent("command-intent-recorded", { task_id: "T-1", command_id: "C-1" }, 1),
      createEvent("command-reconciled", { command_id: "C-1", status: "succeeded" }, 2),
      createEvent("command-reconciled", { command_id: "C-2" }, 3),
      // No task_id on either: phase falls to "system" rather than "execution".
      createEvent("command-intent-recorded", { command_id: "C-3" }, 4),
    ]);
    expect(timeline[0]!.phase).toBe("execution");
    expect(timeline[0]!.summary).toBe("Command C-1 started");
    expect(timeline[0]!.command_id).toBe("C-1");
    expect(timeline[1]!.summary).toBe("Command C-1 finished (succeeded)");
    expect(timeline[2]!.summary).toBe("Command C-2 reconciled");
    expect(timeline[3]!.phase).toBe("system");
  });

  test("tasks-unblocked states a fixed, self-explanatory summary", () => {
    const [entry] = collectTimeline([createEvent("tasks-unblocked", {}, 1)]);
    expect(entry!.phase).toBe("execution");
    expect(entry!.summary).toBe("Downstream tasks unblocked and marked ready");
  });

  // Regression guard for the wiring itself, not just `step-event-summaries.ts` in isolation: a
  // real fixture run (`os.tmpdir()/fixture-build/build-fixture.ts`) had 42 of 78 recorded steps fall to
  // the fully generic `Event <kind> recorded by <actor>` before this case existed, which is what
  // B21.3's "reconstructible from summaries alone" bar refuses to accept. This proves both
  // `collectTimeline` and `collectActionSteps` route an event kind their own switch has no case
  // for through the narration module before falling back to the generic text.
  test("both collectTimeline and collectActionSteps narrate a kind their own switch has no case for", () => {
    const event = createEvent(
      "branch-opened",
      { branch_id: "B-1", parent_task_id: "T-1", reason: "the flush path needs investigation" },
      1,
    );
    const [timelineEntry] = collectTimeline([event]);
    expect(timelineEntry!.phase).toBe("branch");
    expect(timelineEntry!.summary).toBe(
      "Branch B-1 opened off T-1 by test-actor: the flush path needs investigation",
    );

    const [step] = collectActionSteps([event]);
    expect(step!.summary).toBe(
      "Branch B-1 opened off T-1 by test-actor: the flush path needs investigation",
    );
    expect(step!.summary.startsWith("Event ")).toBe(false);
  });
});

describe("collectActionSteps", () => {
  test("buckets every kind the harness actually records", () => {
    const steps = collectActionSteps([
      createEvent("command-recorded", {}, 1),
      createEvent("agent-registered", {}, 2),
      createEvent("task-claimed", {}, 3),
      createEvent("packet-published", {}, 4),
      createEvent("review-recorded", {}, 5),
      createEvent("probe-recorded", {}, 6),
      createEvent("branch-opened", {}, 7),
      createEvent("gate-attached", {}, 8),
      createEvent("plan-compiled", {}, 9),
      createEvent("task-submitted", {}, 10),
      createEvent("run-completed", {}, 11),
    ]);
    expect(steps.map((step) => step.kind)).toEqual([
      "command",
      "agent",
      "lease",
      "packet",
      "review",
      "probe",
      "branch",
      "gate",
      "plan",
      "task",
      "run",
    ]);
  });

  test("a kind this switch has never seen still gets a bucket and a row, not dropped or a crash", () => {
    const steps = collectActionSteps([
      createEvent("some-future-kind-nobody-has-written-yet", {}, 1),
    ]);
    expect(steps[0]!.kind).toBe("run");
    expect(steps[0]!.rawKind).toBe("some-future-kind-nobody-has-written-yet");
  });

  // Regression guard: begin-validation.ts and escalate.ts emit "validation-started" and
  // "task-escalated-by-supervisor" respectively — the only strings either code path ever produces.
  // Matching a plausible-looking but wrong literal ("task-validation-started", "task-escalated")
  // would silently fall through to the default "run" bucket on real fixture data without ever
  // failing a test built only from invented event kinds, which is exactly how this drifted before.
  test("classifies the real store-emitted validation and escalation kinds, not a guessed name", () => {
    const steps = collectActionSteps([
      createEvent("validation-started", { task_id: "T-1" }, 1),
      createEvent(
        "task-escalated-by-supervisor",
        { task_id: "T-1", reason: "retry_budget_exhausted" },
        2,
      ),
    ]);
    expect(steps[0]!.kind).toBe("gate");
    expect(steps[1]!.kind).toBe("task");
  });

  test("step is the chain's own monotonic sequence, not a second counter", () => {
    const steps: ActionStepRecord[] = collectActionSteps([
      createEvent("task-claimed", { task_id: "T-1", role: "implementer" }, 7),
      createEvent("task-submitted", { task_id: "T-1" }, 12),
    ]);
    expect(steps.map((step) => step.step)).toEqual([7, 12]);
    expect(steps[0]!.evidence_class).toBe("harness_observed");
    expect(steps.every((step) => step.evidence_class === "harness_observed")).toBe(true);
  });

  test("every recorded action kind reaches the trace, in the taxonomy B15.1 asks for", () => {
    const steps = collectActionSteps([
      createEvent("command-recorded", { command_id: "C-1", exit_code: 0 }, 1),
      createEvent("agent-registered", { agent_id: "A-1" }, 2),
      createEvent("task-claimed", { task_id: "T-1", role: "implementer" }, 3),
      createEvent("packet-published", { packet_id: "P-1" }, 4),
      createEvent("branch-opened", { branch_id: "B-1", parent_task_id: "T-1" }, 5),
      createEvent("gate-attached", { task_id: "T-1", gate_id: "gate-1" }, 6),
      createEvent("plan-compiled", {}, 7),
      createEvent("probe-recorded", { task_id: "T-1", round: 1 }, 8),
    ]);
    expect(steps.map((step) => step.kind)).toEqual([
      "command",
      "agent",
      "lease",
      "packet",
      "branch",
      "gate",
      "plan",
      "probe",
    ]);
    // rawKind is never lost even though kind is a coarse bucket.
    expect(steps.map((step) => step.rawKind)).toEqual([
      "command-recorded",
      "agent-registered",
      "task-claimed",
      "packet-published",
      "branch-opened",
      "gate-attached",
      "plan-compiled",
      "probe-recorded",
    ]);
  });

  test("resolves a task target to the same node id the task node builder mints", () => {
    const steps = collectActionSteps([
      createEvent("task-claimed", { task_id: "T-1", role: "implementer" }, 1),
      createEvent("gate-attached", { task_id: "T-1", gate_id: "gate-1", command_id: "C-1" }, 2),
      createEvent("branch-claimed", { branch_id: "B-1", sub_task_id: "S-1", agent_id: "A-1" }, 3),
    ]);
    expect(steps[0]!.target).toEqual({ taskId: "T-1", nodeId: "node-task-T-1" });
    expect(steps[1]!.target).toEqual({
      taskId: "T-1",
      gateId: "gate-1",
      commandId: "C-1",
      nodeId: "node-gate-T-1",
    });
    expect(steps[2]!.target).toEqual({
      branchId: "B-1",
      subTaskId: "S-1",
      agentId: "A-1",
      nodeId: "node-branch-B-1-S-1",
    });
  });

  test("a target with no known node convention carries its identifiers with no node id at all", () => {
    const steps = collectActionSteps([createEvent("packet-published", { packet_id: "P-1" }, 1)]);
    expect(steps[0]!.target).toEqual({ packetId: "P-1" });
  });

  test("outcome comes from an explicit verdict or exit code, never a guess", () => {
    const steps = collectActionSteps([
      createEvent("review-recorded", { task_id: "T-1", verdict: "pass" }, 1),
      createEvent("review-recorded", { task_id: "T-1", verdict: "reject" }, 2),
      createEvent("review-recorded", { task_id: "T-1" }, 3),
      createEvent("command-recorded", { command_id: "C-1", exit_code: 0 }, 4),
      createEvent("command-recorded", { command_id: "C-2", exit_code: 1 }, 5),
      createEvent("command-recorded", { command_id: "C-3" }, 6),
    ]);
    expect(steps.map((step) => step.outcome)).toEqual([
      "success",
      "failure",
      "unknown",
      "success",
      "failure",
      "unknown",
    ]);
  });

  test("a kind with no verdict of its own defaults to success, on the fact of its own commit", () => {
    // `branch-abandoned` sounds negative, but nothing in the payload states a verdict, so this must
    // not infer failure from the kind's name (the operating contract's explicit rule).
    const steps = collectActionSteps([
      createEvent("branch-abandoned", { branch_id: "B-1" }, 1),
      createEvent("task-cancelled", { task_id: "T-1" }, 2),
    ]);
    expect(steps.every((step) => step.outcome === "success")).toBe(true);
  });

  test("gate-started buckets as a gate action, and plan-init/plan-audit-accepted as plan actions", () => {
    const steps = collectActionSteps([
      createEvent("gate-started", { task_id: "T-1" }, 1),
      createEvent("plan-init", {}, 2),
      createEvent("plan-audit-accepted", { invariant: "x" }, 3),
    ]);
    expect(steps.map((step) => step.kind)).toEqual(["gate", "plan", "plan"]);
  });

  test("gate-completed's outcome reads verdict or status, and is unknown when neither is stated", () => {
    const steps = collectActionSteps([
      createEvent("gate-completed", { task_id: "T-1", verdict: "pass" }, 1),
      createEvent("gate-completed", { task_id: "T-1", status: "pass" }, 2),
      createEvent("gate-completed", { task_id: "T-1", verdict: "reject" }, 3),
      createEvent("gate-completed", { task_id: "T-1" }, 4),
    ]);
    expect(steps.map((step) => step.outcome)).toEqual(["success", "success", "failure", "unknown"]);
  });

  test("critic-reviewed's outcome treats clean and pass as success, anything else stated as failure", () => {
    const steps = collectActionSteps([
      createEvent("critic-reviewed", { verdict: "clean" }, 1),
      createEvent("critic-reviewed", { verdict: "pass" }, 2),
      createEvent("critic-reviewed", { verdict: "findings" }, 3),
      createEvent("critic-reviewed", {}, 4),
    ]);
    expect(steps.map((step) => step.outcome)).toEqual(["success", "success", "failure", "unknown"]);
  });

  test("command-reconciled's outcome treats failed and error as failure, anything else stated as success", () => {
    const steps = collectActionSteps([
      createEvent("command-reconciled", { command_id: "C-1", status: "failed" }, 1),
      createEvent("command-reconciled", { command_id: "C-2", status: "error" }, 2),
      createEvent("command-reconciled", { command_id: "C-3", status: "succeeded" }, 3),
      createEvent("command-reconciled", { command_id: "C-4" }, 4),
    ]);
    expect(steps.map((step) => step.outcome)).toEqual(["failure", "failure", "success", "unknown"]);
  });
});

import { describe, expect, test } from "bun:test";
import type { HarnessEvent } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { ActionStepRecord } from "../../../olt/scripts/src/summary/graph/index.ts";
import { collectActionSteps } from "../../../olt/scripts/src/summary/metrics/index.ts";

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

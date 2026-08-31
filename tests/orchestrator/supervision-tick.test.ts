import { describe, expect, test } from "bun:test";
import { claimTask } from "../../olt/scripts/src/workflow/lease/claim.ts";
import {
  changesRequestedTasks,
  runSupervisionTick,
} from "../../olt/scripts/src/orchestrator/supervision-tick.ts";
import { TestPort, workflowState } from "../workflow/test-port.ts";

function twoTaskState() {
  const state = workflowState();
  state.tasks["T-2"] = {
    ...structuredClone(state.tasks["T-1"]!),
    id: "T-2",
    write_scope: ["src/other-owned"],
  };
  return state;
}

describe("runSupervisionTick (B28.2/B28.3 — reclaim and escalate)", () => {
  test("detects a dead agent without being told and returns its task to the eligible pool", () => {
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent-a", "implementer", {
      leaseSeconds: 5,
      clock: { now: () => new Date("2026-08-19T00:00:00.000Z") },
    });
    const tick = runSupervisionTick(port, "supervisor", {
      graceSeconds: 0,
      clock: { now: () => new Date("2026-08-19T00:01:00.000Z") },
    });
    expect(tick.reclaimed).toEqual([
      {
        kind: "task-lease",
        taskId: "T-1",
        agentId: "agent-a",
        reason: "expired_lease_no_submission",
        newStatus: "retry_ready",
      },
    ]);
    expect(tick.state.tasks["T-1"]!.status).toBe("retry_ready");
    expect(tick.escalatedNow).toEqual([]);
    expect(tick.occupied).toBe(0);
  });

  test("the crux: a task dead three times in a row escalates instead of retrying forever, and its neighbor is unaffected", () => {
    const state = twoTaskState();
    const port = new TestPort(state);
    let now = new Date("2026-08-19T00:00:00.000Z");
    let tick;
    for (let round = 0; round < 3; round++) {
      claimTask(port, "T-1", `agent-${round}`, "implementer", {
        leaseSeconds: 5,
        clock: { now: () => now },
      });
      now = new Date(now.valueOf() + 60_000);
      tick = runSupervisionTick(port, "supervisor", {
        graceSeconds: 0,
        deterministicRepeatThreshold: 3,
        clock: { now: () => now },
      });
    }
    expect(tick!.escalatedNow).toHaveLength(1);
    expect(tick!.escalatedNow[0]?.taskId).toBe("T-1");
    expect(tick!.escalatedNow[0]?.reason).toBe("retry_budget_exhausted");
    expect(tick!.state.tasks["T-1"]!.status).toBe("escalated");
    // T-2 never had anything go wrong, so its status is untouched by T-1's escalation — the
    // supervisor evaluates each task's own history, not the run as a whole.
    expect(tick!.state.tasks["T-2"]!.status).toBe("ready");
  });

  test("re-evaluating an already-escalated task's stale streak swallows the resulting INVALID_STATE instead of throwing", () => {
    const state = twoTaskState();
    const port = new TestPort(state);
    let now = new Date("2026-08-19T00:00:00.000Z");
    for (let round = 0; round < 3; round++) {
      claimTask(port, "T-1", `agent-${round}`, "implementer", {
        leaseSeconds: 5,
        clock: { now: () => now },
      });
      now = new Date(now.valueOf() + 60_000);
      runSupervisionTick(port, "supervisor", {
        graceSeconds: 0,
        deterministicRepeatThreshold: 3,
        clock: { now: () => now },
      });
    }
    expect(port.read().tasks["T-1"]!.status).toBe("escalated");

    // T-1 is already escalated and holds no lease, so its stale streak from before still reads as
    // "dead" here too — escalateTask itself now refuses ("escalated" is not an escalatable status),
    // and the tick has to absorb that INVALID_STATE rather than let it propagate.
    now = new Date(now.valueOf() + 60_000);
    const again = runSupervisionTick(port, "supervisor", {
      graceSeconds: 0,
      deterministicRepeatThreshold: 3,
      clock: { now: () => now },
    });
    expect(again.escalatedNow).toEqual([]);
    expect(port.read().tasks["T-1"]!.status).toBe("escalated");
  });

  test("does not escalate on the second dead agent when the threshold has not been reached", () => {
    const port = new TestPort(workflowState());
    let now = new Date("2026-08-19T00:00:00.000Z");
    let tick;
    for (let round = 0; round < 2; round++) {
      claimTask(port, "T-1", `agent-${round}`, "implementer", {
        leaseSeconds: 5,
        clock: { now: () => now },
      });
      now = new Date(now.valueOf() + 60_000);
      tick = runSupervisionTick(port, "supervisor", {
        graceSeconds: 0,
        deterministicRepeatThreshold: 3,
        clock: { now: () => now },
      });
    }
    expect(tick!.escalatedNow).toEqual([]);
    expect(tick!.state.tasks["T-1"]!.status).toBe("retry_ready");
  });

  test("counts a live lease against occupancy without touching it", () => {
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent-a", "implementer", {
      leaseSeconds: 3_600,
      clock: { now: () => new Date("2026-08-19T00:00:00.000Z") },
    });
    const tick = runSupervisionTick(port, "supervisor", {
      clock: { now: () => new Date("2026-08-19T00:01:00.000Z") },
    });
    expect(tick.occupied).toBe(1);
    expect(tick.reclaimed).toEqual([]);
    expect(tick.state.tasks["T-1"]!.lease).toBeDefined();
  });

  test("B28.5: recovery is on by default and opting out skips both reclaim and escalation", () => {
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent-a", "implementer", {
      leaseSeconds: 5,
      clock: { now: () => new Date("2026-08-19T00:00:00.000Z") },
    });
    const tick = runSupervisionTick(port, "supervisor", {
      recoveryEnabled: false,
      clock: { now: () => new Date("2026-08-19T00:01:00.000Z") },
    });
    expect(tick.reclaimed).toEqual([]);
    expect(tick.state.tasks["T-1"]!.lease).toBeDefined();
  });

  test("surfaces a rejected task the reclaim/escalate pass never touches, so it stops being invisible", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "changes_requested";
    state.tasks["T-1"]!.original_implementer = "impl-1";
    state.tasks["T-1"]!.repair_assignee = "impl-1";
    state.tasks["T-1"]!.history.push({
      at: "2026-08-19T00:00:00.000Z",
      actor: "validator-1",
      from: "validating",
      to: "changes_requested",
      reason: "missing error handling on the empty-input path",
      attempt: 1,
    });
    const port = new TestPort(state);

    const tick = runSupervisionTick(port, "supervisor", {
      clock: { now: () => new Date("2026-08-19T00:01:00.000Z") },
    });

    expect(tick.changesRequested).toEqual([
      {
        taskId: "T-1",
        reason: "missing error handling on the empty-input path",
        originalImplementer: "impl-1",
        repairAssignee: "impl-1",
      },
    ]);
    // No lease, no stale streak — reclaim and escalation both pass over it untouched.
    expect(tick.reclaimed).toEqual([]);
    expect(tick.escalatedNow).toEqual([]);
    expect(tick.state.tasks["T-1"]!.status).toBe("changes_requested");
  });
});

describe("changesRequestedTasks", () => {
  test("reads the most recent changes_requested transition, not an earlier one from a prior repair round", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "changes_requested";
    state.tasks["T-1"]!.history.push(
      {
        at: "2026-08-19T00:00:00.000Z",
        actor: "validator-1",
        from: "validating",
        to: "changes_requested",
        reason: "first round: missing tests",
        attempt: 1,
      },
      {
        at: "2026-08-19T00:10:00.000Z",
        actor: "repairer-1",
        from: "changes_requested",
        to: "leased",
        reason: "repair claimed",
        attempt: 2,
      },
      {
        at: "2026-08-19T00:20:00.000Z",
        actor: "validator-1",
        from: "validating",
        to: "changes_requested",
        reason: "second round: still missing an edge case",
        attempt: 2,
      },
    );
    expect(changesRequestedTasks(state)).toEqual([
      { taskId: "T-1", reason: "second round: still missing an edge case" },
    ]);
  });

  test("honesty: no recorded transition reports unknown, never a guess", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "changes_requested";
    expect(changesRequestedTasks(state)).toEqual([{ taskId: "T-1", reason: "unknown" }]);
  });

  test("omits original_implementer and repair_assignee entirely when the task never recorded them", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "changes_requested";
    const [entry] = changesRequestedTasks(state);
    expect(entry).toEqual({ taskId: "T-1", reason: "unknown" });
    expect(Object.hasOwn(entry!, "originalImplementer")).toBeFalse();
    expect(Object.hasOwn(entry!, "repairAssignee")).toBeFalse();
  });

  test("a task in any other status is left out entirely", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "ready";
    expect(changesRequestedTasks(state)).toEqual([]);
  });
});

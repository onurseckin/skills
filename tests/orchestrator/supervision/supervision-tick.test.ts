import { describe, expect, test } from "bun:test";
import { claimTask } from "../../../olt/scripts/src/workflow/lease/claim.ts";
import {
  changesRequestedTasks,
  runSupervisionTick,
} from "../../../olt/scripts/src/orchestrator/supervision-tick.ts";
import { TestPort, workflowState } from "../../workflow/shared/test-port.ts";

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

    expect(tick?.escalatedNow).toEqual([
      {
        taskId: "T-1",
        reason: "retry_budget_exhausted",
        evidence:
          '3 consecutive lease(s) expired with no submission (the same "crash" failure ("lease expired with no submission") repeated 3 times in a row)',
      },
    ]);
    expect(port.state.tasks["T-1"]!.status).toBe("escalated");
    expect(port.state.tasks["T-1"]!.escalation_reason).toBe("retry_budget_exhausted");
    expect(port.state.tasks["T-2"]!.status).toBe("ready");
  });

  test("respects the caller's deterministicRepeatThreshold override, escalating at 2 if told to", () => {
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
        deterministicRepeatThreshold: 2,
        clock: { now: () => now },
      });
    }
    expect(tick?.escalatedNow).toHaveLength(1);
    expect(port.state.tasks["T-1"]!.status).toBe("escalated");
  });

  test("an active lease within its deadline is not reclaimed and counts against occupancy", () => {
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent-live", "implementer", {
      leaseSeconds: 3600,
      clock: { now: () => new Date("2026-08-19T00:00:00.000Z") },
    });
    const tick = runSupervisionTick(port, "supervisor", {
      graceSeconds: 0,
      clock: { now: () => new Date("2026-08-19T00:01:00.000Z") },
    });
    expect(tick.reclaimed).toEqual([]);
    expect(tick.escalatedNow).toEqual([]);
    expect(tick.occupied).toBe(1);
    expect(tick.state.tasks["T-1"]!.status).toBe("leased");
  });

  test("a recently-expired lease within the grace period is spared for one more beat", () => {
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent-grace", "implementer", {
      leaseSeconds: 5,
      clock: { now: () => new Date("2026-08-19T00:00:00.000Z") },
    });
    const tick = runSupervisionTick(port, "supervisor", {
      graceSeconds: 30,
      clock: { now: () => new Date("2026-08-19T00:00:10.000Z") },
    });
    expect(tick.reclaimed).toEqual([]);
    expect(tick.occupied).toBe(1);
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

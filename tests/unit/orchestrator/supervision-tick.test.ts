import { describe, expect, test } from "bun:test";
import { claimTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/claim.ts";
import { runSupervisionTick } from "../../../orchestrating-long-tasks/scripts/src/orchestrator/supervision-tick.ts";
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
});

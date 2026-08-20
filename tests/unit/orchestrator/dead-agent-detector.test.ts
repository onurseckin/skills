import { describe, expect, test } from "bun:test";
import { claimTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/claim.ts";
import type { BranchLease } from "../../../orchestrating-long-tasks/scripts/src/contracts/branch.ts";
import {
  DEAD_AGENT_RECLAIMED_KIND,
  reclaimDeadAgents,
} from "../../../orchestrating-long-tasks/scripts/src/orchestrator/dead-agent-detector.ts";
import { at, TestPort, workflowState } from "../workflow/test-port.ts";

const start = at("2026-08-19T00:00:00.000Z");
const later = at("2026-08-19T01:00:00.000Z");

describe("reclaimDeadAgents (B28.2 — detect a dead agent without being told)", () => {
  test("reports nothing when there is nothing stale", () => {
    const port = new TestPort(workflowState());
    const result = reclaimDeadAgents(port, "supervisor", start);
    expect(result.events).toEqual([]);
  });

  test("finds an expired lease with no submission and names the agent", () => {
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent-a", "implementer", { leaseSeconds: 5, clock: start });
    const result = reclaimDeadAgents(port, "supervisor", later);
    expect(result.events).toEqual([
      {
        kind: "task-lease",
        taskId: "T-1",
        agentId: "agent-a",
        reason: "expired_lease_no_submission",
        newStatus: "retry_ready",
      },
    ]);
    expect(result.state.tasks["T-1"]!.lease).toBeUndefined();
  });

  test("does not report a task whose lease is still live", () => {
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent-a", "implementer", { leaseSeconds: 3_600, clock: start });
    const result = reclaimDeadAgents(port, "supervisor", later);
    expect(result.events).toEqual([]);
  });

  test("records a durable event per reclaimed agent, so a restarted supervisor can count it later", () => {
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent-a", "implementer", { leaseSeconds: 5, clock: start });
    reclaimDeadAgents(port, "supervisor", later);
    const recorded = port.events.filter((event) => event.kind === DEAD_AGENT_RECLAIMED_KIND);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.payload.task_id).toBe("T-1");
    expect(recorded[0]?.payload.agent_id).toBe("agent-a");
  });

  test("finds a branch sub-task whose sub-agent died", () => {
    const state = workflowState();
    state.branches = [
      {
        id: "B-1",
        parent_task_id: "T-1",
        parent_agent_id: "agent-parent",
        reason: "investigate a defect",
        depth: 1,
        status: "open",
        opened_at: "2026-08-19T00:00:00.000Z",
        sub_tasks: [
          {
            id: "S-1",
            label: "investigate",
            write_scope: ["src/owned/sub"],
            status: "claimed",
            agent_id: "agent-sub",
            claimed_at: "2026-08-19T00:00:00.000Z",
            lease: {
              agent_id: "agent-sub",
              token_digest: "a".repeat(64),
              issued_at: "2026-08-19T00:00:00.000Z",
              expires_at: "2026-08-19T00:00:05.000Z",
              duration_seconds: 5,
            } satisfies BranchLease,
          },
        ],
      },
    ];
    // T-1 itself holds no lease in this fixture, so recoverStale has nothing of the parent's own to
    // reap; only the sub-task's lease is under test here.
    const port = new TestPort(state);
    const result = reclaimDeadAgents(port, "supervisor", later, { graceSeconds: 0 });
    const subLeaseEvent = result.events.find((event) => event.kind === "branch-sub-lease");
    expect(subLeaseEvent).toEqual({
      kind: "branch-sub-lease",
      taskId: "S-1",
      reason: "expired_lease_no_submission",
      newStatus: "open",
    });
  });
});

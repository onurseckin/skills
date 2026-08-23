import { describe, expect, test } from "bun:test";
import { claimTask } from "../../../olt/scripts/src/workflow/lease/claim.ts";
import { heartbeat } from "../../../olt/scripts/src/workflow/lease/heartbeat.ts";
import { beginValidation } from "../../../olt/scripts/src/workflow/review/begin-validation.ts";
import { submitTask } from "../../../olt/scripts/src/workflow/submission/submit.ts";
import type { BranchLease } from "../../../olt/scripts/src/core/contracts/branch.ts";
import {
  DEAD_AGENT_RECLAIMED_KIND,
  reclaimDeadAgents,
} from "../../../olt/scripts/src/orchestrator/dead-agent-detector.ts";
import { at, registerTaskPacket, TestPort, workflowState } from "../workflow/test-port.ts";
import { completionPort } from "../workflow/completion-provenance-fixture.ts";

const start = at("2026-08-19T00:00:00.000Z");
const later = at("2026-08-19T01:00:00.000Z");
const report = {
  summary: "implemented",
  requirement_ids: ["R-1"],
  files_changed: ["src/owned/a.ts"],
  checks: [{ command: "bun test", status: "passed" }],
  evidence: [{ kind: "diff", path: "src/owned/a.ts" }],
};

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

  test("B28.2: a grant whose heartbeat lapsed — staleness is judged against the LAST heartbeat-extended deadline, not the original claim", () => {
    const port = new TestPort(workflowState());
    let now = new Date("2026-08-19T00:00:00.000Z");
    const { token } = claimTask(port, "T-1", "agent-a", "implementer", {
      leaseSeconds: 5,
      clock: { now: () => now },
    });

    // Two heartbeats, each proof the agent was genuinely alive and each extending the deadline
    // another 5s past when the ORIGINAL 5s lease would have expired.
    now = new Date(now.valueOf() + 3_000);
    heartbeat(port, "T-1", "agent-a", token, { now: () => now });
    now = new Date(now.valueOf() + 3_000);
    heartbeat(port, "T-1", "agent-a", token, { now: () => now });

    // 6s have now elapsed since the original claim — past the original 5s lease — but only 3s
    // since the last heartbeat extended it another 5s. A detector keyed on the original deadline
    // would wrongly reap a live agent here; the correct one must not.
    let result = reclaimDeadAgents(port, "supervisor", { now: () => now }, { graceSeconds: 0 });
    expect(result.events).toEqual([]);
    expect(result.state.tasks["T-1"]!.lease).toBeDefined();

    // The heartbeats stop here — "a grant whose heartbeat lapsed" is exactly this: the last thing
    // heard from the agent was a heartbeat, then silence. Once the LAST extended deadline itself
    // passes with nothing more, it is dead — detected without any explicit crash signal, purely
    // from the missing submission past the deadline heartbeats had been holding open.
    now = new Date(now.valueOf() + 10_000);
    result = reclaimDeadAgents(port, "supervisor", { now: () => now }, { graceSeconds: 0 });
    expect(result.events).toEqual([
      {
        kind: "task-lease",
        taskId: "T-1",
        agentId: "agent-a",
        reason: "expired_lease_no_submission",
        newStatus: "retry_ready",
      },
    ]);
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

describe("reclaimDeadAgents — a validator that dies mid-validation (D1: the task itself holds no lease)", () => {
  function submittedForValidation(port: TestPort): void {
    const { token } = claimTask(port, "T-1", "agent-a", "implementer", { clock: start });
    registerTaskPacket(port, "implementer", "agent-a", 1);
    submitTask(port, "T-1", "agent-a", token, report, start);
  }

  test("names a validator whose validation deadline lapsed with no verdict recorded", () => {
    const port = new TestPort(workflowState());
    submittedForValidation(port);
    beginValidation(port, "T-1", "validator-dead", start, 5);
    expect(port.read().tasks["T-1"]!.lease).toBeUndefined();
    expect(port.read().tasks["T-1"]!.status).toBe("validating");

    const result = reclaimDeadAgents(port, "supervisor", at("2026-08-19T00:00:36.000Z"), {
      graceSeconds: 30,
    });
    expect(result.events).toEqual([
      {
        kind: "validation",
        taskId: "T-1",
        agentId: "validator-dead",
        reason: "expired_lease_no_submission",
        newStatus: "submitted",
      },
    ]);
    expect(result.state.tasks["T-1"]!.validations).toBeUndefined();
    expect(result.state.tasks["T-1"]!.status).toBe("submitted");
  });

  test("does not report a validation whose deadline has not passed", () => {
    const port = new TestPort(workflowState());
    submittedForValidation(port);
    beginValidation(port, "T-1", "validator-alive", start, 1_200);
    const result = reclaimDeadAgents(port, "supervisor", at("2026-08-19T00:00:10.000Z"), {
      graceSeconds: 30,
    });
    expect(result.events).toEqual([]);
  });

  test("names only the validator that died while a second domain's validation stays open", () => {
    const state = workflowState();
    state.tasks["T-1"]!.write_scope = ["src/owned/a.tsx"];
    const port = new TestPort(state);
    const tsxReport = { ...report, files_changed: ["src/owned/a.tsx"] };
    const { token } = claimTask(port, "T-1", "agent-a", "implementer", { clock: start });
    registerTaskPacket(port, "implementer", "agent-a", 1);
    submitTask(port, "T-1", "agent-a", token, tsxReport, start);
    beginValidation(port, "T-1", "validator-dead", start, 5, "code-quality");
    beginValidation(port, "T-1", "validator-alive", start, 1_200, "ui-design");

    const result = reclaimDeadAgents(port, "supervisor", at("2026-08-19T00:00:36.000Z"), {
      graceSeconds: 30,
    });
    expect(result.events).toEqual([
      {
        kind: "validation",
        taskId: "T-1",
        agentId: "validator-dead",
        reason: "expired_lease_no_submission",
        newStatus: "validating",
      },
    ]);
    expect(result.state.tasks["T-1"]!.status).toBe("validating");
    expect(
      result.state.tasks["T-1"]!.validations!.some(
        (validation) => validation.validator_id === "validator-alive",
      ),
    ).toBeTrue();
  });
});

describe("reclaimDeadAgents — a completeness critic that dies mid-review (D1)", () => {
  test("names a critic whose review deadline lapsed with no review recorded", () => {
    const port = completionPort();
    expect(port.read().completion_critic?.status).toBe("packet_published");

    const result = reclaimDeadAgents(port, "supervisor", at("2026-08-13T13:00:31.000Z"), {
      graceSeconds: 30,
    });
    expect(result.events).toEqual([
      {
        kind: "completeness-critic",
        agentId: "critic",
        reason: "expired_lease_no_submission",
        newStatus: "expired",
      },
    ]);
    expect(result.state.completion_critic?.status).toBe("expired");
    expect(result.state.completion_critic_history?.at(-1)?.status).toBe("expired");
  });

  test("does not report a critic whose review deadline has not passed", () => {
    const port = completionPort();
    const result = reclaimDeadAgents(port, "supervisor", at("2026-08-13T12:30:00.000Z"), {
      graceSeconds: 30,
    });
    expect(result.events).toEqual([]);
  });

  test("does not re-report a critic that was already reclaimed on an earlier tick", () => {
    const port = completionPort();
    reclaimDeadAgents(port, "supervisor", at("2026-08-13T13:00:31.000Z"), { graceSeconds: 30 });
    const second = reclaimDeadAgents(port, "supervisor", at("2026-08-13T14:00:00.000Z"), {
      graceSeconds: 30,
    });
    expect(second.events).toEqual([]);
  });
});

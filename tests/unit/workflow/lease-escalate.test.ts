import { describe, expect, test } from "bun:test";
import { claimTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/claim.ts";
import { escalateTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/escalate.ts";
import { at, TestPort, workflowState } from "./test-port.ts";

const start = at("2026-08-19T00:00:00.000Z");

describe("escalateTask (B28.3)", () => {
  test("moves a retriable task to escalated and records why", () => {
    const port = new TestPort(workflowState());
    const state = escalateTask(
      port,
      "T-1",
      "supervisor",
      "retry_budget_exhausted",
      "3 consecutive lease(s) expired with no submission",
      start,
    );
    const task = state.tasks["T-1"]!;
    expect(task.status).toBe("escalated");
    expect(task.escalation_reason).toBe("retry_budget_exhausted");
    expect(task.escalation_evidence).toBe("3 consecutive lease(s) expired with no submission");
    expect(task.escalation_at).toBe("2026-08-19T00:00:00.000Z");
    expect(task.history.at(-1)?.to).toBe("escalated");
    expect(task.history.at(-1)?.reason).toContain("retry_budget_exhausted");
  });

  test("refuses to escalate a task holding a live lease", () => {
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent-a", "implementer", { clock: start });
    expect(() =>
      escalateTask(
        port,
        "T-1",
        "supervisor",
        "deterministic_failure",
        "same gate failed 3x",
        start,
      ),
    ).toThrow();
  });

  test("refuses to escalate a task already in a terminal status", () => {
    const port = new TestPort(workflowState());
    escalateTask(port, "T-1", "supervisor", "deterministic_failure", "first escalation", start);
    expect(() =>
      escalateTask(port, "T-1", "supervisor", "deterministic_failure", "second escalation", start),
    ).toThrow();
  });

  test("requires non-blank evidence", () => {
    const port = new TestPort(workflowState());
    expect(() =>
      escalateTask(port, "T-1", "supervisor", "deterministic_failure", "  ", start),
    ).toThrow();
  });

  test("refuses to escalate a task carrying an open attempt", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "retry_ready";
    state.tasks["T-1"]!.attempts.push({
      attempt: 1,
      agent_id: "agent-a",
      role: "implementer",
      kind: "implementation",
      started_at: start.now().toISOString(),
    });
    const port = new TestPort(state);
    expect(() =>
      escalateTask(
        port,
        "T-1",
        "supervisor",
        "deterministic_failure",
        "same gate failed 3x",
        start,
      ),
    ).toThrow("open attempt");
    expect(port.read().tasks["T-1"]!.status).toBe("retry_ready");
  });
});

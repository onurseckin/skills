import { describe, expect, test } from "bun:test";
import { abandonAttempt } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/abandon.ts";
import {
  isAttemptOpen,
  openAttempts,
} from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/attempt-state.ts";
import { claimTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/claim.ts";
import { recoverStale } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/recover-stale.ts";
import { submitTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/submission/submit.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import { at, registerTaskPacket, TestPort, workflowState } from "./test-port.ts";

const start = at("2026-08-19T00:00:00.000Z");
const report = {
  summary: "implemented",
  requirement_ids: ["R-1"],
  files_changed: ["src/owned/a.ts"],
  checks: [{ command: "bun test", status: "passed" }],
  evidence: [{ kind: "diff", path: "src/owned/a.ts" }],
};

describe("attempt open/closed lifecycle", () => {
  test("a freshly claimed attempt is open", () => {
    const port = new TestPort(workflowState());
    const { state } = claimTask(port, "T-1", "agent-a", "implementer", { clock: start });
    const attempt = state.tasks["T-1"]!.attempts.at(-1)!;
    expect(isAttemptOpen(attempt)).toBeTrue();
    expect(openAttempts(state.tasks["T-1"]!.attempts)).toHaveLength(1);
  });

  test("submit closes the attempt it submits", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent-a", "implementer", { clock: start });
    registerTaskPacket(port, "implementer", "agent-a", 1);
    const { state } = submitTask(port, "T-1", "agent-a", token, report, start);
    const attempt = state.tasks["T-1"]!.attempts.at(-1)!;
    expect(attempt.submitted_at).toBe("2026-08-19T00:00:00.000Z");
    expect(isAttemptOpen(attempt)).toBeFalse();
    expect(openAttempts(state.tasks["T-1"]!.attempts)).toHaveLength(0);
  });

  test("recoverStale closes the attempt it reclaims with an attributed reason", () => {
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent-a", "implementer", { leaseSeconds: 5, clock: start });
    const state = recoverStale(port, "coordinator", at("2026-08-19T00:00:36.000Z"), {
      graceSeconds: 30,
    });
    const attempt = state.tasks["T-1"]!.attempts.at(-1)!;
    expect(attempt.abandoned_at).toBe("2026-08-19T00:00:36.000Z");
    expect(attempt.abandoned_by).toBe("coordinator");
    expect(attempt.abandoned_reason).toBe("lease expired and reclaimed by stale recovery");
    expect(isAttemptOpen(attempt)).toBeFalse();
    // stale-recovery diagnostics used elsewhere (orphan detection, repair replacement) survive.
    expect(attempt.result).toBe("stale");
    expect(attempt.expired_agent_id).toBe("agent-a");
  });

  test("recoverStale closing a reclaimed attempt still lets the next attempt finish", () => {
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent-a", "implementer", { leaseSeconds: 5, clock: start });
    recoverStale(port, "coordinator", at("2026-08-19T00:00:36.000Z"), { graceSeconds: 30 });
    const { token } = claimTask(port, "T-1", "agent-b", "implementer", {
      clock: at("2026-08-19T00:01:00.000Z"),
    });
    registerTaskPacket(port, "implementer", "agent-b", 2);
    const { state } = submitTask(
      port,
      "T-1",
      "agent-b",
      token,
      report,
      at("2026-08-19T00:01:05.000Z"),
    );
    expect(state.tasks["T-1"]!.attempts).toHaveLength(2);
    expect(openAttempts(state.tasks["T-1"]!.attempts)).toHaveLength(0);
  });
});

describe("abandonAttempt", () => {
  test("closes the current attempt with a recorded reason and actor", () => {
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent-a", "implementer", { clock: start });
    const state = abandonAttempt(
      port,
      "T-1",
      "supervisor",
      "duplicate work assigned elsewhere",
      at("2026-08-19T00:05:00.000Z"),
    );
    const attempt = state.tasks["T-1"]!.attempts.at(-1)!;
    expect(attempt.abandoned_at).toBe("2026-08-19T00:05:00.000Z");
    expect(attempt.abandoned_by).toBe("supervisor");
    expect(attempt.abandoned_reason).toBe("duplicate work assigned elsewhere");
    expect(isAttemptOpen(attempt)).toBeFalse();
    expect(state.tasks["T-1"]!.status).toBe("retry_ready");
    expect(state.tasks["T-1"]!.lease).toBeUndefined();
  });

  test("returns a repair attempt to changes_requested", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "changes_requested";
    state.tasks["T-1"]!.repair_assignee = "agent-a";
    const port = new TestPort(state);
    claimTask(port, "T-1", "agent-a", "repairer", { clock: start });
    const result = abandonAttempt(port, "T-1", "supervisor", "stuck repair", start);
    expect(result.tasks["T-1"]!.status).toBe("changes_requested");
  });

  test("requires a non-blank actor and reason", () => {
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent-a", "implementer", { clock: start });
    expect(() => abandonAttempt(port, "T-1", "  ", "reason", start)).toThrow(HarnessError);
    expect(() => abandonAttempt(port, "T-1", "supervisor", "  ", start)).toThrow(HarnessError);
  });

  test("refuses when there is no open attempt to abandon", () => {
    const port = new TestPort(workflowState());
    expect(() => abandonAttempt(port, "T-1", "supervisor", "nothing to abandon", start)).toThrow(
      "no open attempt",
    );
  });

  test("refuses to abandon an attempt twice", () => {
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent-a", "implementer", { clock: start });
    abandonAttempt(port, "T-1", "supervisor", "first reason", start);
    expect(() =>
      abandonAttempt(port, "T-1", "supervisor", "second reason", at("2026-08-19T00:01:00.000Z")),
    ).toThrow("no open attempt");
  });

  test("interrupts open validations and returns a validating task straight to submitted", () => {
    const state = workflowState();
    Object.assign(state.tasks["T-1"]!, {
      status: "validating",
      validations: [
        {
          validator_id: "validator-1",
          domain: "code-quality",
          token_digest: "digest",
          attempt: 1,
          started_at: start.now().toISOString(),
          deadline_at: "2026-08-19T00:05:00.000Z",
        },
      ],
    });
    const port = new TestPort(state);
    const result = abandonAttempt(port, "T-1", "coordinator", "requirement dropped", start);
    const task = result.tasks["T-1"]!;
    expect(task.status).toBe("submitted");
    expect(task.validations).toBeUndefined();
    expect(task.history.at(-1)).toMatchObject({
      from: "validating",
      to: "submitted",
      reason: "validation abandoned: requirement dropped",
    });
  });
});

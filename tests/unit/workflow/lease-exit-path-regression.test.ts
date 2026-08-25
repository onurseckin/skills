import { describe, expect, test } from "bun:test";
import { abandonAttempt } from "../../../olt/scripts/src/workflow/lease/abandon.ts";
import { isAttemptOpen } from "../../../olt/scripts/src/workflow/lease/attempt-state.ts";
import { claimTask } from "../../../olt/scripts/src/workflow/lease/claim.ts";
import { recoverStale } from "../../../olt/scripts/src/workflow/lease/recover-stale.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { at, TestPort, workflowState } from "./test-port.ts";

const start = at("2026-08-19T00:00:00.000Z");

function wedgedRepairTask(overrides: Record<string, unknown> = {}) {
  return {
    status: "leased" as const,
    repair_assignee: "agent-a",
    attempts: [
      {
        attempt: 1,
        agent_id: "agent-a",
        role: "repairer",
        started_at: "2026-08-19T00:00:00.000Z",
        kind: "repair",
      },
    ],
    ...overrides,
  };
}

describe("the trap: a repair attempt with no task.lease", () => {
  test("abandonAttempt closes the attempt but leaves the task wedged at leased", () => {
    const state = workflowState();
    Object.assign(state.tasks["T-1"]!, wedgedRepairTask());
    const port = new TestPort(state);

    const before = port.read().tasks["T-1"]!;
    expect(before.lease).toBeUndefined();
    expect(isAttemptOpen(before.attempts.at(-1)!)).toBeTrue();

    const result = abandonAttempt(
      port,
      "T-1",
      "supervisor",
      "repair attempt has no lease to abandon through",
      start,
    );
    const task = result.tasks["T-1"]!;
    const attempt = task.attempts.at(-1)!;

    expect(attempt.abandoned_at).toBe("2026-08-19T00:00:00.000Z");
    expect(isAttemptOpen(attempt)).toBeFalse();
    expect(task.lease).toBeUndefined();
    expect(task.status).toBe("leased");
    expect(task.history).toHaveLength(0);
  });

  test("the resulting wedge is unrecoverable: claimTask refuses a leased task", () => {
    const state = workflowState();
    Object.assign(state.tasks["T-1"]!, wedgedRepairTask());
    const port = new TestPort(state);

    abandonAttempt(port, "T-1", "supervisor", "spend the open attempt", start);
    expect(port.read().tasks["T-1"]!.status).toBe("leased");

    expect(() => claimTask(port, "T-1", "agent-b", "implementer", { clock: start })).toThrow(
      HarnessError,
    );
    expect(() => claimTask(port, "T-1", "agent-b", "implementer", { clock: start })).toThrow(
      /is not claimable/,
    );
  });

  test("the resulting wedge is unrecoverable: recoverStale has no expires_at to reap", () => {
    const state = workflowState();
    Object.assign(state.tasks["T-1"]!, wedgedRepairTask());
    const port = new TestPort(state);

    abandonAttempt(port, "T-1", "supervisor", "spend the open attempt", start);
    const wedged = port.read().tasks["T-1"]!;
    expect(wedged.lease).toBeUndefined();

    const result = recoverStale(port, "coordinator", at("2026-08-20T00:00:00.000Z"), {
      graceSeconds: 30,
    });
    const task = result.tasks["T-1"]!;
    expect(task.status).toBe("leased");
    expect(task.lease).toBeUndefined();
    expect(task.history).toHaveLength(0);
  });
});

describe("the working path: abandonAttempt with an active lease", () => {
  test("a repair attempt with an active lease routes to changes_requested", () => {
    const state = workflowState();
    Object.assign(state.tasks["T-1"]!, { status: "changes_requested", repair_assignee: "agent-a" });
    const port = new TestPort(state);
    claimTask(port, "T-1", "agent-a", "repairer", { clock: start });

    const leased = port.read().tasks["T-1"]!;
    expect(leased.lease).toBeDefined();
    expect(leased.attempts.at(-1)!.kind).toBe("repair");

    const result = abandonAttempt(
      port,
      "T-1",
      "supervisor",
      "repair abandoned while lease was still held",
      at("2026-08-19T00:05:00.000Z"),
    );
    const task = result.tasks["T-1"]!;
    expect(task.status).toBe("changes_requested");
    expect(task.lease).toBeUndefined();
    expect(isAttemptOpen(task.attempts.at(-1)!)).toBeFalse();
  });

  test("contrast: an implementation attempt with an active lease routes to retry_ready", () => {
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent-a", "implementer", { clock: start });

    const leased = port.read().tasks["T-1"]!;
    expect(leased.attempts.at(-1)!.kind).toBe("implementation");

    const result = abandonAttempt(
      port,
      "T-1",
      "supervisor",
      "implementation abandoned while lease was still held",
      at("2026-08-19T00:05:00.000Z"),
    );
    const task = result.tasks["T-1"]!;
    expect(task.status).toBe("retry_ready");
    expect(task.lease).toBeUndefined();
  });
});

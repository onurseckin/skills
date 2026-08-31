import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import type { MicroCycleRecord } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { recordMicroCycleCritique } from "../../../../olt/scripts/src/workflow/review/micro-cycle.ts";
import { claimTask } from "../../../../olt/scripts/src/workflow/lease/claim.ts";
import { submitTask } from "../../../../olt/scripts/src/workflow/submission/submit.ts";
import { releaseLease } from "../../../../olt/scripts/src/workflow/lease/release.ts";
import { abandonAttempt } from "../../../../olt/scripts/src/workflow/lease/abandon.ts";
import { recoverStale } from "../../../../olt/scripts/src/workflow/lease/recover-stale.ts";
import { isAttemptOpen } from "../../../../olt/scripts/src/workflow/lease/attempt-state.ts";
import { tokenDigest } from "../../../../olt/scripts/src/workflow/lease/token.ts";
import type { TaskRecord, WorkflowState } from "../../../../olt/scripts/src/workflow/types.ts";
import { at, registerTaskPacket, TestPort, workflowState } from "../../shared/test-port.ts";

const claimClock = at("2026-08-22T12:00:00.000Z");
const submitClock = at("2026-08-22T12:05:00.000Z");
const round1Clock = at("2026-08-22T12:10:00.000Z");
const round2Clock = at("2026-08-22T12:15:00.000Z");

const report = {
  summary: "implemented the feature",
  requirement_ids: ["R-1"],
  files_changed: ["src/owned/a.ts"],
  checks: [{ command: "bun test", status: "passed", evidence: "command:C-1" }],
  evidence: [{ kind: "diff", path: "src/owned/a.ts" }],
};

function requireTask(state: WorkflowState, taskId: string): TaskRecord {
  const task = state.tasks[taskId];
  if (!task) {
    throw new Error(`expected task ${taskId} to exist`);
  }
  return task;
}

function submittedPort(): { port: TestPort; implementerToken: string } {
  const port = new TestPort(workflowState());
  const { token } = claimTask(port, "T-1", "worker-1", "implementer", { clock: claimClock });
  registerTaskPacket(port, "implementer", "worker-1", 1);
  submitTask(port, "T-1", "worker-1", token, report, submitClock);
  return { port, implementerToken: token };
}

describe("recordMicroCycleCritique: repair-attempt-and-lease minting on the real defect path", () => {
  test("round 1: a SUBMITTED task (lease already deleted) gets a repair attempt AND a fresh lease, not just a status flip", () => {
    const { port } = submittedPort();
    const before = requireTask(port.read(), "T-1");
    expect(before.status).toBe("submitted");
    expect(before.lease).toBeUndefined();
    expect(before.attempts).toHaveLength(1);
    const initialAttempt = before.attempts[0];
    if (!initialAttempt) {
      throw new Error("expected the original implementation attempt to exist");
    }
    expect(isAttemptOpen(initialAttempt)).toBe(false);

    const result = recordMicroCycleCritique(port, "T-1", "val-1", "Missing null check", {
      remediation: "add the null check",
      defect: "unchecked null dereference",
      clock: round1Clock,
    });

    const task = requireTask(result, "T-1");
    expect(task.status).toBe("leased");
    expect(task.attempts).toHaveLength(2);

    const repairAttempt = task.attempts[1];
    if (!repairAttempt) {
      throw new Error("expected a second attempt to have been appended");
    }
    expect(repairAttempt.attempt).toBe(2);
    expect(repairAttempt.kind).toBe("repair");
    expect(repairAttempt.agent_id).toBe("worker-1");
    expect(repairAttempt.role).toBe("implementer");
    expect(isAttemptOpen(repairAttempt)).toBe(true);

    expect(task.lease).toBeDefined();
    expect(task.lease?.agent_id).toBe("worker-1");
    expect(task.lease?.role).toBe("implementer");
    expect(task.lease?.attempt).toBe(2);
    expect(task.lease?.write_scope).toEqual(before.write_scope);
    expect(task.lease?.micro_cycle_round).toBe(1);
    expect(task.lease?.micro_cycles).toHaveLength(1);

    expect(result.repairToken).toBeDefined();
    const mintedToken = result.repairToken;
    if (mintedToken === undefined) {
      throw new Error("expected recordMicroCycleCritique to mint and return a repair token");
    }
    expect(task.lease?.token_digest).toBe(tokenDigest(mintedToken));
  });

  test("round 1 recovery: task:abandon frees the wedge without needing any token", () => {
    const { port } = submittedPort();
    recordMicroCycleCritique(port, "T-1", "val-1", "Missing null check", { clock: round1Clock });
    const leased = requireTask(port.read(), "T-1");
    expect(leased.status).toBe("leased");
    expect(leased.lease).toBeDefined();

    const afterAbandon = abandonAttempt(
      port,
      "T-1",
      "operator",
      "repairer unresponsive",
      round2Clock,
    );
    const task = requireTask(afterAbandon, "T-1");
    expect(task.status).toBe("changes_requested");
    expect(task.lease).toBeUndefined();
    const closedAttempt = task.attempts[1];
    if (!closedAttempt) {
      throw new Error("expected the repair attempt to still be present after abandon");
    }
    expect(isAttemptOpen(closedAttempt)).toBe(false);
    expect(closedAttempt.abandoned_reason).toBe("repairer unresponsive");
  });

  test("round 1 recovery: stale reclaim reaps an expired repair lease automatically", () => {
    const { port } = submittedPort();
    recordMicroCycleCritique(port, "T-1", "val-1", "Missing null check", {
      clock: round1Clock,
      leaseSeconds: 5,
    });
    const leased = requireTask(port.read(), "T-1");
    expect(leased.lease?.duration_seconds).toBe(5);

    const wayAfterExpiry = at("2026-08-22T12:30:00.000Z");
    const recovered = recoverStale(port, "recovery-bot", wayAfterExpiry, { graceSeconds: 0 });
    const task = requireTask(recovered, "T-1");
    expect(task.status).toBe("changes_requested");
    expect(task.lease).toBeUndefined();
    const closedAttempt = task.attempts[1];
    if (!closedAttempt) {
      throw new Error("expected the repair attempt to still be present after stale recovery");
    }
    expect(isAttemptOpen(closedAttempt)).toBe(false);
    expect(closedAttempt.result).toBe("stale");
  });

  test("round 1 recovery: task:release succeeds when the minted repair token is known", () => {
    const { port } = submittedPort();
    const result = recordMicroCycleCritique(port, "T-1", "val-1", "Missing null check", {
      clock: round1Clock,
    });
    const mintedToken = result.repairToken;
    if (mintedToken === undefined) {
      throw new Error("expected recordMicroCycleCritique to mint and return a repair token");
    }

    const released = releaseLease(port, "T-1", "worker-1", mintedToken, round2Clock);
    const task = requireTask(released, "T-1");
    expect(task.status).toBe("changes_requested");
    expect(task.lease).toBeUndefined();
  });

  test("round 2+: critiquing an already-leased task (minted by round 1) does not double-open a second repair attempt", () => {
    const { port } = submittedPort();
    const round1Result = recordMicroCycleCritique(port, "T-1", "val-1", "Missing null check", {
      clock: round1Clock,
    });
    const round1Task = requireTask(round1Result, "T-1");
    const round1LeaseDigest = round1Task.lease?.token_digest;
    if (round1LeaseDigest === undefined) {
      throw new Error("expected round 1 to mint a lease with a token digest");
    }
    const round1Token = round1Result.repairToken;
    if (round1Token === undefined) {
      throw new Error("expected round 1 to mint a repair token");
    }

    const round2Result = recordMicroCycleCritique(
      port,
      "T-1",
      "val-2",
      "New regression: prohibited nullish coalescing introduced",
      { clock: round2Clock },
    );

    const task = requireTask(round2Result, "T-1");
    expect(task.status).toBe("leased");
    expect(task.attempts).toHaveLength(2);
    expect(task.micro_cycle_round).toBe(2);
    expect(task.micro_cycles).toHaveLength(2);

    const repairAttempt = task.attempts[1];
    if (!repairAttempt) {
      throw new Error("expected the round-1 repair attempt to remain the only repair attempt");
    }
    expect(repairAttempt.attempt).toBe(2);
    expect(isAttemptOpen(repairAttempt)).toBe(true);

    const round2LeaseDigest = task.lease?.token_digest;
    if (round2LeaseDigest === undefined) {
      throw new Error("expected the lease minted at round 1 to still be present at round 2");
    }
    expect(round2LeaseDigest).toBe(round1LeaseDigest);
    expect(task.lease?.micro_cycle_round).toBe(2);
    expect(task.lease?.micro_cycles).toHaveLength(2);
    expect(round2Result.repairToken).toBeUndefined();

    expect(tokenDigest(round1Token)).toBe(round2LeaseDigest);
    const released = releaseLease(port, "T-1", "worker-1", round1Token, round2Clock);
    expect(requireTask(released, "T-1").status).toBe("changes_requested");
  });

  test("round 2+: a validating task with no lease still mints exactly once and stays stable across a second critique", () => {
    const { port } = submittedPort();
    port.transact("val-1", "begin-validation", {}, (draft) => {
      const task = requireTask(draft, "T-1");
      task.status = "validating";
    });

    const round1 = recordMicroCycleCritique(port, "T-1", "val-1", "First pass concern", {
      clock: round1Clock,
    });
    const afterRound1 = requireTask(round1, "T-1");
    expect(afterRound1.status).toBe("leased");
    expect(afterRound1.attempts).toHaveLength(2);
    expect(round1.repairToken).toBeDefined();

    const round2 = recordMicroCycleCritique(port, "T-1", "val-1", "Second pass concern", {
      clock: round2Clock,
    });
    const afterRound2 = requireTask(round2, "T-1");
    expect(afterRound2.attempts).toHaveLength(2);
    expect(afterRound2.micro_cycle_round).toBe(2);
    expect(round2.repairToken).toBeUndefined();
  });

  test("refuses to mint a repair lease for a task with no original_implementer to attribute it to", () => {
    const port = new TestPort(workflowState());
    port.transact("system", "corrupt-state", {}, (draft) => {
      const task = requireTask(draft, "T-1");
      task.status = "submitted";
      task.attempts = [
        {
          attempt: 1,
          agent_id: "worker-1",
          role: "implementer",
          started_at: "2026-08-22T12:00:00.000Z",
        },
      ];
    });

    expect(() =>
      recordMicroCycleCritique(port, "T-1", "val-1", "Cannot attribute this repair", {
        clock: round1Clock,
      }),
    ).toThrow(/has no original_implementer/);
  });

  test("does not regress the already-working path: a genuinely still-leased task keeps syncing its existing lease instead of minting a second one", () => {
    const port = new TestPort(workflowState());
    registerTaskPacket(port, "implementer", "worker-1", 1, "T-1");
    const { token } = claimTask(port, "T-1", "worker-1", "implementer", { clock: claimClock });

    const before = requireTask(port.read(), "T-1");
    const originalDigest = before.lease?.token_digest;

    const result = recordMicroCycleCritique(port, "T-1", "val-1", "Live critique while claimed", {
      clock: round1Clock,
    });

    const task = requireTask(result, "T-1");
    expect(task.attempts).toHaveLength(1);
    expect(task.lease?.token_digest).toBe(originalDigest);
    expect(result.repairToken).toBeUndefined();

    const released = releaseLease(port, "T-1", "worker-1", token, round2Clock);
    expect(requireTask(released, "T-1").status).toBe("retry_ready");
  });
});

import { describe, expect, test } from "bun:test";
import { evidenced } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { claimTask } from "../../../../olt/scripts/src/workflow/lease/claim.ts";
import { heartbeat } from "../../../../olt/scripts/src/workflow/lease/heartbeat.ts";
import { recoverStale } from "../../../../olt/scripts/src/workflow/lease/recover-stale.ts";
import { releaseLease } from "../../../../olt/scripts/src/workflow/lease/release.ts";
import type { Clock } from "../../../../olt/scripts/src/workflow/types.ts";
import { TestPort, workflowState } from "../../shared/test-port.ts";

class FakeClock implements Clock {
  private ms: number;
  public constructor(start: string | Date = "2026-08-13T12:00:00.000Z") {
    this.ms = new Date(start).getTime();
  }
  public now(): Date {
    return new Date(this.ms);
  }
  public tick(deltaMs = 1_000): Date {
    this.ms += deltaMs;
    return this.now();
  }
  public iso(): string {
    return this.now().toISOString();
  }
}

describe("workflow leases", () => {
  test("claims atomically and persists only a token digest", () => {
    const clock = new FakeClock();
    const port = new TestPort(workflowState());
    const first = claimTask(port, "T-1", "agent-a", "implementer", { clock });
    expect(first.token.length).toBeGreaterThan(30);
    const lease = first.state.tasks["T-1"]!.lease!;
    expect(lease.token_digest).not.toBe(first.token);
    expect(first.state.tasks["T-1"]!.original_implementer).toBe("agent-a");
    expect(() => claimTask(port, "T-1", "agent-b", "implementer", { clock })).toThrow();
  });

  test("records the claimed base sha onto the new attempt, not the lease", () => {
    const clock = new FakeClock();
    const port = new TestPort(workflowState());
    const claimedBaseSha = evidenced("deadbeef", "harness_observed");
    const { state } = claimTask(port, "T-1", "agent-a", "implementer", {
      clock,
      claimedBaseSha,
    });
    const attempt = state.tasks["T-1"]!.attempts.at(-1)!;
    expect(attempt.claimed_base_sha).toEqual(claimedBaseSha);
    expect(state.tasks["T-1"]!.lease).not.toHaveProperty("claimed_base_sha");
  });

  test("omitting the claimed base sha leaves the attempt without one", () => {
    const clock = new FakeClock();
    const port = new TestPort(workflowState());
    const { state } = claimTask(port, "T-1", "agent-a", "implementer", { clock });
    expect(state.tasks["T-1"]!.attempts.at(-1)!.claimed_base_sha).toBeUndefined();
  });

  test("requires completed dependencies", () => {
    const clock = new FakeClock();
    const state = workflowState();
    state.tasks["T-2"] = {
      ...structuredClone(state.tasks["T-1"]!),
      id: "T-2",
      dependencies: ["T-1"],
    };
    const port = new TestPort(state);
    expect(() => claimTask(port, "T-2", "agent", "implementer", { clock })).toThrow();
  });

  test("heartbeats verify token and move leased to running", () => {
    const clock = new FakeClock();
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent-a", "implementer", {
      leaseSeconds: 10,
      clock,
    });
    expect(() => heartbeat(port, "T-1", "agent-a", "wrong", clock)).toThrow();
    clock.tick(5_000);
    const state = heartbeat(port, "T-1", "agent-a", token, clock);
    expect(state.tasks["T-1"]!.status).toBe("running");
    expect(state.tasks["T-1"]!.lease!.expires_at).toBe("2026-08-13T12:00:15.000Z");
  });

  test("refuses a heartbeat while the lease clock is suspended for an open branch", () => {
    const clock = new FakeClock();
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent-a", "implementer", {
      leaseSeconds: 10,
      clock,
    });
    port.transact("coordinator", "suspend-for-test", {}, (draft) => {
      draft.tasks["T-1"]!.lease!.suspended_at = clock.iso();
    });
    clock.tick(5_000);
    expect(() => heartbeat(port, "T-1", "agent-a", token, clock)).toThrow(
      /lease clock is suspended while a branch is open/,
    );
  });

  test("stale normal work becomes retry ready", () => {
    const clock = new FakeClock();
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent-a", "implementer", { leaseSeconds: 5, clock });
    clock.tick(36_000);
    const state = recoverStale(port, "coordinator", clock);
    expect(state.tasks["T-1"]!.status).toBe("retry_ready");
    expect(state.tasks["T-1"]!.lease).toBeUndefined();
  });

  test("validates lease duration and identities", () => {
    const clock = new FakeClock();
    const port = new TestPort(workflowState());
    expect(() => claimTask(port, "T-1", "", "implementer", { clock })).toThrow();
    expect(() =>
      claimTask(port, "T-1", "agent", "implementer", { leaseSeconds: 1, clock }),
    ).toThrow();
    expect(() =>
      claimTask(port, "T-1", "agent", "implementer", { leaseSeconds: 4.5, clock }),
    ).toThrow();
  });

  test("claimTask throws when run is already completed", () => {
    const clock = new FakeClock();
    const state = workflowState();
    state.completion_result = {
      status: "complete",
      summary: "all requirements satisfied",
    };
    const port = new TestPort(state);
    expect(() => claimTask(port, "T-1", "agent-a", "implementer", { clock })).toThrow(
      "run is already completed",
    );
  });

  test("claimTask validates role matching task status", () => {
    const clock = new FakeClock();
    const state = workflowState();
    const port = new TestPort(state);
    expect(() => claimTask(port, "T-1", "agent-a", "repairer", { clock })).toThrow(
      "lease role does not match the task state",
    );

    state.tasks["T-1"]!.status = "changes_requested";
    state.tasks["T-1"]!.repair_assignee = "agent-a";
    expect(() => claimTask(port, "T-1", "agent-a", "implementer", { clock })).toThrow(
      "lease role does not match the task state",
    );
  });

  test("claimTask throws when all task requirements are disposed", () => {
    const clock = new FakeClock();
    const state = workflowState();
    state.tasks["T-1"]!.requirement_ids = [];
    const port = new TestPort(state);
    expect(() => claimTask(port, "T-1", "agent-a", "implementer", { clock })).toThrow(
      "task requirements are disposed",
    );
  });

  test("heartbeat and releaseLease throw when lease has expired", () => {
    const clock = new FakeClock();
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent-a", "implementer", {
      leaseSeconds: 10,
      clock,
    });

    clock.tick(20_000);
    expect(() => heartbeat(port, "T-1", "agent-a", token, clock)).toThrow("lease has expired");
    expect(() => releaseLease(port, "T-1", "agent-a", token, clock)).toThrow("lease has expired");
  });

  test("claimTask propagates resource_scope and writeScopeContentHash onto lease", () => {
    const clock = new FakeClock();
    const state = workflowState();
    state.tasks["T-1"]!.resource_scope = ["db:users"];
    const port = new TestPort(state);
    const writeScopeContentHash = { algorithm: "sha256" as const, value: "hash-value" };
    const { state: updated } = claimTask(port, "T-1", "agent-a", "implementer", {
      clock,
      writeScopeContentHash,
    });

    const lease = updated.tasks["T-1"]!.lease!;
    expect(lease.resource_scope).toEqual(["db:users"]);
    expect(lease.write_scope_content_hash).toEqual(writeScopeContentHash);
  });

  test("releaseLease handles repair attempts and invalid task statuses", () => {
    const clock = new FakeClock();
    const state = workflowState();
    state.tasks["T-1"]!.status = "changes_requested";
    state.tasks["T-1"]!.repair_assignee = "agent-a";
    const port = new TestPort(state);

    const { token } = claimTask(port, "T-1", "agent-a", "repairer", { clock });
    expect(port.read().tasks["T-1"]!.status).toBe("leased");

    const releasedState = releaseLease(port, "T-1", "agent-a", token, clock);
    expect(releasedState.tasks["T-1"]!.status).toBe("changes_requested");
    expect(releasedState.tasks["T-1"]!.lease).toBeUndefined();

    const { token: t2 } = claimTask(port, "T-1", "agent-a", "repairer", { clock });
    port.transact("test", "modify-status", {}, (draft) => {
      draft.tasks["T-1"]!.status = "done";
    });
    expect(() => releaseLease(port, "T-1", "agent-a", t2, clock)).toThrow(
      "task does not hold a releasable lease",
    );
  });
});

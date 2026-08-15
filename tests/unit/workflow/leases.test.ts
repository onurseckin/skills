import { describe, expect, test } from "bun:test";
import { claimTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/claim.ts";
import { heartbeat } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/heartbeat.ts";
import { recoverStale } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/recover-stale.ts";
import { at, TestPort, workflowState } from "./test-port.ts";

const start = at("2026-08-13T12:00:00.000Z");

describe("workflow leases", () => {
  test("claims atomically and persists only a token digest", () => {
    const port = new TestPort(workflowState());
    const first = claimTask(port, "T-1", "agent-a", "implementer", { clock: start });
    expect(first.token.length).toBeGreaterThan(30);
    const lease = first.state.tasks["T-1"]!.lease!;
    expect(lease.token_digest).not.toBe(first.token);
    expect(first.state.tasks["T-1"]!.original_implementer).toBe("agent-a");
    expect(() => claimTask(port, "T-1", "agent-b", "implementer", { clock: start })).toThrow();
  });

  test("requires completed dependencies", () => {
    const state = workflowState();
    state.tasks["T-2"] = {
      ...structuredClone(state.tasks["T-1"]!),
      id: "T-2",
      dependencies: ["T-1"],
    };
    const port = new TestPort(state);
    expect(() => claimTask(port, "T-2", "agent", "implementer", { clock: start })).toThrow();
  });

  test("heartbeats verify token and move leased to running", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent-a", "implementer", {
      leaseSeconds: 10,
      clock: start,
    });
    expect(() => heartbeat(port, "T-1", "agent-a", "wrong", start)).toThrow();
    const state = heartbeat(port, "T-1", "agent-a", token, at("2026-08-13T12:00:05.000Z"));
    expect(state.tasks["T-1"]!.status).toBe("running");
    expect(state.tasks["T-1"]!.lease!.expires_at).toBe("2026-08-13T12:00:15.000Z");
  });

  test("stale normal work becomes retry ready", () => {
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent-a", "implementer", { leaseSeconds: 5, clock: start });
    const state = recoverStale(port, "coordinator", at("2026-08-13T12:00:36.000Z"));
    expect(state.tasks["T-1"]!.status).toBe("retry_ready");
    expect(state.tasks["T-1"]!.lease).toBeUndefined();
  });

  test("validates lease duration and identities", () => {
    const port = new TestPort(workflowState());
    expect(() => claimTask(port, "T-1", "", "implementer", { clock: start })).toThrow();
    expect(() =>
      claimTask(port, "T-1", "agent", "implementer", { leaseSeconds: 1, clock: start }),
    ).toThrow();
    expect(() =>
      claimTask(port, "T-1", "agent", "implementer", { leaseSeconds: true as never, clock: start }),
    ).toThrow();
  });
});

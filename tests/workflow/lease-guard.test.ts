import { describe, expect, test } from "bun:test";
import {
  checkActiveLease,
  assertActiveLease,
  verifyLeaseGuard,
} from "../../olt/scripts/src/workflow/lease/guard.ts";
import { claimTask } from "../../olt/scripts/src/workflow/lease/claim.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import type { Clock } from "../../olt/scripts/src/workflow/types.ts";
import { at, TestPort, workflowState } from "./test-port.ts";

const start = at("2026-08-19T00:00:00.000Z");
const afterExpiry = at("2026-08-19T01:00:00.000Z");

describe("lease-guard", () => {
  test("returns valid: false when task is not in state", () => {
    const state = workflowState();
    const result = checkActiveLease(state, "T-nonexistent");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain(
      "LEASE_REQUIRED: task T-nonexistent not found in capsule state",
    );
    expect(result.taskId).toBe("T-nonexistent");
  });

  test("returns valid: false when task has no active lease", () => {
    const state = workflowState();
    const result = checkActiveLease(state, "T-1");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain(
      "LEASE_REQUIRED: task T-1 has no active lease in capsule state",
    );
    expect(result.taskId).toBe("T-1");
  });

  test("returns valid: true for correctly claimed active lease", () => {
    const port = new TestPort(workflowState());
    const { state, token } = claimTask(port, "T-1", "agent-a", "implementer", { clock: start });
    const result = checkActiveLease(state, "T-1", "agent-a", token, { clock: start });

    expect(result.valid).toBe(true);
    expect(result.taskId).toBe("T-1");
    expect(result.agentId).toBe("agent-a");
    expect(result.expiresAt).toBeDefined();
  });

  test("returns valid: false when agentId does not match lease holder", () => {
    const port = new TestPort(workflowState());
    const { state, token } = claimTask(port, "T-1", "agent-a", "implementer", { clock: start });
    const result = checkActiveLease(state, "T-1", "agent-b", token, { clock: start });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("LEASE_REQUIRED: task T-1 lease held by agent-a, not agent-b");
    expect(result.agentId).toBe("agent-a");
  });

  test("returns valid: false when token digest does not match", () => {
    const port = new TestPort(workflowState());
    const { state } = claimTask(port, "T-1", "agent-a", "implementer", { clock: start });
    const result = checkActiveLease(state, "T-1", "agent-a", "invalid-token-value", {
      clock: start,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("LEASE_REQUIRED: task T-1 lease token mismatch");
  });

  test("returns valid: false when lease has expired and allowExpired is false", () => {
    const port = new TestPort(workflowState());
    const { state, token } = claimTask(port, "T-1", "agent-a", "implementer", {
      leaseSeconds: 60,
      clock: start,
    });
    const result = checkActiveLease(state, "T-1", "agent-a", token, { clock: afterExpiry });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("LEASE_REQUIRED: task T-1 lease expired at");
  });

  test("returns valid: true when lease is expired but allowExpired is true", () => {
    const port = new TestPort(workflowState());
    const { state, token } = claimTask(port, "T-1", "agent-a", "implementer", {
      leaseSeconds: 60,
      clock: start,
    });
    const result = checkActiveLease(state, "T-1", "agent-a", token, {
      clock: afterExpiry,
      allowExpired: true,
    });

    expect(result.valid).toBe(true);
    expect(result.taskId).toBe("T-1");
    expect(result.agentId).toBe("agent-a");
  });

  test("assertActiveLease throws HarnessError with INVALID_STATE on invalid lease", () => {
    const state = workflowState();
    expect(() => {
      assertActiveLease(state, "T-1");
    }).toThrow(HarnessError);
  });

  test("assertActiveLease passes silently on valid lease", () => {
    const port = new TestPort(workflowState());
    const { state, token } = claimTask(port, "T-1", "agent-a", "implementer", { clock: start });
    expect(() => {
      assertActiveLease(state, "T-1", "agent-a", token, { clock: start });
    }).not.toThrow();
  });

  test("verifyLeaseGuard accepts WorkflowState object directly", () => {
    const port = new TestPort(workflowState());
    const { state, token } = claimTask(port, "T-1", "agent-a", "implementer", { clock: start });
    const res = verifyLeaseGuard(state, "T-1", "agent-a", token, { clock: start });
    expect(res.valid).toBe(true);
  });
});

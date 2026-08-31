import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkActiveLease,
  assertActiveLease,
  verifyLeaseGuard,
  verifyDiskCapsuleLease,
} from "../../../olt/scripts/src/workflow/lease/guard.ts";
import { claimTask } from "../../../olt/scripts/src/workflow/lease/claim.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { at, TestPort, workflowState } from "../test-port.ts";
import { scratchRoot } from "../../shared/scratch-root.ts";

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

describe("verifyDiskCapsuleLease", () => {
  test("returns invalid when capsule state does not exist on disk", () => {
    const res = verifyDiskCapsuleLease("non-existent-run-id", "task-1");
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("LEASE_REQUIRED: capsule state not found on disk");
  });

  test("returns invalid when state file contains corrupt JSON", () => {
    const scratch = scratchRoot(import.meta.path, "corrupt-capsule-test");
    mkdirSync(scratch, { recursive: true });
    writeFileSync(join(scratch, "state.json"), "{ invalid json", "utf8");

    const res = verifyDiskCapsuleLease(scratch, "task-1");
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("failed to read capsule state");
    rmSync(scratch, { recursive: true, force: true });
  });

  test("verifies active on-disk lease correctly from capsule path", () => {
    const scratch = scratchRoot(import.meta.path, "valid-capsule-test");
    mkdirSync(scratch, { recursive: true });
    const port = new TestPort(workflowState());
    const { state, token } = claimTask(port, "T-1", "worker-1", "implementer", { clock: start });
    writeFileSync(join(scratch, "state.json"), JSON.stringify(state, null, 2), "utf8");

    const res = verifyDiskCapsuleLease(scratch, "T-1", "worker-1", token, { clock: start });
    expect(res.valid).toBe(true);
    expect(res.agentId).toBe("worker-1");
    expect(res.taskId).toBe("T-1");

    const resWrongAgent = verifyDiskCapsuleLease(scratch, "T-1", "worker-2", token, {
      clock: start,
    });
    expect(resWrongAgent.valid).toBe(false);
    expect(resWrongAgent.reason).toContain("lease held by worker-1, not worker-2");

    rmSync(scratch, { recursive: true, force: true });
  });

  test("rejects when on-disk capsule task has no active lease", () => {
    const scratch = scratchRoot(import.meta.path, "unleased-capsule-test");
    mkdirSync(scratch, { recursive: true });
    const state = workflowState();
    writeFileSync(join(scratch, "state.json"), JSON.stringify(state, null, 2), "utf8");

    const res = verifyDiskCapsuleLease(scratch, "T-1");
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("LEASE_REQUIRED: task T-1 has no active lease in capsule state");

    rmSync(scratch, { recursive: true, force: true });
  });

  test("rejects when on-disk capsule lease has expired", () => {
    const scratch = scratchRoot(import.meta.path, "expired-capsule-test");
    mkdirSync(scratch, { recursive: true });
    const port = new TestPort(workflowState());
    const { state, token } = claimTask(port, "T-1", "worker-1", "implementer", {
      leaseSeconds: 60,
      clock: start,
    });
    writeFileSync(join(scratch, "state.json"), JSON.stringify(state, null, 2), "utf8");

    const res = verifyDiskCapsuleLease(scratch, "T-1", "worker-1", token, {
      clock: afterExpiry,
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("LEASE_REQUIRED: task T-1 lease expired at");

    rmSync(scratch, { recursive: true, force: true });
  });
});

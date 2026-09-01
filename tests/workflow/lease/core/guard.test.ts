import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkActiveLease,
  assertActiveLease,
  verifyLeaseGuard,
  verifyDiskCapsuleLease,
} from "../../../../olt/scripts/src/workflow/lease/guard.ts";
import { claimTask } from "../../../../olt/scripts/src/workflow/lease/claim.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { at, TestPort, workflowState } from "../../shared/test-port.ts";
import { setupWorkflowVirtualFs } from "../../shared/index.ts";

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
    const { state, token } = claimTask(port, "T-1", "agent-1", "implementer", { clock: start });
    const result = checkActiveLease(state, "T-1", "agent-1", token, { clock: start });
    expect(result.valid).toBe(true);
    expect(result.agentId).toBe("agent-1");
    expect(result.taskId).toBe("T-1");
  });

  test("returns valid: false when lease is held by a different agent", () => {
    const port = new TestPort(workflowState());
    const { state, token } = claimTask(port, "T-1", "agent-1", "implementer", { clock: start });
    const result = checkActiveLease(state, "T-1", "agent-2", token, { clock: start });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("LEASE_REQUIRED: task T-1 lease held by agent-1, not agent-2");
  });

  test("returns valid: false when token digest does not match", () => {
    const port = new TestPort(workflowState());
    const { state } = claimTask(port, "T-1", "agent-1", "implementer", { clock: start });
    const result = checkActiveLease(state, "T-1", "agent-1", "wrong-token", { clock: start });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("LEASE_REQUIRED: task T-1 lease token mismatch");
  });

  test("returns valid: false when lease has expired", () => {
    const port = new TestPort(workflowState());
    const { state, token } = claimTask(port, "T-1", "agent-1", "implementer", {
      leaseSeconds: 60,
      clock: start,
    });
    const result = checkActiveLease(state, "T-1", "agent-1", token, { clock: afterExpiry });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("LEASE_REQUIRED: task T-1 lease expired at");
  });

  test("accepts matching lease without verifying token when token is omitted", () => {
    const port = new TestPort(workflowState());
    const { state } = claimTask(port, "T-1", "agent-1", "implementer", { clock: start });
    const result = checkActiveLease(state, "T-1", "agent-1", undefined, { clock: start });
    expect(result.valid).toBe(true);
  });
});

describe("assertActiveLease", () => {
  test("throws HarnessError on invalid lease", () => {
    const state = workflowState();
    expect(() => assertActiveLease(state, "T-1")).toThrow(HarnessError);
    try {
      assertActiveLease(state, "T-1");
    } catch (err) {
      expect((err as HarnessError).code).toBe("INVALID_STATE");
    }
  });

  test("does not throw on valid lease", () => {
    const port = new TestPort(workflowState());
    const { state, token } = claimTask(port, "T-1", "agent-1", "implementer", { clock: start });
    expect(() => assertActiveLease(state, "T-1", "agent-1", token, { clock: start })).not.toThrow();
  });
});

describe("verifyLeaseGuard", () => {
  test("returns correct valid boolean on valid lease", () => {
    const port = new TestPort(workflowState());
    const { state, token } = claimTask(port, "T-1", "agent-1", "implementer", { clock: start });
    const result = verifyLeaseGuard(state, "T-1", "agent-1", token, { clock: start });
    expect(result.valid).toBe(true);
    expect(result.agentId).toBe("agent-1");
    expect(result.taskId).toBe("T-1");
    expect(result.expiresAt).toBeDefined();
  });

  test("returns invalid status and failure reason on invalid lease", () => {
    const state = workflowState();
    const result = verifyLeaseGuard(state, "T-1");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain(
      "LEASE_REQUIRED: task T-1 has no active lease in capsule state",
    );
    expect(result.taskId).toBe("T-1");
  });
});

describe("verifyDiskCapsuleLease", () => {
  let vfsCleanup: (() => void) | undefined;
  let sc = 0;

  beforeEach(() => {
    const setup = setupWorkflowVirtualFs();
    vfsCleanup = setup.cleanup;
  });

  afterEach(() => {
    vfsCleanup?.();
    vfsCleanup = undefined;
  });

  test("returns invalid when capsule state does not exist on disk", () => {
    const res = verifyDiskCapsuleLease("/virtual/tmp/non-existent-run-id", "task-1");
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("LEASE_REQUIRED: capsule state not found on disk");
  });

  test("returns invalid when state file contains corrupt JSON", () => {
    const scratch = `/virtual/tmp/capsule-${++sc}`;
    mkdirSync(scratch, { recursive: true });
    writeFileSync(join(scratch, "state.json"), "{ invalid json", "utf8");

    const res = verifyDiskCapsuleLease(scratch, "task-1");
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("failed to read capsule state");
  });

  test("verifies active on-disk lease correctly from capsule path", () => {
    const scratch = `/virtual/tmp/capsule-${++sc}`;
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
  });

  test("rejects when on-disk capsule task has no active lease", () => {
    const scratch = `/virtual/tmp/capsule-${++sc}`;
    mkdirSync(scratch, { recursive: true });
    const state = workflowState();
    writeFileSync(join(scratch, "state.json"), JSON.stringify(state, null, 2), "utf8");

    const res = verifyDiskCapsuleLease(scratch, "T-1");
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("LEASE_REQUIRED: task T-1 has no active lease in capsule state");
  });

  test("rejects when on-disk capsule lease has expired", () => {
    const scratch = `/virtual/tmp/capsule-${++sc}`;
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
  });
});

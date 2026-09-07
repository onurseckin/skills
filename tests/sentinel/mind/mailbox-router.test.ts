import { beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  clearInMemoryDispatches,
  dispatchSentinelInterjection,
  generateRoutingJourney,
  getInMemoryDispatches,
  setInMemoryRouterMode,
  type SentinelViolation,
} from "../../../olt/scripts/src/sentinel/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("sentinel:mailbox-router POSIX flock interjection delivery", () => {
  const dummyViolation: SentinelViolation = {
    code: "MISSING_FILE_SCOPED_TEST_RUN",
    severity: "CRITICAL",
    message: "Missing test run",
    remediation_cmd: "bun test",
  };

  beforeEach(() => {
    setInMemoryRouterMode(true);
    clearInMemoryDispatches();
  });

  test("generateRoutingJourney calculates deterministic SHA256 header", () => {
    const journey1 = generateRoutingJourney({
      originSentinel: "sentinel:impl_01",
      originRole: "implementer",
      ruleCode: "MISSING_FILE_SCOPED_TEST_RUN",
      targetAgent: "impl_01",
      targetRole: "implementer",
      parentSupervisor: "coord_01",
      currentStrike: 1,
      escalated: false,
      timestamp: 1757155600,
    });

    const journey2 = generateRoutingJourney({
      originSentinel: "sentinel:impl_01",
      originRole: "implementer",
      ruleCode: "MISSING_FILE_SCOPED_TEST_RUN",
      targetAgent: "impl_01",
      targetRole: "implementer",
      parentSupervisor: "coord_01",
      currentStrike: 1,
      escalated: false,
      timestamp: 1757155600,
    });

    expect(journey1.sha256).toBe(journey2.sha256);
    expect(journey1.sha256).toHaveLength(64);
    expect(journey1.escalated).toBe(false);
  });

  test("Zero-Cross-Tier Routing: Strike 1 delivers strictly to target agent", () => {
    const dispatch = dispatchSentinelInterjection({
      originSentinel: "sentinel:impl_01",
      originRole: "implementer",
      targetAgent: "impl_01",
      targetRole: "implementer",
      parentSupervisor: "coord_01",
      currentStrike: 1,
      violations: [dummyViolation],
      markdownBrief: "Remediation brief",
    });

    expect(dispatch.deliveredTo).toBe("impl_01");
    expect(dispatch.routingJourney.escalated).toBe(false);
    expect(dispatch.routingJourney.target_agent).toBe("impl_01");
  });

  test("Zero-Cross-Tier Routing: Strike 2 delivers strictly to target agent", () => {
    const dispatch = dispatchSentinelInterjection({
      originSentinel: "sentinel:impl_01",
      originRole: "implementer",
      targetAgent: "impl_01",
      targetRole: "implementer",
      parentSupervisor: "coord_01",
      currentStrike: 2,
      violations: [dummyViolation],
      markdownBrief: "Block brief",
    });

    expect(dispatch.deliveredTo).toBe("impl_01");
    expect(dispatch.routingJourney.escalated).toBe(false);
  });

  test("Strike 3 Escalation: Routes to parent supervisor mailbox ONLY", () => {
    const dispatch = dispatchSentinelInterjection({
      originSentinel: "sentinel:impl_01",
      originRole: "implementer",
      targetAgent: "impl_01",
      targetRole: "implementer",
      parentSupervisor: "coord_01",
      currentStrike: 3,
      violations: [dummyViolation],
      markdownBrief: "Escalation brief",
    });

    expect(dispatch.deliveredTo).toBe("coord_01");
    expect(dispatch.routingJourney.escalated).toBe(true);
    expect(dispatch.routingJourney.target_agent).toBe("impl_01");
    expect(dispatch.routingJourney.parent_supervisor).toBe("coord_01");
  });

  test("delivers mailbox message in VFS under .olt/mailboxes with POSIX flock", () => {
    setInMemoryRouterMode(false);
    const vfs = new VirtualMemoryFS();
    const session = createVirtualFSSession(vfs);
    const testDir = "/testing/sentinel/scratch/test_mailbox_router";
    vfs.mkdirSync(testDir, { recursive: true });

    try {
      const dispatch = dispatchSentinelInterjection({
        originSentinel: "sentinel:worker_test",
        originRole: "implementer",
        targetAgent: "worker_test",
        targetRole: "implementer",
        currentStrike: 1,
        violations: [dummyViolation],
        markdownBrief: "Disk brief",
        repoRoot: testDir,
      });

      expect(dispatch.deliveredTo).toBe("worker_test");
      expect(vfs.existsSync(dispatch.mailboxPath)).toBe(true);

      const content = vfs.readFileSync(dispatch.mailboxPath, "utf-8");
      expect(content).toContain("worker_test");
      expect(content).toContain("hmac_signature");
    } finally {
      session.cleanup();
      setInMemoryRouterMode(true);
    }
  });

  test("delivers sequential multi-messages in exact chronological order", () => {
    setInMemoryRouterMode(false);
    const vfs = new VirtualMemoryFS();
    const session = createVirtualFSSession(vfs);
    const testDir = "/testing/sentinel/scratch/test_mailbox_sequential";
    vfs.mkdirSync(testDir, { recursive: true });

    try {
      const d1 = dispatchSentinelInterjection({
        originSentinel: "sentinel:worker_seq",
        originRole: "implementer",
        targetAgent: "worker_seq",
        targetRole: "implementer",
        currentStrike: 1,
        violations: [dummyViolation],
        markdownBrief: "Strike 1 brief",
        repoRoot: testDir,
      });

      const d2 = dispatchSentinelInterjection({
        originSentinel: "sentinel:worker_seq",
        originRole: "implementer",
        targetAgent: "worker_seq",
        targetRole: "implementer",
        currentStrike: 2,
        violations: [dummyViolation],
        markdownBrief: "Strike 2 brief",
        repoRoot: testDir,
      });

      expect(d1.mailboxPath).toBe(d2.mailboxPath);
      const raw = vfs.readFileSync(d1.mailboxPath, "utf-8");
      const lines = raw.trim().split("\n");
      expect(lines.length).toBe(2);

      const line0 = lines[0];
      const line1 = lines[1];
      if (!line0) throw new Error("Expected line 0");
      if (!line1) throw new Error("Expected line 1");
      const env1 = JSON.parse(line0) as { sequence: number; payload: { strike_count: number } };
      const env2 = JSON.parse(line1) as { sequence: number; payload: { strike_count: number } };

      expect(env1.payload.strike_count).toBe(1);
      expect(env2.payload.strike_count).toBe(2);
    } finally {
      session.cleanup();
      setInMemoryRouterMode(true);
    }
  });

  test("routes Strike 3 escalation to default coordinator_core when supervisor is undefined", () => {
    const dispatch = dispatchSentinelInterjection({
      originSentinel: "sentinel:worker_orphan",
      originRole: "implementer",
      targetAgent: "worker_orphan",
      targetRole: "implementer",
      currentStrike: 3,
      violations: [dummyViolation],
      markdownBrief: "Fallback escalation",
    });

    expect(dispatch.deliveredTo).toBe("coordinator_core");
    expect(dispatch.routingJourney.escalated).toBe(true);
  });

  test("generates unique SHA256 digests on altered routing journey parameters", () => {
    const base = {
      originSentinel: "sentinel:impl_01",
      originRole: "implementer" as const,
      ruleCode: "MISSING_FILE_SCOPED_TEST_RUN",
      targetAgent: "impl_01",
      targetRole: "implementer" as const,
      parentSupervisor: "coord_01",
      currentStrike: 1,
      escalated: false,
      timestamp: 1757155600,
    };

    const jBase = generateRoutingJourney(base);
    const jDiffTime = generateRoutingJourney({ ...base, timestamp: 1757155699 });
    const jDiffRule = generateRoutingJourney({ ...base, ruleCode: "OTHER_RULE" });
    const jDiffStrike = generateRoutingJourney({ ...base, currentStrike: 2 });

    expect(jBase.sha256).not.toBe(jDiffTime.sha256);
    expect(jBase.sha256).not.toBe(jDiffRule.sha256);
    expect(jBase.sha256).not.toBe(jDiffStrike.sha256);
  });
});

import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  clearInMemoryDispatches,
  dispatchSentinelInterjection,
  generateRoutingJourney,
  getInMemoryDispatches,
  setInMemoryRouterMode,
  type SentinelViolation,
} from "../../olt/scripts/src/sentinel/index.ts";

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

  test("delivers real mailbox message to disk under .olt/mailboxes with POSIX flock", () => {
    setInMemoryRouterMode(false);
    const testDir = join(process.cwd(), ".olt", "scratch", "test_mailbox_router");
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

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
      expect(existsSync(dispatch.mailboxPath)).toBe(true);

      const content = readFileSync(dispatch.mailboxPath, "utf-8");
      expect(content).toContain("worker_test");
      expect(content).toContain("hmac_signature");
    } finally {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    }
  });
});

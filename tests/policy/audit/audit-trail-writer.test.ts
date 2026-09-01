import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { AuditTrailWriter } from "../../../olt/scripts/src/policy/audit/audit-trail-writer.ts";
import { verifyAuditTrailChain } from "../../../olt/scripts/src/policy/audit/hasher.ts";
import type { AuditEvent } from "../../../olt/scripts/src/policy/audit/types.ts";
import { cleanupVirtualPolicyFS, getVirtualPolicyFS, setupVirtualPolicyFS } from "../fixture.ts";

describe("AuditTrailWriter", () => {
  let tempDir: string;
  let logFile: string;

  beforeEach(() => {
    setupVirtualPolicyFS();
    tempDir = "/virtual/policy/audit";
    logFile = join(tempDir, "audit.jsonl");
    getVirtualPolicyFS().mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualPolicyFS();
  });

  it("records in-memory events with sequence numbers and cryptographic hashes", () => {
    const writer = new AuditTrailWriter();

    const event1 = writer.record({
      category: "rbac",
      action: "exec_test",
      actor: { id: "agent-1", role: "implementer" },
      severity: "info",
      outcome: "allowed",
      details: { command: "bun test" },
    });

    const event2 = writer.record({
      category: "worktree",
      action: "create_branch",
      actor: { id: "agent-1", role: "implementer" },
      severity: "warning",
      outcome: "flagged",
      details: { branch: "invalid" },
    });

    expect(event1.sequenceNumber).toBe(1);
    expect(event1.previousHash).toBeUndefined();
    expect(event1.hash).toBeDefined();

    expect(event2.sequenceNumber).toBe(2);
    expect(event2.previousHash).toBe(event1.hash);
    expect(event2.hash).toBeDefined();

    const check = writer.verifyIntegrity();
    expect(check.valid).toBe(true);
    expect(check.totalEventsChecked).toBe(2);
  });

  it("persists to file and reloads existing logs upon initialization", () => {
    const writer1 = new AuditTrailWriter({
      logFilePath: logFile,
      enableFilePersistence: true,
    });

    writer1.record({
      category: "commit",
      action: "enforce_commit",
      actor: { id: "agent-2", role: "implementer" },
      severity: "info",
      outcome: "allowed",
      details: { message: "feat(core): update engine" },
    });

    writer1.record({
      category: "drift",
      action: "drift_check",
      actor: { id: "mind", role: "mind_supervisor" },
      severity: "info",
      outcome: "allowed",
      details: { checksum: "abc123" },
    });

    expect(getVirtualPolicyFS().existsSync(logFile)).toBe(true);

    const writer2 = new AuditTrailWriter({
      logFilePath: logFile,
      enableFilePersistence: true,
    });

    expect(writer2.getEventCount()).toBe(2);
    const events = writer2.getEvents();
    expect(events[0]?.action).toBe("enforce_commit");
    expect(events[1]?.action).toBe("drift_check");

    const integrity = writer2.verifyIntegrity();
    expect(integrity.valid).toBe(true);
    expect(integrity.totalEventsChecked).toBe(2);
  });

  it("supports querying and filtering audit records", () => {
    const writer = new AuditTrailWriter();

    writer.record({
      category: "rbac",
      action: "exec_1",
      actor: { id: "agent-1", role: "implementer" },
      severity: "info",
      outcome: "allowed",
      details: {},
    });

    writer.record({
      category: "rbac",
      action: "exec_2",
      actor: { id: "agent-2", role: "validator" },
      severity: "high",
      outcome: "denied",
      details: {},
    });

    writer.record({
      category: "planning",
      action: "plan_check",
      actor: { id: "agent-1", role: "implementer" },
      severity: "info",
      outcome: "allowed",
      details: {},
    });

    const rbacEvents = writer.query({ category: "rbac" });
    expect(rbacEvents.length).toBe(2);

    const deniedEvents = writer.query({ outcome: "denied" });
    expect(deniedEvents.length).toBe(1);
    expect(deniedEvents[0]?.actor.id).toBe("agent-2");

    const agent1Events = writer.query({ actorId: "agent-1" });
    expect(agent1Events.length).toBe(2);

    const limitedEvents = writer.query({ limit: 1, offset: 1 });
    expect(limitedEvents.length).toBe(1);
    expect(limitedEvents[0]?.action).toBe("exec_2");
  });

  it("detects tampered audit chain records", () => {
    const writer = new AuditTrailWriter();

    const ev1 = writer.record({
      category: "rbac",
      action: "exec_1",
      actor: { id: "agent-1" },
      severity: "info",
      outcome: "allowed",
      details: {},
    });

    const ev2 = writer.record({
      category: "rbac",
      action: "exec_2",
      actor: { id: "agent-1" },
      severity: "info",
      outcome: "allowed",
      details: {},
    });

    const tamperedEv1: AuditEvent = {
      ...ev1,
      outcome: "denied",
    };

    const check = verifyAuditTrailChain([tamperedEv1, ev2]);
    expect(check.valid).toBe(false);
    expect(check.brokenAtIndex).toBe(0);
    expect(check.error).toContain("Payload tamper detected");
  });
});

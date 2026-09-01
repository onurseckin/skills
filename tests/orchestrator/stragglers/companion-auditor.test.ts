import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import {
  pairCompanionAuditor,
  pairMindCompanionAuditor,
  pairAllMandatoryCompanionAuditors,
  verifyCompanionAuditorsHealth,
  assertCompanionAuditorsHealth,
} from "../../../olt/scripts/src/orchestrator/companion-auditor.ts";
import { checkCompanionAuditorsDoctor } from "../../../olt/scripts/src/reporting/doctor/rules/companion-auditors.ts";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("OrchestratorCompanionAuditor Unit Tests - Pairing & Health", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | undefined;
  const testRoot = "/virtual/skills-companion-auditor-unit";

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(testRoot, { recursive: true });
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = undefined;
    }
  });

  test("pairCompanion — automatically provisions companion auditor when not present", () => {
    const res = pairCompanionAuditor(testRoot);
    expect(res.paired).toBe(true);
    expect(res.autoProvisioned).toBe(true);
    expect(res.companionAgentId).toBe("skill-auditor-auto");
  });

  test("pairCompanion — recognizes explicitly granted skill-auditor agent", () => {
    const activeAgents: readonly AgentGrantRecord[] = [
      {
        id: "auditor-1",
        role: "meta-auditor",
        status: "active",
        host: "antigravity",
        granted_at: new Date().toISOString(),
        parent_agent_id: null,
        parent_task_id: null,
      },
    ];
    const res = pairCompanionAuditor(testRoot, { activeAgents });
    expect(res.paired).toBe(true);
    expect(res.autoProvisioned).toBe(false);
  });

  test("pairCompanion — respects custom options for companionAgentId and now timestamp", () => {
    const customTimestamp = "2026-08-24T18:00:00.000Z";
    const res = pairCompanionAuditor(testRoot, {
      companionAgentId: "custom-auditor-id",
      now: customTimestamp,
    });
    expect(res.paired).toBe(true);
    expect(res.autoProvisioned).toBe(true);
    expect(res.companionAgentId).toBe("custom-auditor-id");
    expect(res.pairedAt).toBe(customTimestamp);
  });

  test("pairMindCompanion and pairAllMandatoryCompanions provision mind and skill auditors", () => {
    const mindRes = pairMindCompanionAuditor(testRoot);
    expect(mindRes.paired).toBe(true);
    expect(mindRes.companionAgentId).toBe("mind-auditor-auto");

    const allRes = pairAllMandatoryCompanionAuditors(testRoot);
    expect(allRes.allPaired).toBe(true);
    expect(allRes.mindAuditor.paired).toBe(true);
    expect(allRes.skillAuditor.paired).toBe(true);
  });

  test("verifyCompanionAuditorsHealth verifies active agent presence and detects missing auditors", () => {
    const health = verifyCompanionAuditorsHealth(testRoot, []);
    expect(health.healthy).toBe(false);
    expect(health.issues.length).toBeGreaterThan(0);
    expect(() => assertCompanionAuditorsHealth(testRoot, [])).toThrow();
  });

  test("checkCompanionAuditorsDoctor detects missing companion auditors under doctor rules", () => {
    const docResult = checkCompanionAuditorsDoctor({ repoRoot: testRoot, grants: [] });
    expect(docResult.passed).toBe(false);
    expect(docResult.findings.some((f) => f.code === "MISSING_MIND_AUDITOR")).toBe(true);
    expect(docResult.findings.some((f) => f.code === "MISSING_SKILL_AUDITOR")).toBe(true);
  });

  test("clean up test directory", () => {
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
    expect(fs.existsSync(testRoot)).toBe(false);
  });
});

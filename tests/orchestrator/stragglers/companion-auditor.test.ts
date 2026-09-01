import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
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

describe("OrchestratorCompanionAuditor Unit Tests - Pairing & Health", () => {
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];
  const testRoot = "/virtual/skills-companion-auditor-unit";

  const origExists = fs.existsSync.bind(fs);
  const origRead = fs.readFileSync.bind(fs);
  const isVirt = (s: string) => s.startsWith("/tmp/virtual-") || s.startsWith("/virtual/");

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    mockDirs.add(testRoot);
    spies.push(
      spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (isVirt(s)) return mockFiles.has(s) || mockDirs.has(s);
        return origExists(p);
      }),
      spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike) => {
        const s = String(p);
        mockDirs.add(s);
        return undefined as unknown as string;
      }) as unknown as typeof fs.mkdirSync),
      spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (isVirt(s)) {
          const val = mockFiles.get(s);
          if (val !== undefined) return val;
          throw new Error(`ENOENT: no such file, open '${s}'`);
        }
        return origRead(p as never);
      }) as unknown as typeof fs.readFileSync),
      spyOn(fs, "writeFileSync").mockImplementation(((
        p: fs.PathOrFileDescriptor,
        data: string | NodeJS.ArrayBufferView,
      ) => {
        const s = String(p);
        mockFiles.set(
          s,
          typeof data === "string"
            ? data
            : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8"),
        );
      }) as unknown as typeof fs.writeFileSync),
      spyOn(fs, "rmSync").mockImplementation(((p: fs.PathLike) => {
        const s = String(p);
        mockFiles.delete(s);
        mockDirs.delete(s);
        for (const f of Array.from(mockFiles.keys()))
          if (f.startsWith(s + "/")) mockFiles.delete(f);
        for (const d of Array.from(mockDirs)) if (d.startsWith(s + "/")) mockDirs.delete(d);
      }) as unknown as typeof fs.rmSync),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
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

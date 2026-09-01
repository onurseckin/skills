import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  formatBehavioralForensicsBrief,
  executeBehavioralForensics,
  pairCompanionAuditor,
  pairMindCompanionAuditor,
  pairAllMandatoryCompanionAuditors,
  verifyCompanionAuditorsHealth,
  assertCompanionAuditorsHealth,
  assertBehavioralCompliance,
} from "../../../olt/scripts/src/orchestrator/companion-auditor.ts";
import { checkCompanionAuditorsDoctor } from "../../../olt/scripts/src/reporting/doctor/rules/companion-auditors.ts";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { BehavioralForensicsReport } from "../../../olt/scripts/src/orchestrator/types.ts";

describe("OrchestratorCompanionAuditor Unit Tests", () => {
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

  test("executeForensics — returns clean compliant report on empty run", () => {
    const runRoot = join(testRoot, "run-clean");
    fs.mkdirSync(runRoot, { recursive: true });
    fs.writeFileSync(join(runRoot, "events.jsonl"), "", "utf-8");

    const report: BehavioralForensicsReport = executeBehavioralForensics(testRoot, {
      capsuleRunRoot: runRoot,
      logDefects: false,
    });

    expect(report.compliant).toBe(true);
    expect(report.incidents.length).toBe(0);
    expect(report.tokenBurningCount).toBe(0);
    expect(report.falseSerializationCount).toBe(0);
    expect(report.roleBoundaryDeviationsCount).toBe(0);
    expect(report.markdown).toContain("COMPLIANT");
  });

  test("executeForensics — detects TOKEN_BURNING, FALSE_SERIALIZATION, and ROLE_BOUNDARY_DEVIATION events", () => {
    const runRoot = join(testRoot, "run-forensics-events");
    fs.mkdirSync(runRoot, { recursive: true });

    const nowMs = Date.parse("2026-08-24T12:00:00.000Z");
    const readEvents = Array.from({ length: 6 }, (_, i) => ({
      kind: "tool-called",
      sequence: i + 1,
      actor: "worker-1",
      timestamp: new Date(nowMs + i * 1000).toISOString(),
      payload: { tool: "read_file", arguments: { AbsolutePath: `src/file-${i}.ts` } },
    }));
    const coordinatorWriteEvent = {
      kind: "tool-called",
      sequence: readEvents.length + 1,
      actor: "coordinator-1",
      timestamp: new Date(nowMs + readEvents.length * 1000).toISOString(),
      payload: { tool: "write_file", arguments: { TargetFile: "src/forbidden.ts" } },
    };
    const eventLines = [...readEvents, coordinatorWriteEvent].map((event) => JSON.stringify(event));
    fs.writeFileSync(join(runRoot, "events.jsonl"), eventLines.join("\n") + "\n", "utf-8");

    const state = {
      tasks: {
        "task-a": {
          write_scope: ["src/aaa.ts"],
          attempts: [
            { started_at: "2026-08-24T10:00:00.000Z", completed_at: "2026-08-24T10:05:00.000Z" },
          ],
        },
        "task-b": {
          write_scope: ["src/bbb.ts"],
          attempts: [
            { started_at: "2026-08-24T10:05:00.000Z", completed_at: "2026-08-24T10:10:00.000Z" },
          ],
        },
        "task-c": {
          write_scope: ["src/ccc.ts"],
          attempts: [
            { started_at: "2026-08-24T10:10:00.000Z", completed_at: "2026-08-24T10:15:00.000Z" },
          ],
        },
      },
    };
    fs.writeFileSync(join(runRoot, "state.json"), JSON.stringify(state), "utf-8");

    const report: BehavioralForensicsReport = executeBehavioralForensics(testRoot, {
      capsuleRunRoot: runRoot,
      logDefects: false,
    });
    expect(report.compliant).toBe(false);
    expect(report.incidents.length).toBe(3);
    expect(report.roleBoundaryDeviationsCount).toBe(1);
    expect(report.tokenBurningCount).toBe(1);
    expect(report.falseSerializationCount).toBe(1);
    expect(report.markdown).toContain("DEVIATION DETECTED");
  });

  test("formatForensicsBrief — produces structured, line-limited brief", () => {
    const report: BehavioralForensicsReport = {
      compliant: false,
      eventsAnalyzed: 42,
      incidents: [
        {
          id: "inc-1",
          category: "ROLE_BOUNDARY_DEVIATION",
          severity: "CRITICAL",
          title: "Role Boundary Deviation",
          description: "Supervisor wrote code",
          observation: "Supervisor wrote code",
          remediation: "Delegate to implementer",
          recommendation: "Delegate to implementer",
          timestamp: new Date().toISOString(),
        },
      ],
      tokenBurningCount: 0,
      falseSerializationCount: 0,
      roleBoundaryDeviationsCount: 1,
      defectsLogged: 1,
      cursor: {
        lastInspectedTimestamp: new Date().toISOString(),
        lastInspectedEventIndex: 42,
        lastAuditTimestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
      markdown: "",
    };

    const brief = formatBehavioralForensicsBrief(report);
    const lines = brief.split("\n");
    expect(lines.length).toBeLessThan(25);
    expect(brief).toContain("**Events Analyzed**: 42");
    expect(brief).toContain("**Role Boundary Deviations**: 1");
    expect(brief).toContain("[CRITICAL] ROLE_BOUNDARY_DEVIATION");
  });

  test("assertCompliance — throws HarnessError when violations are present", () => {
    const report: BehavioralForensicsReport = {
      compliant: false,
      eventsAnalyzed: 10,
      incidents: [
        {
          id: "inc-crit-1",
          category: "ROLE_BOUNDARY_DEVIATION",
          severity: "CRITICAL",
          title: "Role Boundary Deviation",
          description: "Direct code write by coordinator",
          observation: "Direct code write by coordinator",
          remediation: "Delegate to implementer",
          recommendation: "Delegate to implementer",
          timestamp: new Date().toISOString(),
        },
      ],
      tokenBurningCount: 0,
      falseSerializationCount: 0,
      roleBoundaryDeviationsCount: 1,
      defectsLogged: 1,
      cursor: {
        lastInspectedTimestamp: new Date().toISOString(),
        lastInspectedEventIndex: 10,
        lastAuditTimestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
      markdown: "",
    };
    expect(() => assertBehavioralCompliance(report)).toThrow(HarnessError);
  });

  test("assertCompliance — handles non-critical incidents with general error message", () => {
    const report: BehavioralForensicsReport = {
      compliant: false,
      eventsAnalyzed: 5,
      incidents: [
        {
          id: "inc-warn-1",
          category: "TOKEN_BURNING",
          severity: "MEDIUM",
          title: "Token Burning",
          description: "Minor exploratory read redundancy",
          observation: "Minor exploratory read redundancy",
          remediation: "Reduce read calls",
          recommendation: "Reduce read calls",
          timestamp: new Date().toISOString(),
        },
      ],
      tokenBurningCount: 1,
      falseSerializationCount: 0,
      roleBoundaryDeviationsCount: 0,
      defectsLogged: 1,
      cursor: {
        lastInspectedTimestamp: new Date().toISOString(),
        lastInspectedEventIndex: 5,
        lastAuditTimestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
      markdown: "",
    };
    expect(() => assertBehavioralCompliance(report)).toThrow(
      /\[BEHAVIORAL_FORENSICS_VIOLATION\] Detected 1 behavioral deviation\(s\)/,
    );
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

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  formatBehavioralForensicsBrief,
  executeBehavioralForensics,
  assertBehavioralCompliance,
} from "../../../olt/scripts/src/orchestrator/companion-auditor.ts";
import type { BehavioralForensicsReport } from "../../../olt/scripts/src/orchestrator/types.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("OrchestratorCompanionAuditor Unit Tests - Behavioral Forensics", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | undefined;
  const testRoot = "/virtual/skills-companion-forensics-unit";

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
});

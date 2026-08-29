import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  OrchestratorCompanionAuditor,
  executeBehavioralForensics,
  formatBehavioralForensicsBrief,
  pairCompanionAuditor,
  assertBehavioralCompliance,
} from "../../../olt/scripts/src/orchestrator/companion-auditor.ts";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { BehavioralForensicsReport } from "../../../olt/scripts/src/orchestrator/types.ts";

describe("OrchestratorCompanionAuditor Unit Tests", () => {
  const testRoot = join(tmpdir(), `companion-auditor-unit-${Date.now()}`);

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
    mkdirSync(runRoot, { recursive: true });
    writeFileSync(join(runRoot, "events.jsonl"), "", "utf-8");

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
    mkdirSync(runRoot, { recursive: true });

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
    writeFileSync(join(runRoot, "events.jsonl"), eventLines.join("\n") + "\n", "utf-8");

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
    writeFileSync(join(runRoot, "state.json"), JSON.stringify(state), "utf-8");

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

  test("Static AST Invariants: Zero any and Suppressions in companion-auditor unit test", () => {
    const content = readFileSync(import.meta.path, "utf-8");

    const forbiddenAnyRegex = new RegExp(":[ \\t]*" + "any\\b");
    const forbiddenCastRegex = new RegExp("\\bas[ \\t]+" + "any\\b");
    const forbiddenSuppressionsRegex = new RegExp("@ts-" + "(ignore|expect-error|nocheck)");
    const forbiddenLintRegex = new RegExp("(eslint|oxlint)" + "-disable");

    expect(content).not.toMatch(forbiddenAnyRegex);
    expect(content).not.toMatch(forbiddenCastRegex);
    expect(content).not.toMatch(forbiddenSuppressionsRegex);
    expect(content).not.toMatch(forbiddenLintRegex);
  });

  test("clean up test directory", () => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
    expect(existsSync(testRoot)).toBe(false);
  });
});

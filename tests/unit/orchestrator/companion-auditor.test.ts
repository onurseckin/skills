import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  OrchestratorCompanionAuditor,
  executeBehavioralForensics,
  formatBehavioralForensicsBrief,
  pairCompanionAuditor,
  assertBehavioralCompliance,
} from "../../../olt/scripts/src/orchestrator/companion-auditor.ts";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/agents.ts";
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

    const eventLines = [
      JSON.stringify({
        type: "boundary_violation",
        message: "Coordinator executed direct write operation",
        timestamp: "2026-08-24T12:00:00.000Z",
      }),
      JSON.stringify({
        type: "token_burning",
        message: "Excessive exploratory read calls (12 reads before first write)",
        timestamp: "2026-08-24T12:01:00.000Z",
      }),
      JSON.stringify({
        type: "false_serialization",
        message: "Disjoint write scope tasks task-1 and task-2 executed sequentially",
        timestamp: "2026-08-24T12:02:00.000Z",
      }),
    ];
    writeFileSync(join(runRoot, "events.jsonl"), eventLines.join("\n") + "\n", "utf-8");

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

  test("clean up test directory", () => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
    expect(existsSync(testRoot)).toBe(false);
  });
});

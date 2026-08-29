import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { mindAuditLiveCommand } from "../../olt/scripts/src/cli/commands/mind-audit-live.ts";
import { skillAuditLiveCommand } from "../../olt/scripts/src/cli/commands/skill-audit-live.ts";
import { execute } from "../../olt/scripts/src/cli/execute.ts";
import type { AgentGrantRecord } from "../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { SkillAuditorPolicy } from "../../olt/scripts/src/engine/scheduler/skill-auditor-policy.ts";
import {
  AuditorCursorStore,
  MindAuditorEngine,
  SkillAuditorEngine,
  type AuditorCursor,
} from "../../olt/scripts/src/mind/cognitive-auditors.ts";
import { OrchestratorCompanionAuditor } from "../../olt/scripts/src/orchestrator/companion-auditor.ts";
import { AutonomousLoopRunner } from "../../olt/scripts/src/orchestrator/loop-runner.ts";
import type {
  RoundExecutor,
  RoundExecutionInput,
  RoundExecutionResult,
} from "../../olt/scripts/src/orchestrator/types.ts";
import {
  SplitChannelDefectRouter,
  type DefectRouteResult,
} from "../../olt/scripts/src/reporting/split-channel-defect-router.ts";
import { scratchRoot } from "../support/scratch-root.ts";

const MIN_MANIFEST_YAML = `role: mind
tier: 0
spawns:
  - orchestrator
may:
  - Coordinate strategic goals
  - Admit self-evolution candidate tasks
must_not:
  - Implement code directly
  - Run unit test suites
`;

afterEach(() => {
  delete process.env["OLT_SKILL_HOME_REPO"];
});

describe("Tier 0 Dual Cognitive Auditors End-to-End Integration Suite", () => {
  describe("Simulation 1: Cross-Repo Telemetry & Mothership Defect Routing", () => {
    test("routes project defects to local consumer repo and skill-framework defects to mothership repo", () => {
      const consumerRepo = scratchRoot(import.meta.path, "sim-1-consumer-repo");
      const mothershipRepo = scratchRoot(import.meta.path, "sim-1-mothership-repo");

      mkdirSync(join(consumerRepo, ".olt"), { recursive: true });
      mkdirSync(join(mothershipRepo, ".olt"), { recursive: true });

      process.env["OLT_SKILL_HOME_REPO"] = mothershipRepo;

      // 1. Route a domain: 'project' defect from consumer repo
      const projectRouteResult: DefectRouteResult = SplitChannelDefectRouter.routeDefect({
        currentRepoRoot: consumerRepo,
        domain: "project",
        defect: {
          id: "DEF-CONSUMER-APP-001",
          error_code: "APP_SYNTAX_ERROR",
          title: "Consumer Application Syntax Error",
          description: "Unexpected token in consumer UI component",
          actor: "implementer-1",
          timestamp: "2026-08-24T05:00:00.000Z",
          context: { file: "src/App.tsx", line: 15 },
        },
      });

      expect(projectRouteResult.routed).toBe(true);
      expect(projectRouteResult.isMothership).toBe(false);
      expect(projectRouteResult.targetRepoRoot).toBe(resolve(consumerRepo));

      const consumerDefectsPath = join(consumerRepo, ".olt", "defects.jsonl");
      const mothershipDefectsPath = join(mothershipRepo, ".olt", "defects.jsonl");

      expect(existsSync(consumerDefectsPath)).toBe(true);
      expect(existsSync(mothershipDefectsPath)).toBe(false);

      const consumerContent = readFileSync(consumerDefectsPath, "utf-8");
      const consumerDefect = JSON.parse(consumerContent.trim()) as Record<string, unknown>;
      expect(consumerDefect["id"]).toBe("DEF-CONSUMER-APP-001");
      expect(consumerDefect["domain"]).toBe("project");
      expect(consumerDefect["error_code"]).toBe("APP_SYNTAX_ERROR");
      expect(consumerDefect["source_repo"]).toBe(resolve(consumerRepo));

      // 2. Route a domain: 'skill-framework' defect from consumer repo
      const skillFrameworkRouteResult: DefectRouteResult = SplitChannelDefectRouter.routeDefect({
        currentRepoRoot: consumerRepo,
        domain: "skill-framework",
        defect: {
          id: "DEF-FRAMEWORK-001",
          error_code: "ROLE_BOUNDARY_DEVIATION",
          title: "Skill Framework Supervisor Breach",
          description: "Tier 1 Orchestrator attempted direct file write",
          actor: "skill-auditor",
          timestamp: "2026-08-24T05:05:00.000Z",
          context: { attemptedFile: "src/core.ts" },
        },
      });

      expect(skillFrameworkRouteResult.routed).toBe(true);
      expect(skillFrameworkRouteResult.isMothership).toBe(true);
      expect(skillFrameworkRouteResult.targetRepoRoot).toBe(resolve(mothershipRepo));

      expect(existsSync(mothershipDefectsPath)).toBe(true);

      const mothershipContent = readFileSync(mothershipDefectsPath, "utf-8");
      const mothershipDefect = JSON.parse(mothershipContent.trim()) as Record<string, unknown>;
      expect(mothershipDefect["id"]).toBe("DEF-FRAMEWORK-001");
      expect(mothershipDefect["domain"]).toBe("skill-framework");
      expect(mothershipDefect["error_code"]).toBe("ROLE_BOUNDARY_DEVIATION");
      expect(mothershipDefect["source_repo"]).toBe(resolve(consumerRepo));

      // Verify consumer defects file still only contains 1 project defect
      const finalConsumerLines = readFileSync(consumerDefectsPath, "utf-8").trim().split("\n");
      expect(finalConsumerLines).toHaveLength(1);
    });
  });

  describe("Simulation 2: Live Mind Stagnation & Mode A / Mode B Injection", () => {
    test("detects stagnation and synthesizes verbatim prompt for Mode A and Mode B", () => {
      const simulatedRepo = scratchRoot(import.meta.path, "sim-2-mind-stagnation");
      mkdirSync(join(simulatedRepo, ".olt"), { recursive: true });
      mkdirSync(join(simulatedRepo, "olt", "agents"), { recursive: true });
      writeFileSync(join(simulatedRepo, "olt", "agents", "mind.yaml"), MIN_MANIFEST_YAML, "utf-8");

      const nowIso = "2026-08-24T12:05:00.000Z";
      const lastActiveIso = "2026-08-24T12:02:30.000Z"; // 150s idle (threshold: 120s)
      const cursor: AuditorCursor = {
        lastInspectedTimestamp: lastActiveIso,
        lastInspectedEventIndex: 0,
      };

      // 1. Mode A: Empty Backlog (0 pending items)
      const modeAResult = MindAuditorEngine.auditMindPulse(simulatedRepo, {
        cursor,
        stagnationThresholdSeconds: 120,
        now: nowIso,
        conversationId: "conv-mind-sim-mode-a",
      });

      expect(modeAResult.stagnant).toBe(true);
      expect(modeAResult.defectCreated).toBe(true);
      expect(modeAResult.idleDurationSeconds).toBe(150);
      expect(modeAResult.telemetry.pendingBacklogCount).toBe(0);
      expect(modeAResult.injectionPrompt).toBeDefined();

      const promptA = String(modeAResult.injectionPrompt);
      expect(promptA).toContain("[LIVE_STAGNATION_WAKEUP_INJECTION]");
      expect(promptA).toContain("MODE A: AUTONOMOUS SELF-EVOLUTION MANDATE");
      expect(promptA).toContain("CRITICAL SUPERVISORY ALERT: Live Stagnation Detected");
      expect(promptA).toContain("Coordinate strategic goals");
      expect(promptA).toContain("Admit self-evolution candidate tasks");
      expect(promptA).toContain("must_not:");

      // Verify cursor updated and saved to .olt/auditor-cursors.json
      const savedCursorA = AuditorCursorStore.loadCursor(simulatedRepo, "mind");
      expect(savedCursorA.lastInspectedTimestamp).toBe(nowIso);

      // 2. Mode B: Pending Backlog Items Present
      const backlogPath = join(simulatedRepo, ".olt", "backlog.jsonl");
      const backlogItem = JSON.stringify({
        id: "item-task-101",
        title: "Implement High Priority Feature",
        status: "PENDING",
      });
      writeFileSync(backlogPath, `${backlogItem}\n`, "utf-8");

      const modeBResult = MindAuditorEngine.auditMindPulse(simulatedRepo, {
        cursor: {
          lastInspectedTimestamp: lastActiveIso,
          lastInspectedEventIndex: 0,
        },
        stagnationThresholdSeconds: 120,
        now: nowIso,
        conversationId: "conv-mind-sim-mode-b",
      });

      expect(modeBResult.stagnant).toBe(true);
      expect(modeBResult.telemetry.pendingBacklogCount).toBe(1);
      expect(modeBResult.injectionPrompt).toBeDefined();

      const promptB = String(modeBResult.injectionPrompt);
      expect(promptB).toContain("[LIVE_STAGNATION_WAKEUP_INJECTION]");
      expect(promptB).toContain("MODE B: ACTIVE INTAKE & WORK/SPAN SCALING MANDATE");
      expect(promptB).toContain("Coordinate strategic goals");
    });
  });

  describe("Simulation 3: Skill Compliance Delta Events & Cursor Progression", () => {
    test("tracks high-water mark cursor and audits only incremental delta events across runs", () => {
      const simulatedRepo = scratchRoot(import.meta.path, "sim-3-skill-compliance");
      const capsuleDir = join(simulatedRepo, "capsules", "run-42");

      mkdirSync(join(simulatedRepo, ".olt"), { recursive: true });
      mkdirSync(capsuleDir, { recursive: true });

      // Initial events (2 valid tool calls)
      const eventsPath = join(capsuleDir, "events.jsonl");
      const e0 = JSON.stringify({
        timestamp: "2026-08-24T05:00:00.000Z",
        kind: "tool-called",
        tool: "view_file",
        actor: "implementer-1",
      });
      const e1 = JSON.stringify({
        timestamp: "2026-08-24T05:01:00.000Z",
        kind: "tool-called",
        tool: "bun test",
        actor: "implementer-1",
      });
      writeFileSync(eventsPath, `${e0}\n${e1}\n`, "utf-8");

      // First run: inspect initial 2 events
      const run1Result = SkillAuditorEngine.auditSkillCompliance(simulatedRepo, {
        capsuleRunRoot: capsuleDir,
        now: "2026-08-24T05:01:30.000Z",
      });

      expect(run1Result.compliant).toBe(true);
      expect(run1Result.eventsAnalyzed).toBe(2);
      expect(run1Result.incidents.length).toBe(0);
      expect(run1Result.defectsLogged).toBe(0);
      expect(run1Result.cursor.lastInspectedEventIndex).toBe(1);

      // Verify cursor is persisted on disk
      const savedCursor1 = AuditorCursorStore.loadCursor(simulatedRepo, "skill");
      expect(savedCursor1.lastInspectedEventIndex).toBe(1);
      expect(savedCursor1.lastInspectedTimestamp).toBe("2026-08-24T05:01:30.000Z");

      // Append new delta events: 1 benign tool call + 1 critical boundary violation
      const e2 = JSON.stringify({
        timestamp: "2026-08-24T05:02:00.000Z",
        kind: "tool-called",
        tool: "read_resource",
        actor: "validator-1",
      });
      const e3 = JSON.stringify({
        timestamp: "2026-08-24T05:03:00.000Z",
        type: "boundary_violation",
        error_code: "ROLE_BOUNDARY_DEVIATION",
        message: "Coordinator modified repository source code directly",
        actor: "coordinator-1",
        command_id: "cmd-write-99",
      });
      writeFileSync(eventsPath, `${e0}\n${e1}\n${e2}\n${e3}\n`, "utf-8");

      // Second run: audit using saved cursor
      const run2Result = SkillAuditorEngine.auditSkillCompliance(simulatedRepo, {
        capsuleRunRoot: capsuleDir,
        now: "2026-08-24T05:03:30.000Z",
      });

      expect(run2Result.compliant).toBe(false);
      expect(run2Result.eventsAnalyzed).toBe(2); // Only e2 and e3 analyzed
      expect(run2Result.incidents.length).toBe(1);
      expect(run2Result.incidents[0]?.category).toBe("ROLE_BOUNDARY_DEVIATION");
      expect(run2Result.incidents[0]?.severity).toBe("CRITICAL");
      expect(run2Result.incidents[0]?.description).toBe(
        "Coordinator modified repository source code directly",
      );
      expect(run2Result.defectsLogged).toBe(1);
      expect(run2Result.cursor.lastInspectedEventIndex).toBe(3);

      // Verify updated cursor on disk
      const savedCursor2 = AuditorCursorStore.loadCursor(simulatedRepo, "skill");
      expect(savedCursor2.lastInspectedEventIndex).toBe(3);
      expect(savedCursor2.lastInspectedTimestamp).toBe("2026-08-24T05:03:30.000Z");
    });
  });

  describe("Simulation 4: Mandatory Companion Policy Enforcement", () => {
    test("enforces presence of mind-auditor and skill-auditor on long-task target repositories", () => {
      const skillsRepo = "/Users/developer/repos/skills";
      const foreignRepo = "/Users/developer/repos/external-app";

      const mindOnlyAgent: readonly AgentGrantRecord[] = [
        {
          id: "mind-1",
          role: "mind",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
      ];

      const orchestratorOnlyAgent: readonly AgentGrantRecord[] = [
        {
          id: "orchestrator-1",
          role: "orchestrator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
      ];

      // 1. assertMindAuditorRequired throws on skills repo when mind-auditor is missing
      expect(() => {
        SkillAuditorPolicy.assertMindAuditorRequired(skillsRepo, mindOnlyAgent);
      }).toThrow(HarnessError);

      try {
        SkillAuditorPolicy.assertMindAuditorRequired(skillsRepo, mindOnlyAgent);
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        expect((err as HarnessError).message).toContain("[MIND_AUDITOR_MANDATE_VIOLATION]");
      }

      // Passes on non-mandatory repo
      expect(() => {
        SkillAuditorPolicy.assertMindAuditorRequired(foreignRepo, mindOnlyAgent);
      }).not.toThrow();

      // Passes when mind-auditor is present
      const mindWithAuditor: readonly AgentGrantRecord[] = [
        ...mindOnlyAgent,
        {
          id: "mind-auditor-1",
          role: "mind-auditor",
          parent_agent_id: "mind-1",
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
      ];
      expect(() => {
        SkillAuditorPolicy.assertMindAuditorRequired(skillsRepo, mindWithAuditor);
      }).not.toThrow();

      // 2. assertSkillAuditorRequired throws on skills repo when skill-auditor is missing
      expect(() => {
        SkillAuditorPolicy.assertSkillAuditorRequired(skillsRepo, orchestratorOnlyAgent);
      }).toThrow(HarnessError);

      try {
        SkillAuditorPolicy.assertSkillAuditorRequired(skillsRepo, orchestratorOnlyAgent);
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        expect((err as HarnessError).message).toContain("[SKILL_AUDITOR_MANDATE_VIOLATION]");
      }

      // Passes on non-mandatory repo
      expect(() => {
        SkillAuditorPolicy.assertSkillAuditorRequired(foreignRepo, orchestratorOnlyAgent);
      }).not.toThrow();

      // Passes when skill-auditor or meta-auditor is present
      const orchestratorWithAuditor: readonly AgentGrantRecord[] = [
        ...orchestratorOnlyAgent,
        {
          id: "skill-auditor-1",
          role: "meta-auditor",
          parent_agent_id: "orchestrator-1",
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
      ];
      expect(() => {
        SkillAuditorPolicy.assertSkillAuditorRequired(skillsRepo, orchestratorWithAuditor);
      }).not.toThrow();
    });
  });

  describe("Simulation 5: CLI Command Invocations (mind:audit:live & skill:audit:live)", () => {
    test("executes mind:audit:live and skill:audit:live, enforcing <= 30 line limit and valid JSON structure", async () => {
      const cliRepo = scratchRoot(import.meta.path, "sim-5-cli-invocations");
      const runDir = join(cliRepo, "capsules", "run-1");

      mkdirSync(join(cliRepo, ".olt"), { recursive: true });
      mkdirSync(join(cliRepo, "olt", "agents"), { recursive: true });
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(cliRepo, "olt", "agents", "mind.yaml"), MIN_MANIFEST_YAML, "utf-8");

      AuditorCursorStore.saveCursor(cliRepo, "mind", {
        lastInspectedTimestamp: new Date().toISOString(),
        lastInspectedEventIndex: 0,
      });

      // 1. Test mind:audit:live handler and CLI execute
      const mindJson = await mindAuditLiveCommand({ repo: cliRepo, json: true });
      expect(typeof mindJson["stagnant"]).toBe("boolean");
      expect(typeof mindJson["idle_duration_seconds"]).toBe("number");
      expect(typeof mindJson["pending_backlog_count"]).toBe("number");
      expect(typeof mindJson["unresolved_defect_count"]).toBe("number");
      expect(typeof mindJson["output"]).toBe("string");

      const mindText = await execute(["mind:audit:live", "--repo", cliRepo]);
      expect(typeof mindText["output"]).toBe("string");
      const mindOutputLines = String(mindText["output"]).split("\n");
      expect(mindOutputLines.length).toBeLessThanOrEqual(30);

      // 2. Test skill:audit:live handler and CLI execute
      const eventsPath = join(runDir, "events.jsonl");
      const e0 = JSON.stringify({
        kind: "tool-called",
        tool: "view_file",
        actor: "implementer-1",
      });
      writeFileSync(eventsPath, `${e0}\n`, "utf-8");

      const skillJson = await skillAuditLiveCommand({ repo: cliRepo, run: runDir, json: true });
      expect(typeof skillJson["compliant"]).toBe("boolean");
      expect(typeof skillJson["incidents_count"]).toBe("number");
      expect(typeof skillJson["events_analyzed"]).toBe("number");
      expect(typeof skillJson["defects_logged"]).toBe("number");
      expect(typeof skillJson["output"]).toBe("string");

      const skillText = await execute(["skill:audit:live", "--repo", cliRepo, "--run", runDir]);
      expect(typeof skillText["output"]).toBe("string");
      const skillOutputLines = String(skillText["output"]).split("\n");
      expect(skillOutputLines.length).toBeLessThanOrEqual(30);
    });
  });

  describe("Simulation 6: Orchestrator Companion Auditor Auto-Dispatch & Forensics", () => {
    test("automatically pairs companion auditor and tracks behavioral forensics per round", async () => {
      const simRepo = scratchRoot(import.meta.path, "sim-6-orchestrator-companion");
      mkdirSync(join(simRepo, ".olt"), { recursive: true });

      const pairing = OrchestratorCompanionAuditor.pairCompanion(simRepo);
      expect(pairing.paired).toBe(true);
      expect(pairing.autoProvisioned).toBe(true);

      const mockExecutor: RoundExecutor = {
        async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
          const eventsPath = join(input.capsulePath, "events.jsonl");
          const boundaryEvent = JSON.stringify({
            type: "boundary_violation",
            message: "Supervisor performed direct edit",
            timestamp: new Date().toISOString(),
          });
          writeFileSync(eventsPath, `${boundaryEvent}\n`, "utf-8");

          return {
            runId: input.runId,
            round: input.round,
            status: "completed",
            criticDecision: "approve",
            tasks: [{ id: "task-1", status: "done", writeScope: ["src/app.ts"], gatePassed: true }],
            findings: [],
            gateResults: [{ gate_id: "gate-1", command_id: "cmd-1", status: "passed" }],
            summary: "Round 1 completed with supervisor boundary violation recorded",
          };
        },
      };

      const runner = new AutonomousLoopRunner({
        baseRunId: "test-companion-run",
        repoPath: simRepo,
        initialPrompt: "Test auto companion dispatch",
        maxRounds: 1,
        executor: mockExecutor,
      });

      const summary = await runner.run();
      expect(summary.finalStatus).toBe("converged_success");
      expect(summary.companionPairing !== undefined).toBe(true);
      expect(summary.rounds.length).toBe(1);

      const round1 = summary.rounds[0];
      expect(round1 !== undefined).toBe(true);
      if (round1 !== undefined) {
        expect(round1.behavioralForensics !== undefined).toBe(true);
        if (round1.behavioralForensics !== undefined) {
          expect(round1.behavioralForensics.roleBoundaryDeviationsCount).toBe(1);
          expect(round1.behavioralForensics.compliant).toBe(false);
        }
      }
    });
  });

  describe("Static AST Invariants: Zero any and Suppressions", () => {
    test("verifies test file strictly adheres to clean typing standards", () => {
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
  });
});

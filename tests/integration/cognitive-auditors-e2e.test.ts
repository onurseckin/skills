import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mindAuditLiveCommand } from "../../olt/scripts/src/cli/commands/mind-audit-live.ts";
import { skillAuditLiveCommand } from "../../olt/scripts/src/cli/commands/skill-audit-live.ts";
import { execute } from "../../olt/scripts/src/cli/execute.ts";
import type { AgentGrantRecord } from "../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { SkillAuditorPolicy } from "../../olt/scripts/src/engine/scheduler/index.ts";
import {
  AuditorCursorStore,
  MindAuditorEngine,
  SkillAuditorEngine,
  type AuditorCursor,
} from "../../olt/scripts/src/mind/auditing/cognitive/index.ts";
import { OrchestratorCompanionAuditor } from "../../olt/scripts/src/orchestrator/companion-auditor.ts";
import { AutonomousLoopRunner } from "../../olt/scripts/src/orchestrator/loop-runner.ts";
import type {
  RoundExecutionInput,
  RoundExecutionResult,
  RoundExecutor,
} from "../../olt/scripts/src/orchestrator/types.ts";
import { SplitChannelDefectRouter } from "../../olt/scripts/src/reporting/split-channel-defect-router.ts";

const MIN_MANIFEST_YAML =
  "role: mind\ntier: 0\nspawns:\n  - orchestrator\nmay:\n  - Coordinate strategic goals\n  - Admit self-evolution candidate tasks\nmust_not:\n  - Implement code directly\n  - Run unit test suites\n";

async function withTempDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "cog-aud-e2e-"));
  try {
    return await fn(dir);
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

function setupMindRepo(dir: string): void {
  mkdirSync(join(dir, ".olt"), { recursive: true });
  mkdirSync(join(dir, "olt", "agents"), { recursive: true });
  writeFileSync(join(dir, "olt", "agents", "mind.yaml"), MIN_MANIFEST_YAML, "utf-8");
}

afterEach(() => {
  delete process.env["OLT_SKILL_HOME_REPO"];
});

describe("Tier 0 Dual Cognitive Auditors End-to-End Integration Suite", () => {
  describe("Simulation 1: Cross-Repo Telemetry & Mothership Defect Routing", () => {
    test("routes project defects to local consumer repo and skill-framework defects to mothership repo", async () => {
      await withTempDir(async (consumerRepo) => {
        await withTempDir(async (mothershipRepo) => {
          mkdirSync(join(consumerRepo, ".olt"), { recursive: true });
          mkdirSync(join(mothershipRepo, ".olt"), { recursive: true });
          process.env["OLT_SKILL_HOME_REPO"] = mothershipRepo;

          const pRes = SplitChannelDefectRouter.routeDefect({
            currentRepoRoot: consumerRepo,
            domain: "project",
            defect: {
              id: "DEF-CONSUMER-001",
              error_code: "APP_SYNTAX_ERROR",
              title: "App Syntax Error",
              description: "Unexpected token",
              actor: "implementer-1",
              timestamp: "2026-08-24T05:00:00.000Z",
              context: { file: "src/App.tsx", line: 15 },
            },
          });
          expect(
            pRes.routed && !pRes.isMothership && pRes.targetRepoRoot === resolve(consumerRepo),
          ).toBe(true);

          const cPath = join(consumerRepo, ".olt", "defects.jsonl");
          const mPath = join(mothershipRepo, ".olt", "defects.jsonl");
          expect(existsSync(cPath) && !existsSync(mPath)).toBe(true);

          const cDefect = JSON.parse(readFileSync(cPath, "utf-8").trim()) as Record<
            string,
            unknown
          >;
          expect(cDefect["id"] === "DEF-CONSUMER-001" && cDefect["domain"] === "project").toBe(
            true,
          );
          expect(cDefect["source_repo"]).toBe(resolve(consumerRepo));

          const sRes = SplitChannelDefectRouter.routeDefect({
            currentRepoRoot: consumerRepo,
            domain: "skill-framework",
            defect: {
              id: "DEF-FRAMEWORK-001",
              error_code: "ROLE_BOUNDARY_DEVIATION",
              title: "Supervisor Breach",
              description: "Attempted direct file write",
              actor: "skill-auditor",
              timestamp: "2026-08-24T05:05:00.000Z",
              context: { attemptedFile: "src/core.ts" },
            },
          });
          expect(
            sRes.routed && sRes.isMothership && sRes.targetRepoRoot === resolve(mothershipRepo),
          ).toBe(true);
          expect(existsSync(mPath)).toBe(true);

          const mDefect = JSON.parse(readFileSync(mPath, "utf-8").trim()) as Record<
            string,
            unknown
          >;
          expect(
            mDefect["id"] === "DEF-FRAMEWORK-001" && mDefect["domain"] === "skill-framework",
          ).toBe(true);
          expect(mDefect["source_repo"]).toBe(resolve(consumerRepo));
          expect(readFileSync(cPath, "utf-8").trim().split("\n")).toHaveLength(1);
        });
      });
    });
  });

  describe("Simulation 2: Live Mind Stagnation & Mode A / Mode B Injection", () => {
    test("detects stagnation and synthesizes verbatim prompt for Mode A and Mode B", async () => {
      await withTempDir((simulatedRepo) => {
        setupMindRepo(simulatedRepo);
        const nowIso = "2026-08-24T12:05:00.000Z";
        const cursor: AuditorCursor = {
          lastInspectedTimestamp: "2026-08-24T12:02:30.000Z",
          lastInspectedEventIndex: 0,
        };

        const resA = MindAuditorEngine.auditMindPulse(simulatedRepo, {
          cursor,
          stagnationThresholdSeconds: 120,
          now: nowIso,
          conversationId: "conv-mind-sim-mode-a",
        });
        expect(resA.stagnant && resA.defectCreated && resA.idleDurationSeconds === 150).toBe(true);
        expect(resA.telemetry.pendingBacklogCount).toBe(0);
        const promptA = String(resA.injectionPrompt);
        expect(promptA).toContain("[LIVE_STAGNATION_WAKEUP_INJECTION]");
        expect(promptA).toContain("MODE A: AUTONOMOUS SELF-EVOLUTION MANDATE");
        expect(promptA).toContain("Coordinate strategic goals");
        expect(AuditorCursorStore.loadCursor(simulatedRepo, "mind").lastInspectedTimestamp).toBe(
          nowIso,
        );

        writeFileSync(
          join(simulatedRepo, ".olt", "backlog.jsonl"),
          `${JSON.stringify({ id: "item-101", title: "Feature", status: "PENDING" })}\n`,
          "utf-8",
        );
        const resB = MindAuditorEngine.auditMindPulse(simulatedRepo, {
          cursor: {
            lastInspectedTimestamp: "2026-08-24T12:02:30.000Z",
            lastInspectedEventIndex: 0,
          },
          stagnationThresholdSeconds: 120,
          now: nowIso,
          conversationId: "conv-mind-sim-mode-b",
        });
        expect(resB.stagnant && resB.telemetry.pendingBacklogCount === 1).toBe(true);
        expect(String(resB.injectionPrompt)).toContain(
          "MODE B: ACTIVE INTAKE & WORK/SPAN SCALING MANDATE",
        );
      });
    });
  });

  describe("Simulation 3: Skill Compliance Delta Events & Cursor Progression", () => {
    test("tracks high-water mark cursor and audits only incremental delta events across runs", async () => {
      await withTempDir((simulatedRepo) => {
        const capsuleDir = join(simulatedRepo, "capsules", "run-42");
        mkdirSync(join(simulatedRepo, ".olt"), { recursive: true });
        mkdirSync(capsuleDir, { recursive: true });

        const eventsPath = join(capsuleDir, "events.jsonl");
        const e0 = JSON.stringify({
          timestamp: "2026-08-24T05:00:00.000Z",
          kind: "tool-called",
          tool: "view_file",
        });
        const e1 = JSON.stringify({
          timestamp: "2026-08-24T05:01:00.000Z",
          kind: "tool-called",
          tool: "bun test",
        });
        writeFileSync(eventsPath, `${e0}\n${e1}\n`, "utf-8");

        const r1 = SkillAuditorEngine.auditSkillCompliance(simulatedRepo, {
          capsuleRunRoot: capsuleDir,
          now: "2026-08-24T05:01:30.000Z",
        });
        expect(r1.compliant && r1.eventsAnalyzed === 2 && r1.incidents.length === 0).toBe(true);
        expect(r1.cursor.lastInspectedEventIndex).toBe(1);
        expect(AuditorCursorStore.loadCursor(simulatedRepo, "skill").lastInspectedEventIndex).toBe(
          1,
        );

        const e2 = JSON.stringify({
          timestamp: "2026-08-24T05:02:00.000Z",
          kind: "tool-called",
          tool: "read_resource",
        });
        const e3 = JSON.stringify({
          timestamp: "2026-08-24T05:03:00.000Z",
          type: "boundary_violation",
          error_code: "ROLE_BOUNDARY_DEVIATION",
          message: "Coordinator modified repository source code directly",
        });
        writeFileSync(eventsPath, `${e0}\n${e1}\n${e2}\n${e3}\n`, "utf-8");

        const r2 = SkillAuditorEngine.auditSkillCompliance(simulatedRepo, {
          capsuleRunRoot: capsuleDir,
          now: "2026-08-24T05:03:30.000Z",
        });
        expect(r2.compliant === false && r2.eventsAnalyzed === 2 && r2.incidents.length === 1).toBe(
          true,
        );
        expect(r2.incidents[0]?.category).toBe("ROLE_BOUNDARY_DEVIATION");
        expect(r2.cursor.lastInspectedEventIndex).toBe(3);
        expect(AuditorCursorStore.loadCursor(simulatedRepo, "skill").lastInspectedEventIndex).toBe(
          3,
        );
      });
    });
  });

  describe("Simulation 4: Mandatory Companion Policy Enforcement", () => {
    test("enforces presence of mind-auditor and skill-auditor on long-task target repositories", () => {
      const skillsRepo = "/Users/developer/repos/skills";
      const foreignRepo = "/Users/developer/repos/external-app";
      const grant = (role: string, id: string, parent: string | null = null): AgentGrantRecord => ({
        id,
        role,
        parent_agent_id: parent,
        parent_task_id: null,
        host: "local",
        granted_at: "2026-08-24T00:00:00.000Z",
        status: "active",
      });

      const mindOnly = [grant("mind", "mind-1")];
      const mindWithAuditor = [...mindOnly, grant("mind-auditor", "mind-auditor-1", "mind-1")];
      const orchOnly = [grant("orchestrator", "orch-1")];
      const orchWithAuditor = [...orchOnly, grant("skill-auditor", "skill-auditor-1", "orch-1")];

      expect(() => SkillAuditorPolicy.assertMindAuditorRequired(skillsRepo, mindOnly)).toThrow(
        HarnessError,
      );
      expect(() =>
        SkillAuditorPolicy.assertMindAuditorRequired(foreignRepo, mindOnly),
      ).not.toThrow();
      expect(() =>
        SkillAuditorPolicy.assertMindAuditorRequired(skillsRepo, mindWithAuditor),
      ).not.toThrow();
      expect(() => SkillAuditorPolicy.assertSkillAuditorRequired(skillsRepo, orchOnly)).toThrow(
        HarnessError,
      );
      expect(() =>
        SkillAuditorPolicy.assertSkillAuditorRequired(foreignRepo, orchOnly),
      ).not.toThrow();
      expect(() =>
        SkillAuditorPolicy.assertSkillAuditorRequired(skillsRepo, orchWithAuditor),
      ).not.toThrow();
    });
  });

  describe("Simulation 5: CLI Command Invocations (mind:audit:live & skill:audit:live)", () => {
    test("executes mind:audit:live and skill:audit:live, enforcing <= 30 line limit and valid JSON structure", async () => {
      await withTempDir(async (cliRepo) => {
        const runDir = join(cliRepo, "capsules", "run-1");
        setupMindRepo(cliRepo);
        mkdirSync(runDir, { recursive: true });
        AuditorCursorStore.saveCursor(cliRepo, "mind", {
          lastInspectedTimestamp: new Date().toISOString(),
          lastInspectedEventIndex: 0,
        });

        const mindJson = await mindAuditLiveCommand({ repo: cliRepo, json: true });
        expect(
          typeof mindJson["stagnant"] === "boolean" &&
            typeof mindJson["idle_duration_seconds"] === "number",
        ).toBe(true);

        const mindText = await execute(["mind:audit:live", "--repo", cliRepo]);
        expect(String(mindText["output"]).split("\n").length).toBeLessThanOrEqual(30);

        writeFileSync(
          join(runDir, "events.jsonl"),
          `${JSON.stringify({ kind: "tool-called", tool: "view_file", actor: "dev" })}\n`,
          "utf-8",
        );
        const skillJson = await skillAuditLiveCommand({ repo: cliRepo, run: runDir, json: true });
        expect(
          typeof skillJson["compliant"] === "boolean" &&
            typeof skillJson["events_analyzed"] === "number",
        ).toBe(true);

        const skillText = await execute(["skill:audit:live", "--repo", cliRepo, "--run", runDir]);
        expect(String(skillText["output"]).split("\n").length).toBeLessThanOrEqual(30);
      });
    });
  });

  describe("Simulation 6: Orchestrator Companion Auditor Auto-Dispatch & Forensics", () => {
    test("automatically pairs companion auditor and tracks behavioral forensics per round", async () => {
      await withTempDir(async (simRepo) => {
        mkdirSync(join(simRepo, ".olt"), { recursive: true });
        const pairing = OrchestratorCompanionAuditor.pairCompanion(simRepo);
        expect(pairing.paired && pairing.autoProvisioned).toBe(true);

        const mockExecutor: RoundExecutor = {
          async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
            const ev = {
              type: "boundary_violation",
              message: "Direct edit",
              timestamp: new Date().toISOString(),
            };
            writeFileSync(
              join(input.capsulePath, "events.jsonl"),
              `${JSON.stringify(ev)}\n`,
              "utf-8",
            );
            return {
              runId: input.runId,
              round: input.round,
              status: "completed",
              criticDecision: "approve",
              tasks: [
                { id: "task-1", status: "done", writeScope: ["src/app.ts"], gatePassed: true },
              ],
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
        expect(summary.rounds[0]?.behavioralForensics?.roleBoundaryDeviationsCount).toBe(1);
        expect(summary.rounds[0]?.behavioralForensics?.compliant).toBe(false);
      });
    });
  });

  describe("Static AST Invariants: Zero any and Suppressions", () => {
    test("verifies test file strictly adheres to clean typing standards", () => {
      const content = readFileSync(import.meta.path, "utf-8");
      expect(content).not.toMatch(new RegExp(":[ \\t]*" + "any\\b"));
      expect(content).not.toMatch(new RegExp("\\bas[ \\t]+" + "any\\b"));
      expect(content).not.toMatch(new RegExp("@ts-" + "(ignore|expect-error|nocheck)"));
      expect(content).not.toMatch(new RegExp("(eslint|oxlint)" + "-disable"));
    });
  });
});

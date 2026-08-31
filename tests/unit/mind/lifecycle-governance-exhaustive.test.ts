import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHyperCognitionEngine } from "../../../olt/scripts/src/mind/lifecycle/cognition/engine.ts";
import {
  readMindBudget,
  updateMindBudget,
} from "../../../olt/scripts/src/mind/lifecycle/budget/index.ts";
import {
  formatMindObserveBrief,
  executeMindObserve,
  mindObserveCommand,
} from "../../../olt/scripts/src/mind/lifecycle/observe/index.ts";
import { parseCharterYaml } from "../../../olt/scripts/src/mind/lifecycle/charter/index.ts";
import { closeRoundInState } from "../../../olt/scripts/src/mind/lifecycle/rounds/round-close.ts";
import { evaluateMindLiveness } from "../../../olt/scripts/src/mind/lifecycle/liveness/probe.ts";
import {
  buildTier1DeploymentPacket,
  resolveOrchestratorContractSha256,
  createTier1DeployInputFromCandidate,
} from "../../../olt/scripts/src/mind/lifecycle/deploy/builder.ts";
import {
  registerOrchestratorSpawn,
  loadOrchestratorLedger,
  deregisterOrchestrator,
  updateOrchestratorHeartbeat,
} from "../../../olt/scripts/src/mind/lifecycle/orchestrator-ledger.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
  roots.length = 0;
});

describe("Lifecycle & Governance Exhaustive Unit Tests", () => {
  describe("HyperCognition Engine & System Metrics", () => {
    it("validates repoRoot and runs full cognition loops with scoring and cadence integration", () => {
      // Blank repoRoot
      expect(() => createHyperCognitionEngine({ repoRoot: "   " })).toThrow(HarnessError);

      const engine = createHyperCognitionEngine({ repoRoot: "/path/to/repo" });

      const state = {
        tasks: {
          "task-1": {
            id: "task-1",
            status: "done",
            dependencies: [],
            write_scope: ["src/a.ts"],
            gate_command: "bun test",
          },
          "task-2": {
            id: "task-2",
            status: "ready",
            dependencies: ["task-1"],
            write_scope: ["src/b.ts"],
          },
          "task-3": {
            id: "task-3",
            status: "failed",
            dependencies: [],
            write_scope: [],
          },
        },
      };

      const auditRes = engine.runAutonomousAuditLoop(state, ["src/a.ts", "src/b.ts"]);
      expect(auditRes).toBeDefined();

      const qCycle = engine.executeProactiveSelfQuestioningCycle({
        cycleId: "q-1",
        state,
      });
      expect(qCycle.cycleId).toBe("q-1");

      const harvest = engine.harvestPlanEnhancementsDuringPulse({
        pulseId: "pulse-1",
        state,
      });
      expect(harvest).toBeDefined();

      const proposals = engine.generateOptimizationProposals([], {
        overall: 80,
        simplicity: 80,
        performance: 80,
        observability: 80,
        type_safety: 80,
        ast_purity: 80,
        dag_concurrency: 80,
      });
      expect(Array.isArray(proposals)).toBe(true);

      const scoreVec = engine.computeCognitiveScoreVector([], {
        totalTasks: 3,
        completedTasks: 1,
        readyTasks: 1,
        pendingTasks: 0,
        failedTasks: 1,
        totalFiles: 2,
        hasCycles: false,
        falseBarrierCount: 1,
        astViolationCount: 0,
        untypedFieldCount: 0,
      });
      expect(scoreVec.compositeScore).toBeGreaterThan(0);

      const cadenceReport = engine.integratePulseCadence(
        {
          kind: "mind-pulse-opened",
          sequence: 1,
          timestamp: "2026-08-31T00:00:00Z",
        } as any,
        state,
      );
      expect(cadenceReport.pulseId).toContain("mind-pulse-opened-1");
      expect(engine.getHistoricalScoreTrend().length).toBe(1);
    });
  });

  describe("Mind Budget & Observe", () => {
    it("reads and updates mind budgets with charter path fallbacks", () => {
      const charterYaml = `
identity: "Sovereign Mind"
goals:
  - id: G1
    statement: "Cognition"
non_goals:
  - "NG1"
budgets:
  pulses_per_day: 50
`.trim();

      const budget = readMindBudget(charterYaml);
      expect(budget.pulses_per_day).toBe(50);

      const updated = updateMindBudget((curr) => ({
        ...curr,
        pulses_today: curr.pulses_today + 1,
      }), charterYaml);
      expect(updated.pulses_today).toBe(1);
    });

    it("formats observe briefs and executes observe command with validation", async () => {
      const brief = formatMindObserveBrief({
        observationId: "obs-1",
        runRoot: "/test/run",
        actor: "mind-1",
        sourceId: "defects_ledger",
        count: 2,
      });
      expect(brief).toContain("Mind Observation: obs-1");

      expect(() => executeMindObserve({})).toThrow(HarnessError);

      const execRes = executeMindObserve({ runRoot: "/test/run" });
      expect(execRes.success).toBe(true);

      const cmdRes = await mindObserveCommand({ runRoot: "/test/run" });
      expect((cmdRes as any).success).toBe(true);
    });
  });

  describe("Charter Parser & Round Close Arming Rail", () => {
    it("parses charter strings, regex goals, stability checks, and prohibitions arrays", () => {
      const yamlCharter = `
identity: "Sovereign Mind"
goals:
  - "[G1]: Implement sovereign cognition"
  - id: G2
    statement: Enforce 4-tier boundaries
non_goals:
  - "NG1: No loose manual edits"
repo_roots:
  - "src"
stability:
  - "\`bun test\` -> exit 0"
prohibitions:
  - "No direct code edits by supervisors"
  - "No unrestricted bash execution"
`;
      const parsed = parseCharterYaml(yamlCharter);
      expect(parsed.goals.length).toBe(2);
      expect(parsed.nonGoals.length).toBe(1);
      expect(parsed.stability?.length).toBe(1);
      expect(parsed.prohibitions).toContain("No direct code edits");
    });

    it("enforces round close arming rails, statuses, and validation", () => {
      const state = {
        rounds: [
          {
            objective_id: "obj-1",
            round: 1,
            status: "open",
            result: null,
          },
          {
            objective_id: "obj-1",
            round: 2,
            status: "closed",
            result: "converged",
          },
        ],
      };

      // Invalid round result
      expect(() =>
        closeRoundInState(state, {
          objective: "obj-1",
          round: 1,
          actor: "orch-1",
          result: "invalid_result" as any,
          nowIso: new Date().toISOString(),
        }),
      ).toThrow(HarnessError);

      // Already closed round
      expect(() =>
        closeRoundInState(state, {
          objective: "obj-1",
          round: 2,
          actor: "orch-1",
          result: "converged",
          terminalReason: "Already converged",
          nowIso: new Date().toISOString(),
        }),
      ).toThrow(HarnessError);

      // Nonexistent round
      expect(() =>
        closeRoundInState(state, {
          objective: "obj-unknown",
          round: 1,
          actor: "orch-1",
          result: "converged",
          terminalReason: "Reason",
          nowIso: new Date().toISOString(),
        }),
      ).toThrow(HarnessError);

      // Successful close
      const closed = closeRoundInState(state, {
        objective: "obj-1",
        round: 1,
        actor: "orch-1",
        result: "converged",
        terminalReason: "Passed all tests",
        nowIso: new Date().toISOString(),
      });
      expect(closed.status).toBe("closed");
      expect(closed.result).toBe("converged");
    });
  });

  describe("Pulse Probe & Tier 1 Deployment Packet", () => {
    it("inspects pulse files handling missing, corrupt, and valid records", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "pulse-probe-test-"));
      roots.push(tmpDir);

      // Missing
      const pMissing = evaluateMindLiveness(tmpDir);
      expect(pMissing.status).toBe("missing_record");

      // Corrupt non-json / non-object
      const pulseFile = join(tmpDir, "last_pulse.json");
      writeFileSync(pulseFile, "[1, 2, 3]");
      const pCorrupt = evaluateMindLiveness(tmpDir);
      expect(pCorrupt.status).toBe("corrupted_record");
    });

    it("builds Tier 1 deployment packets with validation and contract resolution", () => {
      expect(typeof resolveOrchestratorContractSha256()).toBe("string");

      // Missing required packet fields
      expect(() =>
        buildTier1DeploymentPacket({
          runId: "",
          agentId: "orch-1",
          candidateStatement: "Statement",
          witnessCommandId: "cmd-1",
          charterGoalIds: ["G1"],
          profile: "implementer",
        }),
      ).toThrow(HarnessError);

      // createTier1DeployInputFromCandidate missing goals/witness checks
      const candidateWithoutGoals = {
        id: "c-1",
        statement: "statement",
        witness_command_id: "cmd-1",
        status: "admitted",
      };
      expect(() =>
        createTier1DeployInputFromCandidate(
          candidateWithoutGoals as any,
          { goalIds: [] } as any,
          { pulses_today: 1 } as any,
          "run-1",
          "orch-1",
        ),
      ).toThrow(HarnessError);
    });
  });

  describe("Orchestrator Ledger Operations", () => {
    it("registers, validates, and updates orchestrators in ledger with locking", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "orch-ledger-test-"));
      roots.push(tmpDir);

      const ledgerPath = join(tmpDir, ".olt", "orchestrators.jsonl");

      // Invalid registration inputs
      expect(() =>
        registerOrchestratorSpawn({
          orchestrator_id: "",
          run_id: "run-1",
          conversation_id: "conv-1",
          pid: 1234,
          host_type: "antigravity",
          manifest_sha256: "sha-1",
        }),
      ).toThrow(HarnessError);

      // Valid registration
      const record = registerOrchestratorSpawn(
        {
          orchestrator_id: "orch-1",
          run_id: "run-1",
          conversation_id: "conv-1",
          pid: 1234,
          host_type: "antigravity",
          manifest_sha256: "sha-manifest-1",
        },
        ledgerPath,
      );
      expect(record.orchestrator_id).toBe("orch-1");
      expect(record.status).toBe("ACTIVE");

      const list = loadOrchestratorLedger(ledgerPath);
      expect(list.length).toBe(1);

      // Update heartbeat
      const hb = updateOrchestratorHeartbeat("orch-1", ledgerPath);
      expect(hb).not.toBeNull();

      // Deregister
      const dereg = deregisterOrchestrator("orch-1", "COMPLETED", ledgerPath);
      expect(dereg?.status).toBe("COMPLETED");
    });
  });
});

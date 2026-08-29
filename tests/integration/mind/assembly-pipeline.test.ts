import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clusterBacklogAndDefects,
  loadBacklogItems,
  loadDefectItems,
} from "../../../olt/scripts/src/mind/preplanning/backlog-clusterer.ts";
import { runPreplanningTick } from "../../../olt/scripts/src/mind/preplanning/continuous-preplanner.ts";
import { auditMindPreplanningStagnation } from "../../../olt/scripts/src/mind/auditing/mind-stagnation-auditor.ts";
import { auditSkillConcurrencySaturation } from "../../../olt/scripts/src/mind/auditing/skill-concurrency-auditor.ts";
import {
  assessTaskStraggler,
  evaluateActiveTasks,
  TASK_STRAGGLER_OVERBURDEN_DEFECT,
  type MonitoredTask,
} from "../../../olt/scripts/src/watchdog/straggler-watchdog.ts";
import {
  calculateBrentDecomposition,
  rebalanceStragglerTask,
} from "../../../olt/scripts/src/orchestrator/velocity-rebalancer.ts";
import {
  AssemblyStationRegistry,
  claimStation,
  createStation,
  landStation,
  verifyStation,
} from "../../../olt/scripts/src/orchestrator/station-landing.ts";
import {
  getAllHostSchedulers,
  getHostSchedulerConfig,
  isHighThinkingEnforced,
  resolveModelForTier,
} from "../../../olt/scripts/src/orchestrator/host-schedulers.ts";
import {
  factoryPreplanCommand,
  factoryStatusCommand,
} from "../../../olt/scripts/src/cli/commands/factory-ops.ts";

describe("Mind Continuous Pre-Planning Engine & Asynchronous Assembly Pipeline End-to-End Integration (Task 4.2)", () => {
  it("orchestrates the complete preplanning lifecycle, multi-station landing, straggler SLA, and active auditing", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "assembly-pipeline-e2e-"));
    try {
      const oltDir = join(tempDir, ".olt");
      mkdirSync(oltDir, { recursive: true });
      const backlogFile = join(oltDir, "backlog.jsonl");
      const defectsFile = join(oltDir, "defects.jsonl");

      // ─── STEP 1: INITIALIZE UNPLANNED QUEUES ─────────────────────────────
      writeFileSync(
        backlogFile,
        JSON.stringify({
          id: "fb-mind-engine",
          title: "Mind continuous preplanning autonomous loop",
          category: "mind",
          status: "PENDING",
        }) +
          "\n" +
          JSON.stringify({
            id: "fb-core-domain",
            title: "Core domain immutable data models",
            category: "core",
            status: "PENDING",
          }) +
          "\n" +
          JSON.stringify({
            id: "fb-validation-suite",
            title: "Verification test suite and assertions",
            category: "validation",
            status: "PENDING",
          }) +
          "\n" +
          JSON.stringify({
            id: "fb-tooling-cli",
            title: "CLI factory ops and status commands",
            category: "tooling",
            status: "PENDING",
          }) +
          "\n",
      );

      writeFileSync(
        defectsFile,
        JSON.stringify({
          id: "def-mind-stagnation",
          title: "Mind pulse stagnation blunder",
          error_code: "MIND_PREPLANNING_STAGNATION",
          category: "mind",
          status: "OPEN",
        }) + "\n",
      );

      // ─── STEP 2: AUDIT INITIAL PRE-PLANNING STAGNATION ───────────────────
      const initialAudit = auditMindPreplanningStagnation({
        rootDir: tempDir,
        backlogFile,
        defectsFile,
        lastPreplanTimestamp: null,
      });

      expect(initialAudit.is_stagnant).toBe(true);
      expect(initialAudit.pending_backlog_count).toBe(4);
      expect(initialAudit.open_defects_count).toBe(1);
      expect(initialAudit.recommended_remediation).toBe("RUN_PREPLANNING_FACTORY");

      // ─── STEP 3: RUN CONTINUOUS PRE-PLANNING FACTORY ──────────────────────
      const preplanResult = runPreplanningTick({
        rootDir: tempDir,
        backlogFile,
        defectsFile,
      });

      expect(preplanResult.clusters.length).toBe(4); // mind, core, validation, tooling
      expect(preplanResult.items_planned).toBe(4);
      expect(preplanResult.defects_planned).toBe(1);
      expect(preplanResult.plan_files_written.length).toBe(4);

      // Verify plans written to disk
      for (const planPath of preplanResult.plan_files_written) {
        expect(existsSync(planPath)).toBe(true);
        const planMd = readFileSync(planPath, "utf-8");
        expect(planMd).toContain("Master Plan");
        expect(planMd).toContain("PHASE 1 - EXHAUSTIVE ARCHITECTURAL SPECIFICATION");
        expect(planMd).toContain("Exhaustive Traceability Matrix");
      }

      // ─── STEP 4: RE-AUDIT STAGNATION (SHOULD NOW BE CLEAN & ZERO-IDLE) ────
      const postPreplanAudit = auditMindPreplanningStagnation({
        rootDir: tempDir,
        backlogFile,
        defectsFile,
        lastPreplanTimestamp: preplanResult.completed_at,
      });

      expect(postPreplanAudit.is_stagnant).toBe(false);
      expect(postPreplanAudit.pending_backlog_count).toBe(0);
      expect(postPreplanAudit.open_defects_count).toBe(0);

      // ─── STEP 5: ASYNCHRONOUS MULTI-STATION ASSEMBLY PIPELINE ────────────
      const registry = new AssemblyStationRegistry();
      const mockGitRunner = (cmd: string): string => {
        if (cmd.startsWith("git diff --cached")) return "staged_file.ts";
        if (cmd.startsWith("git write-tree")) return "mock_index_sha_4b825dc642cb";
        return "";
      };

      const stationCore = createStation("station-core", "core", "milestone-1", ["src/core.ts"]);
      const stationVal = createStation("station-val", "validation", "milestone-1", [
        "tests/val.ts",
      ]);
      const stationTool = createStation("station-tool", "tooling", "milestone-1", ["src/tool.ts"]);
      const stationMind = createStation("station-mind", "mind", "milestone-1", ["src/mind.ts"]);

      registry.registerStation(stationCore);
      registry.registerStation(stationVal);
      registry.registerStation(stationTool);
      registry.registerStation(stationMind);

      // Claim all stations
      const claimedCore = claimStation(stationCore);
      const claimedVal = claimStation(stationVal);
      const claimedTool = claimStation(stationTool);
      const claimedMind = claimStation(stationMind);

      registry.updateStation(claimedCore);
      registry.updateStation(claimedVal);
      registry.updateStation(claimedTool);
      registry.updateStation(claimedMind);

      // ─── STEP 6: 5-MINUTE STRAGGLER WATCHDOG & BRENT DECOMPOSITION ────────
      const baseNow = Date.now();
      const activeTasks: readonly MonitoredTask[] = [
        {
          id: "task-normal-core",
          status: "RUNNING",
          claimed_at: baseNow - 120_000, // 2m (healthy)
        },
        {
          id: "task-straggler-tool",
          status: "RUNNING",
          claimed_at: baseNow - 360_000, // 6m (> 5m SLA breached!)
          scope_files: [
            "src/c1.ts",
            "src/c2.ts",
            "src/c3.ts",
            "src/c4.ts",
            "src/c5.ts",
            "src/c6.ts",
          ],
          work_units: 6,
          span_length: 1,
        },
      ];

      const watchdogReport = evaluateActiveTasks(activeTasks, baseNow);
      expect(watchdogReport.straggler_count).toBe(1);
      expect(watchdogReport.stragglers[0].task_id).toBe("task-straggler-tool");
      expect(watchdogReport.stragglers[0].is_straggler).toBe(true);
      expect(watchdogReport.stragglers[0].recommended_action).toBe("DECOMPOSE_PARALLEL");

      const decompositionPlan = watchdogReport.stragglers[0].decomposition_plan!;
      expect(decompositionPlan.optimal_parallelism).toBeGreaterThanOrEqual(5);

      // Rebalance straggler task into parallel sub-lanes
      const rebalanced = rebalanceStragglerTask({
        id: "task-straggler-tool",
        scope_files: ["src/c1.ts", "src/c2.ts", "src/c3.ts", "src/c4.ts", "src/c5.ts", "src/c6.ts"],
        work_units: 6,
      });

      expect(rebalanced.spawned_subtasks.length).toBeGreaterThanOrEqual(5);
      expect(
        rebalanced.spawned_subtasks.every((s) => s.priority === "HIGH_STRAGGLER_REBALANCE"),
      ).toBe(true);

      // ─── STEP 7: VERIFY AND LAND STATIONS WITH GIT STAGING INVARIANT ─────
      const { station: landedCore } = landStation(verifyStation(claimedCore), {
        customGitRunner: mockGitRunner,
      });
      const { station: landedVal } = landStation(verifyStation(claimedVal), {
        customGitRunner: mockGitRunner,
      });
      const { station: landedTool } = landStation(verifyStation(claimedTool), {
        customGitRunner: mockGitRunner,
      });
      const { station: landedMind } = landStation(verifyStation(claimedMind), {
        customGitRunner: mockGitRunner,
      });

      registry.updateStation(landedCore);
      registry.updateStation(landedVal);
      registry.updateStation(landedTool);
      registry.updateStation(landedMind);

      const pipelineStatus = registry.getStatus();
      expect(pipelineStatus.is_all_landed).toBe(true);
      expect(pipelineStatus.landed_stations).toBe(4);

      // ─── STEP 8: SKILL CONCURRENCY SATURATION AUDIT ───────────────────────
      const finalConcurrencyAudit = auditSkillConcurrencySaturation({
        activeStations: registry.getAllStations(),
      });

      expect(finalConcurrencyAudit.unstaged_stations.length).toBe(0);
      expect(finalConcurrencyAudit.findings.some((f) => f.includes("fully saturated"))).toBe(true);

      // ─── STEP 9: HOST SCHEDULERS MATRIX ROUTING ──────────────────────────
      const hosts = getAllHostSchedulers();
      expect(hosts.length).toBe(4);
      for (const host of hosts) {
        expect(isHighThinkingEnforced(host)).toBe(true);
        expect(host.max_single_task_seconds).toBeLessThanOrEqual(300);
      }

      const tier0Model = resolveModelForTier("antigravity", "tier_0_2");
      expect(tier0Model.model).toBe("gemini-3.7-flash");
      expect(tier0Model.thinking).toBe("high");

      // ─── STEP 10: CLI OPERATIONS VERIFICATION ────────────────────────────
      const cliStatus = factoryStatusCommand({ root: tempDir });
      expect(cliStatus.status.pending_backlog).toBe(0);
      expect(cliStatus.status.open_defects).toBe(0);
      expect(cliStatus.status.is_stagnant).toBe(false);
      expect(cliStatus.markdown).toContain("Factory Engine & Assembly Pipeline Status");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

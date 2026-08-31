import { describe, expect, it } from "bun:test";
import {
  clusterBacklogAndDefects,
  filterEligibleBacklogItems,
  filterEligibleDefects,
} from "../../../olt/scripts/src/mind/preplanning/backlog-clusterer.ts";
import {
  isPreplanningNeeded,
  runPreplanningTick,
} from "../../../olt/scripts/src/mind/preplanning/continuous-preplanner.ts";
import {
  assertValidBlueprintStructure,
  generatePlanMarkdown,
} from "../../../olt/scripts/src/mind/preplanning/plan-factory.ts";
import { auditMindPreplanningStagnation } from "../../../olt/scripts/src/mind/auditing/mind-stagnation-auditor.ts";
import { auditSkillConcurrencySaturation } from "../../../olt/scripts/src/mind/auditing/skill-concurrency-auditor.ts";
import {
  evaluateActiveTasks,
  type MonitoredTask,
} from "../../../olt/scripts/src/watchdog/straggler-watchdog.ts";
import { rebalanceStragglerTask } from "../../../olt/scripts/src/orchestrator/velocity-rebalancer.ts";
import {
  AssemblyStationRegistry,
  claimStation,
  createStation,
  landStation,
  verifyStation,
} from "../../../olt/scripts/src/orchestrator/station-landing.ts";
import {
  getAllHostSchedulers,
  isHighThinkingEnforced,
  resolveModelForTier,
} from "../../../olt/scripts/src/orchestrator/host-schedulers.ts";
import {
  formatFactoryPreplanBrief,
  formatFactoryStatusBrief,
} from "../../../olt/scripts/src/cli/commands/factory-ops.ts";
import type {
  RawBacklogItem,
  RawDefectItem,
} from "../../../olt/scripts/src/mind/preplanning/types.ts";

describe("Mind Continuous Pre-Planning Engine & In-Memory Assembly Pipeline", () => {
  const initialBacklog: readonly RawBacklogItem[] = [
    { id: "fb-mind-engine", title: "Mind loop", category: "mind", status: "PENDING" },
    { id: "fb-core-domain", title: "Core models", category: "core", status: "PENDING" },
    {
      id: "fb-validation-suite",
      title: "Validation suite",
      category: "validation",
      status: "PENDING",
    },
    { id: "fb-tooling-cli", title: "CLI factory ops", category: "tooling", status: "PENDING" },
  ];

  const initialDefects: readonly RawDefectItem[] = [
    {
      id: "def-mind-stagnation",
      title: "Mind pulse stagnation blunder",
      error_code: "MIND_PREPLANNING_STAGNATION",
      category: "mind",
      status: "OPEN",
    },
  ];

  it("orchestrates the complete zero-disk in-memory preplanning lifecycle and assembly pipeline", () => {
    const baseNow = 1_700_000_000_000;

    // STEP 1 & 2: IN-MEMORY STAGNATION AUDIT
    const initialAudit = auditMindPreplanningStagnation({
      explicitBacklog: initialBacklog,
      explicitDefects: initialDefects,
      lastPreplanTimestamp: null,
      nowMs: baseNow,
    });
    expect(initialAudit.is_stagnant).toBe(true);
    expect(initialAudit.pending_backlog_count).toBe(4);
    expect(initialAudit.open_defects_count).toBe(1);
    expect(initialAudit.recommended_remediation).toBe("RUN_PREPLANNING_FACTORY");

    // STEP 3: DETERMINISTIC IN-MEMORY PRE-PLANNING TICK
    const preplanResult = runPreplanningTick({
      dryRun: true,
      explicitBacklog: initialBacklog,
      explicitDefects: initialDefects,
    });
    expect(preplanResult.clusters.length).toBe(4);
    expect(preplanResult.items_planned).toBe(4);
    expect(preplanResult.defects_planned).toBe(1);
    expect(preplanResult.plan_files_written.length).toBe(4);

    // Validate generated markdown blueprints in-memory without filesystem I/O
    for (const cluster of preplanResult.clusters) {
      const planMd = generatePlanMarkdown(cluster, initialBacklog, initialDefects);
      expect(assertValidBlueprintStructure(planMd)).toBe(true);
      expect(planMd).toContain("Master Plan");
      expect(planMd).toContain("PHASE 1 - EXHAUSTIVE ARCHITECTURAL SPECIFICATION");
      expect(planMd).toContain("Exhaustive Traceability Matrix");
    }

    // STEP 4: RE-AUDIT STAGNATION WITH PLANNED IN-MEMORY STATE
    const plannedBacklog: readonly RawBacklogItem[] = initialBacklog.map((item) => ({
      ...item,
      status: "PLANNED",
      planned_at: preplanResult.completed_at,
    }));
    const plannedDefects: readonly RawDefectItem[] = initialDefects.map((defect) => ({
      ...defect,
      status: "PLANNED",
      planned_at: preplanResult.completed_at,
    }));

    const postPreplanAudit = auditMindPreplanningStagnation({
      explicitBacklog: plannedBacklog,
      explicitDefects: plannedDefects,
      lastPreplanTimestamp: preplanResult.completed_at,
      nowMs: baseNow + 1_000,
    });
    expect(postPreplanAudit.is_stagnant).toBe(false);
    expect(postPreplanAudit.pending_backlog_count).toBe(0);
    expect(postPreplanAudit.open_defects_count).toBe(0);

    // STEP 5: ASYNCHRONOUS MULTI-STATION ASSEMBLY PIPELINE
    const registry = new AssemblyStationRegistry();
    const mockGitRunner = (cmd: string): string => {
      if (cmd.startsWith("git diff --cached")) return "staged_file.ts";
      if (cmd.startsWith("git write-tree")) return "mock_index_sha_4b825dc642cb";
      return "";
    };

    const stationCore = createStation("station-core", "core", "milestone-1", ["src/core.ts"]);
    const stationVal = createStation("station-val", "validation", "milestone-1", ["tests/val.ts"]);
    const stationTool = createStation("station-tool", "tooling", "milestone-1", ["src/tool.ts"]);
    const stationMind = createStation("station-mind", "mind", "milestone-1", ["src/mind.ts"]);

    registry.registerStation(stationCore);
    registry.registerStation(stationVal);
    registry.registerStation(stationTool);
    registry.registerStation(stationMind);

    const claimedCore = claimStation(stationCore);
    const claimedVal = claimStation(stationVal);
    const claimedTool = claimStation(stationTool);
    const claimedMind = claimStation(stationMind);

    registry.updateStation(claimedCore);
    registry.updateStation(claimedVal);
    registry.updateStation(claimedTool);
    registry.updateStation(claimedMind);

    // STEP 6: 5-MINUTE STRAGGLER WATCHDOG & BRENT DECOMPOSITION
    const activeTasks: readonly MonitoredTask[] = [
      { id: "task-normal-core", status: "RUNNING", claimed_at: baseNow - 120_000 },
      {
        id: "task-straggler-tool",
        status: "RUNNING",
        claimed_at: baseNow - 360_000,
        scope_files: ["src/c1.ts", "src/c2.ts", "src/c3.ts", "src/c4.ts", "src/c5.ts", "src/c6.ts"],
        work_units: 6,
        span_length: 1,
      },
    ];

    const watchdogReport = evaluateActiveTasks(activeTasks, baseNow);
    expect(watchdogReport.straggler_count).toBe(1);
    expect(watchdogReport.stragglers[0].task_id).toBe("task-straggler-tool");
    expect(watchdogReport.stragglers[0].is_straggler).toBe(true);
    expect(watchdogReport.stragglers[0].recommended_action).toBe("DECOMPOSE_PARALLEL");

    const decompositionPlan = watchdogReport.stragglers[0].decomposition_plan;
    expect(decompositionPlan).toBeDefined();
    expect(decompositionPlan?.optimal_parallelism).toBeGreaterThanOrEqual(5);

    const rebalanced = rebalanceStragglerTask({
      id: "task-straggler-tool",
      scope_files: ["src/c1.ts", "src/c2.ts", "src/c3.ts", "src/c4.ts", "src/c5.ts", "src/c6.ts"],
      work_units: 6,
    });
    expect(rebalanced.spawned_subtasks.length).toBeGreaterThanOrEqual(5);
    expect(
      rebalanced.spawned_subtasks.every((s) => s.priority === "HIGH_STRAGGLER_REBALANCE"),
    ).toBe(true);

    // STEP 7: VERIFY AND LAND STATIONS WITH GIT STAGING INVARIANT
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

    // STEP 8: SKILL CONCURRENCY SATURATION AUDIT
    const finalConcurrencyAudit = auditSkillConcurrencySaturation({
      activeStations: registry.getAllStations(),
    });
    expect(finalConcurrencyAudit.unstaged_stations.length).toBe(0);
    expect(finalConcurrencyAudit.findings.some((f) => f.includes("fully saturated"))).toBe(true);

    // STEP 9: HOST SCHEDULERS MATRIX ROUTING
    const hosts = getAllHostSchedulers();
    expect(hosts.length).toBe(4);
    for (const host of hosts) {
      expect(isHighThinkingEnforced(host)).toBe(true);
      expect(host.max_single_task_seconds).toBeLessThanOrEqual(300);
    }

    const tier0Model = resolveModelForTier("antigravity", "tier_0_2");
    expect(tier0Model.model).toBe("gemini-3.7-flash");
    expect(tier0Model.thinking).toBe("high");

    // STEP 10: CLI BRIEF FORMATTING VERIFICATION
    const preplanBrief = formatFactoryPreplanBrief(preplanResult);
    expect(preplanBrief).toContain("Continuous Pre-Planning Factory Run Summary");
    expect(preplanBrief).toContain("**Clusters Created**: 4");
    expect(preplanBrief).toContain("**Backlog Items Planned**: 4");
    expect(preplanBrief).toContain("**Defects Planned**: 1");

    const statusBrief = formatFactoryStatusBrief({
      pending_backlog: 0,
      open_defects: 0,
      is_stagnant: false,
      is_concurrency_saturated: true,
      preplanning_needed: false,
      findings: ["All assembly stations verified and landed."],
    });
    expect(statusBrief).toContain("Factory Engine & Assembly Pipeline Status");
    expect(statusBrief).toContain("**Pending Backlog Items**: 0");
    expect(statusBrief).toContain("**Open Defects**: 0");
    expect(statusBrief).toContain("**Mind Auditor Stagnation**: HEALTHY");
  });

  it("handles empty queues and item filtering deterministically in memory", () => {
    expect(isPreplanningNeeded({ explicitBacklog: [], explicitDefects: [] })).toBe(false);
    const emptyResult = runPreplanningTick({
      dryRun: true,
      explicitBacklog: [],
      explicitDefects: [],
    });
    expect(emptyResult.clusters.length).toBe(0);
    expect(emptyResult.items_planned).toBe(0);
    expect(emptyResult.defects_planned).toBe(0);

    const filteredBacklog = filterEligibleBacklogItems([
      { id: "b1", status: "PLANNED" },
      { id: "b2", status: "COMPLETED" },
      { id: "b3", status: "PENDING" },
    ]);
    expect(filteredBacklog.length).toBe(1);
    expect(filteredBacklog[0].id).toBe("b3");

    const filteredDefects = filterEligibleDefects([
      { id: "d1", status: "RESOLVED" },
      { id: "d2", status: "CLOSED" },
      { id: "d3", status: "OPEN" },
    ]);
    expect(filteredDefects.length).toBe(1);
    expect(filteredDefects[0].id).toBe("d3");
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessTaskStraggler,
  assessTaskStragglerStatus,
  evaluateActiveTasks,
  TASK_STRAGGLER_OVERBURDEN_DEFECT,
  type MonitoredTask,
  type StragglerAssessment,
  type StragglerWatchdogReport,
} from "../../../olt/scripts/src/watchdog/straggler-watchdog.ts";
import {
  rebalanceStragglerTask,
  type BrentConcurrencyPlan,
  type RebalancedTaskPackage,
  type StragglingTask,
} from "../../../olt/scripts/src/orchestrator/velocity-rebalancer.ts";
import {
  assertHostThinkingPolicy,
  getAllHostSchedulers,
  getHostSchedulerConfig,
  resolveModelForTier,
  validateHostSchedulerConfig,
} from "../../../olt/scripts/src/orchestrator/host-schedulers.ts";
import {
  auditConcurrencySaturation,
  auditSkillConcurrencySaturation,
  SKILL_CONCURRENCY_UNDER_SATURATED,
  type ConcurrencyAuditResult,
  type ConcurrencySaturationReport,
} from "../../../olt/scripts/src/mind/auditing/skill-concurrency-auditor.ts";
import type {
  AssemblyStation,
  RawDefectItem,
} from "../../../olt/scripts/src/mind/preplanning/types.ts";

describe("5-Minute Straggler SLA & Brent Concurrency Engine E2E Suite (Wave 4)", () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (dir && existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {}
      }
    }
  });

  const t0 = 1756460000000;
  const scopeFiles = Object.freeze([
    "src/modules/auth.ts",
    "src/modules/session.ts",
    "src/modules/token.ts",
    "src/modules/rbac.ts",
    "src/modules/crypto.ts",
    "src/modules/storage.ts",
    "src/modules/network.ts",
    "src/modules/logger.ts",
  ]);

  it("detects monolithic worker stall at t=305s, emits SLA defect, and executes Brent decomposition into 8 disjoint sub-lanes", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "straggler-e2e-defects-"));
    cleanupDirs.push(tempDir);
    const defectsFile = join(tempDir, "defects.jsonl");

    const monolithicTask: MonitoredTask = {
      id: "task-monolith-001",
      agent_id: "agent-overburdened-worker",
      status: "RUNNING",
      claimed_at: t0,
      scope_files: scopeFiles,
      work_units: 8,
      span_length: 1,
    };

    // 1. Evaluate at t = 305s (> 300s SLA, silence = 305s > 120s)
    const report: StragglerWatchdogReport = evaluateActiveTasks([monolithicTask], t0 + 305_000, {
      recordDefects: true,
      defectsFilePath: defectsFile,
    });

    expect(report.evaluated_count).toBe(1);
    expect(report.straggler_count).toBe(1);
    expect(report.healthy_count).toBe(0);

    const assessment: StragglerAssessment = report.stragglers[0]!;
    expect(assessment.task_id).toBe("task-monolith-001");
    expect(assessment.agent_id).toBe("agent-overburdened-worker");
    expect(assessment.is_straggler).toBe(true);
    expect(assessment.elapsed_seconds).toBe(305);
    expect(assessment.recommended_action).toBe("DECOMPOSE_PARALLEL");

    // Defect verification
    expect(report.defects_emitted).toHaveLength(1);
    const defect: RawDefectItem = report.defects_emitted[0]!;
    expect(defect.error_code).toBe(TASK_STRAGGLER_OVERBURDEN_DEFECT);
    expect(defect.severity).toBe("high");
    expect(existsSync(defectsFile)).toBe(true);
    const persistedLines = readFileSync(defectsFile, "utf-8").trim().split("\n");
    expect(persistedLines).toHaveLength(1);
    const persistedDefect = JSON.parse(persistedLines[0]!) as RawDefectItem;
    expect(persistedDefect.error_code).toBe(TASK_STRAGGLER_OVERBURDEN_DEFECT);

    // 2. Brent Decomposition & Rebalancing (P = clamp(ceil(8/1), 5, 15) = 8)
    const stragglerInput: StragglingTask = {
      id: monolithicTask.id,
      agent_id: monolithicTask.agent_id,
      scope_files: monolithicTask.scope_files,
      work_units: monolithicTask.work_units,
      span_length: monolithicTask.span_length,
    };

    const rebalancePkg: RebalancedTaskPackage = rebalanceStragglerTask(stragglerInput);
    expect(rebalancePkg.original_task_id).toBe("task-monolith-001");
    expect(rebalancePkg.spawned_subtasks).toHaveLength(8);

    const plan: BrentConcurrencyPlan = rebalancePkg.decomposition_plan;
    expect(plan.optimal_parallelism).toBe(8);
    expect(plan.active_workers).toBe(8);
    expect(plan.sub_partitions).toHaveLength(8);
    expect(plan.estimated_subagent_duration_seconds).toBe(180);
    expect(plan.estimated_subagent_duration_seconds).toBeGreaterThanOrEqual(120);
    expect(plan.estimated_subagent_duration_seconds).toBeLessThanOrEqual(240);

    // Verify 100% disjoint assigned scopes across all 8 sub-lanes
    const assignedFiles = plan.sub_partitions.flatMap((p) => p.assigned_scope);
    expect(assignedFiles).toHaveLength(8);
    expect(new Set(assignedFiles).size).toBe(8);
    for (const originalFile of scopeFiles) expect(assignedFiles).toContain(originalFile);

    for (let i = 0; i < plan.sub_partitions.length; i++) {
      for (let j = i + 1; j < plan.sub_partitions.length; j++) {
        const p1 = plan.sub_partitions[i]!;
        const p2 = plan.sub_partitions[j]!;
        const overlap = p1.assigned_scope.filter((f) => p2.assigned_scope.includes(f));
        expect(overlap).toHaveLength(0);
      }
    }
  });

  it("validates host schedulers matrix thinking enforcement and model tier resolution", () => {
    const allHosts = getAllHostSchedulers();
    expect(allHosts).toHaveLength(4);

    for (const host of allHosts) {
      assertHostThinkingPolicy(host);
      const validation = validateHostSchedulerConfig(host);
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(host.max_single_task_seconds).toBe(300);
    }

    const hostExpectations: Record<string, { cadence: number; t02: string; t3: string }> = {
      antigravity: { cadence: 300, t02: "gemini-3.7-flash", t3: "gemini-3.7-flash" },
      claude_code: { cadence: 900, t02: "claude-5-opus", t3: "claude-5-sonnet" },
      codex: { cadence: 900, t02: "gpt-5.6-sol", t3: "gpt-5.6-terra" },
      cursor: { cadence: 300, t02: "cursor-latest", t3: "cursor-latest" },
    };

    for (const [name, exp] of Object.entries(hostExpectations)) {
      expect(getHostSchedulerConfig(name).default_cadence_seconds).toBe(exp.cadence);
      expect(resolveModelForTier(name, "tier_0_2")).toEqual({ model: exp.t02, thinking: "high" });
      expect(resolveModelForTier(name, "tier_3")).toEqual({ model: exp.t3, thinking: "medium" });
    }
  });

  it("audits concurrency saturation transition from under-saturated queue to fully saturated lifecycle convergence", () => {
    // Stage 1: Under-saturated state (8 subtasks needed, but only 1 active worker)
    const initialStations: readonly AssemblyStation[] = [
      {
        station_id: "station-lane-1",
        domain: "engine",
        milestone_id: "m-straggler-rebalance",
        assigned_files: ["src/modules/auth.ts"],
        status: "IN_PROGRESS",
      },
    ];

    const underSaturatedReport: ConcurrencySaturationReport = auditConcurrencySaturation({
      activeStations: initialStations,
      totalWorkUnits: 8,
      spanLength: 1,
      queuedTasks: [
        "sublane-2",
        "sublane-3",
        "sublane-4",
        "sublane-5",
        "sublane-6",
        "sublane-7",
        "sublane-8",
      ],
    });

    expect(underSaturatedReport.isSaturated).toBe(false);
    expect(underSaturatedReport.totalSlots).toBe(8);
    expect(underSaturatedReport.activeSlots).toBe(1);
    expect(underSaturatedReport.saturationRatio).toBeLessThan(0.8);
    expect(
      underSaturatedReport.findings.some((f) => f.includes(SKILL_CONCURRENCY_UNDER_SATURATED)),
    ).toBe(true);

    // Stage 2: Saturated parallel deployment (8 workers actively assigned across all 8 sub-lanes)
    const saturatedStations: readonly AssemblyStation[] = scopeFiles.map((file, idx) => ({
      station_id: `station-lane-${idx + 1}`,
      domain: "engine",
      milestone_id: "m-straggler-rebalance",
      assigned_files: [file],
      status: "IN_PROGRESS",
    }));

    const saturatedReport: ConcurrencySaturationReport = auditConcurrencySaturation({
      activeStations: saturatedStations,
      totalWorkUnits: 8,
      spanLength: 1,
    });

    expect(saturatedReport.isSaturated).toBe(true);
    expect(saturatedReport.totalSlots).toBe(8);
    expect(saturatedReport.activeSlots).toBe(8);
    expect(saturatedReport.saturationRatio).toBe(1.0);
    expect(saturatedReport.unstagedStations).toHaveLength(0);

    // Stage 3: Full lifecycle completion with Git staging durability invariant records
    const landedStations: readonly AssemblyStation[] = scopeFiles.map((file, idx) => ({
      station_id: `station-lane-${idx + 1}`,
      domain: "engine",
      milestone_id: "m-straggler-rebalance",
      assigned_files: [file],
      status: "LANDED",
      staging_record: {
        staging_id: `stage-record-lane-${idx + 1}`,
        milestone_id: "m-straggler-rebalance",
        subdomain: "engine",
        staged_at: new Date(t0 + 400_000).toISOString(),
        staged_files: [file],
        git_index_sha: `sha256-index-mock-${idx + 1}`,
        blob_objects_written: 1,
      },
    }));

    const completionAudit: ConcurrencyAuditResult = auditSkillConcurrencySaturation({
      activeStations: landedStations,
      totalWorkUnits: 0,
    });

    expect(completionAudit.is_saturated).toBe(true);
    expect(completionAudit.unstaged_stations).toHaveLength(0);
    expect(completionAudit.straggling_tasks).toHaveLength(0);

    // Verify watchdog confirms clean bill of health on completed subtasks
    const completedTasks: readonly MonitoredTask[] = scopeFiles.map((file, idx) => ({
      id: `task-sublane-${idx + 1}`,
      agent_id: `agent-worker-${idx + 1}`,
      status: "COMPLETED",
      claimed_at: t0 + 310_000,
      scope_files: [file],
    }));

    const finalWatchdogReport = evaluateActiveTasks(completedTasks, t0 + 490_000);
    expect(finalWatchdogReport.evaluated_count).toBe(8);
    expect(finalWatchdogReport.straggler_count).toBe(0);
    expect(finalWatchdogReport.healthy_count).toBe(8);
    expect(finalWatchdogReport.defects_emitted).toHaveLength(0);
  });

  it("does NOT flag live working agent exceeding 300s if progress was recorded within 120s (resolves hb-s7-coordinator-diagnosed-live-agent-as-dead)", () => {
    // Worker started at t0, evaluated at t = 310s (elapsed 310s > 300s SLA)
    // But reported progress at t = 250s (silence = 310 - 250 = 60s <= 120s)
    const liveTask: MonitoredTask = {
      id: "task-long-running-live-agent",
      agent_id: "agent-live-diligent",
      status: "RUNNING",
      claimed_at: t0,
      last_progress: t0 + 250_000,
      scope_files: ["src/heavy/compiler.ts"],
      work_units: 1,
      span_length: 1,
    };

    const assessment: StragglerAssessment = assessTaskStraggler(liveTask, t0 + 310_000);
    expect(assessment.task_id).toBe("task-long-running-live-agent");
    expect(assessment.agent_id).toBe("agent-live-diligent");
    expect(assessment.elapsed_seconds).toBe(310);
    expect(assessment.is_straggler).toBe(false);
    expect(assessment.recommended_action).toBe("CONTINUE");
    expect(assessment.decomposition_plan).toBeUndefined();

    // Verify ISO string format timestamp parity (last_progress_at at t=200s, silence = 110s <= 120s)
    const liveTaskIso: MonitoredTask = {
      id: "task-live-iso-timestamp",
      agent_id: "agent-live-iso",
      status: "LEASED",
      claimed_at: new Date(t0).toISOString(),
      last_progress_at: new Date(t0 + 200_000).toISOString(),
    };

    const assessmentIso = assessTaskStragglerStatus(liveTaskIso, t0 + 310_000);
    expect(assessmentIso.is_straggler).toBe(false);
    expect(assessmentIso.elapsed_seconds).toBe(310);
    expect(assessmentIso.recommended_action).toBe("CONTINUE");
  });
});

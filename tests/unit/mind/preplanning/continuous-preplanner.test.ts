import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  isPreplanningNeeded,
  runPreplanningTick,
  startPreplanningDaemon,
  type RawBacklogItem,
  type RawDefectItem,
} from "../../../../olt/scripts/src/mind/preplanning/index.ts";
import {
  compileSmartTasksToWavePlan,
  planWaveExecution,
} from "../../../../olt/scripts/src/mind/tasks/smart/planner/waves.ts";
import type { SmartTaskPlan } from "../../../../olt/scripts/src/mind/tasks/smart/planner/models.ts";
import {
  detectCyclesTarjan,
  extractFeedbackArcSet,
} from "../../../../olt/scripts/src/reporting/sugiyama-dag/tarjan.ts";
import { scratchRoot } from "../../../support/scratch-root.ts";

describe("Continuous Preplanner Engine & PO Toposort Verification", () => {
  const testDir = scratchRoot(import.meta.path, "test-continuous-preplanner");
  const oltDir = join(testDir, ".olt");
  const backlogPath = join(oltDir, "backlog.jsonl");
  const defectsPath = join(oltDir, "defects.jsonl");

  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(oltDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  test("isPreplanningNeeded returns false when no eligible items", () => {
    writeFileSync(backlogPath, '{"id":"b1","status":"COMPLETED"}\n');
    writeFileSync(defectsPath, '{"id":"d1","status":"RESOLVED"}\n');
    expect(isPreplanningNeeded({ rootDir: testDir })).toBe(false);
  });

  test("isPreplanningNeeded returns true when eligible items exist", () => {
    writeFileSync(backlogPath, '{"id":"b1","title":"New feature","status":"PENDING"}\n');
    expect(isPreplanningNeeded({ rootDir: testDir })).toBe(true);
  });

  test("runPreplanningTick generates plans and updates bridge state", () => {
    const item1: RawBacklogItem = {
      id: "b-core-1",
      title: "Core Feature 1",
      category: "core",
      status: "PENDING",
    };
    const defect1: RawDefectItem = {
      id: "d-core-1",
      title: "Core Defect 1",
      category: "core",
      status: "OPEN",
    };

    writeFileSync(backlogPath, `${JSON.stringify(item1)}\n`);
    writeFileSync(defectsPath, `${JSON.stringify(defect1)}\n`);

    const result = runPreplanningTick({ rootDir: testDir });
    expect(result.clusters.length).toBe(1);
    expect(result.items_planned).toBe(1);
    expect(result.defects_planned).toBe(1);
    expect(result.plan_files_written.length).toBe(1);
    expect(existsSync(result.plan_files_written[0]!)).toBe(true);

    const updatedBacklog = readFileSync(backlogPath, "utf-8");
    expect(updatedBacklog).toContain('"status":"PLANNED"');
    expect(updatedBacklog).toContain('"plan_path"');

    const updatedDefects = readFileSync(defectsPath, "utf-8");
    expect(updatedDefects).toContain('"status":"PLANNED"');
  });

  test("runPreplanningTick with dryRun leaves ledgers untouched", () => {
    const item: RawBacklogItem = {
      id: "b-dry",
      title: "Dry item",
      category: "engine",
      status: "PENDING",
    };
    writeFileSync(backlogPath, `${JSON.stringify(item)}\n`);

    const result = runPreplanningTick({ rootDir: testDir, dryRun: true });
    expect(result.clusters.length).toBe(1);
    expect(result.items_planned).toBe(1);

    const backlogContent = readFileSync(backlogPath, "utf-8");
    expect(backlogContent).toContain('"status":"PENDING"');
  });

  test("startPreplanningDaemon executes ticks and aggregates counts", async () => {
    const item: RawBacklogItem = {
      id: "b-daemon",
      title: "Daemon item",
      category: "reporting",
      status: "PENDING",
    };
    writeFileSync(backlogPath, `${JSON.stringify(item)}\n`);

    const daemonResult = await startPreplanningDaemon({
      rootDir: testDir,
      maxTicks: 2,
      intervalMs: 10,
    });

    expect(daemonResult.totalTicks).toBe(2);
    expect(daemonResult.totalPlanned).toBe(1);
  });

  test("Mind PO DAG compiles smart task plans into Kahn toposort waves with disjoint write scopes", () => {
    const tasks: readonly SmartTaskPlan[] = [
      {
        id: "task-root-1",
        title: "Root Task 1",
        tier: 3,
        estimated_duration_seconds: 60,
        write_scope: ["src/a.ts"],
        dependencies: [],
        gate: "G1",
        source_feedback_id: "fb-1",
      },
      {
        id: "task-root-2",
        title: "Root Task 2 (overlapping scope with root 1)",
        tier: 3,
        estimated_duration_seconds: 60,
        write_scope: ["src/a.ts"],
        dependencies: [],
        gate: "G1",
        source_feedback_id: "fb-2",
      },
      {
        id: "task-child-1",
        title: "Child Task 1",
        tier: 3,
        estimated_duration_seconds: 90,
        write_scope: ["src/b.ts"],
        dependencies: ["task-root-1"],
        gate: "G2",
        source_feedback_id: "fb-3",
      },
    ];

    const waveResult = compileSmartTasksToWavePlan(tasks);
    expect(waveResult.total_tasks).toBe(3);
    expect(waveResult.waves.length).toBeGreaterThanOrEqual(2);
    expect(waveResult.waves[0]!.task_ids).toContain("task-root-1");
    expect(waveResult.macro_metrics.work).toBe(3);
    expect(waveResult.optimal_lanes).toBeGreaterThanOrEqual(1);

    const wave1 = waveResult.waves.find((w) => w.task_ids.includes("task-root-1"));
    const waveChild = waveResult.waves.find((w) => w.task_ids.includes("task-child-1"));
    expect(wave1!.wave_number).toBeLessThan(waveChild!.wave_number);
  });

  test("Mind PO DAG compiler rejects cyclic dependencies with HarnessError", () => {
    const cyclicTasks: readonly SmartTaskPlan[] = [
      {
        id: "task-a",
        title: "Task A",
        tier: 3,
        estimated_duration_seconds: 60,
        write_scope: ["src/a.ts"],
        dependencies: ["task-b"],
        gate: "G1",
        source_feedback_id: "fb-a",
      },
      {
        id: "task-b",
        title: "Task B",
        tier: 3,
        estimated_duration_seconds: 60,
        write_scope: ["src/b.ts"],
        dependencies: ["task-a"],
        gate: "G1",
        source_feedback_id: "fb-b",
      },
    ];

    expect(() => planWaveExecution(cyclicTasks)).toThrow(HarnessError);
    expect(() => planWaveExecution(cyclicTasks)).toThrow(/Circular dependency detected/);
  });

  test("Tarjan SCC cycle-cutting diagnoses cyclic graphs and identifies feedback arc cuts", () => {
    const nodes = [
      { id: "node-1", label: "Node 1" },
      { id: "node-2", label: "Node 2" },
      { id: "node-3", label: "Node 3" },
    ];
    const cyclicEdges = [
      { from: "node-1", to: "node-2" },
      { from: "node-2", to: "node-3" },
      { from: "node-3", to: "node-1" },
    ];

    const diag = detectCyclesTarjan(nodes, cyclicEdges);
    expect(diag.hasCycle).toBe(true);
    expect(diag.cycleNodeIds.length).toBe(3);
    expect(diag.cyclePaths.length).toBeGreaterThanOrEqual(1);

    const fasResult = extractFeedbackArcSet(nodes, cyclicEdges);
    expect(fasResult.feedbackArcs.length).toBeGreaterThanOrEqual(1);
    expect(fasResult.acyclicEdges.length).toBeLessThan(cyclicEdges.length);

    const acyclicDiag = detectCyclesTarjan(nodes, fasResult.acyclicEdges);
    expect(acyclicDiag.hasCycle).toBe(false);
  });
});

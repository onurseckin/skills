import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { setupVirtualMindFS, cleanupVirtualMindFS, scratchRoot } from "../../fixtures/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  isPreplanningNeeded,
  runPreplanningTick,
  startPreplanningDaemon,
  updateBridgeStateBatch,
  type RawBacklogItem,
  type RawDefectItem,
  type ThematicCluster,
} from "../../../../olt/scripts/src/mind/preplanning/index.ts";
import { topologicalOrder } from "../../../../olt/scripts/src/graph/topology.ts";
import {
  compileSmartTasksToWavePlan,
  planWaveExecution,
} from "../../../../olt/scripts/src/mind/tasks/smart/planner/waves.ts";
import type { SmartTaskPlan } from "../../../../olt/scripts/src/mind/tasks/smart/planner/models.ts";
import {
  detectCyclesTarjan,
  extractFeedbackArcSet,
} from "../../../../olt/scripts/src/reporting/sugiyama-dag/tarjan.ts";

function mkItem(id: string, category: string, status = "PENDING"): RawBacklogItem {
  return { id, title: id, category, status };
}
function mkDefect(id: string, category: string, status = "OPEN"): RawDefectItem {
  return { id, title: id, category, status };
}
function mkTask(id: string, file: string, deps: string[] = []): SmartTaskPlan {
  return {
    id,
    title: id,
    description: id,
    priority: "HIGH",
    status: "PENDING",
    write_scope: [file],
    read_only_scope: [],
    gate: "bun test",
    charter_goals: ["G1"],
    acceptance_criteria: ["PASS"],
    dependencies: deps,
    blocked_by: deps,
  };
}
function mkCluster(id: string, domain: string, bId: string, dId: string): ThematicCluster {
  return {
    cluster_id: id,
    domain,
    title: domain,
    plan_path: `docs/planning/${id}/PLAN.md`,
    backlog_item_ids: [bId],
    defect_ids: [dId],
    planned_at: "2026-08-31T00:00:00.000Z",
  };
}

describe("Continuous Preplanner Engine & PO Toposort Verification (in-memory virtual)", () => {
  let testDir: string;
  let oltDir: string;
  let backlogPath: string;
  let defectsPath: string;

  beforeEach(() => {
    setupVirtualMindFS();
    testDir = scratchRoot("continuous-preplanner", "test");
    oltDir = join(testDir, ".olt");
    backlogPath = join(oltDir, "backlog.jsonl");
    defectsPath = join(oltDir, "defects.jsonl");
    fs.mkdirSync(oltDir, { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualMindFS();
  });

  test("isPreplanningNeeded evaluates backlog and defect eligibility", () => {
    fs.writeFileSync(backlogPath, `${JSON.stringify(mkItem("b1", "core", "COMPLETED"))}\n`);
    fs.writeFileSync(defectsPath, `${JSON.stringify(mkDefect("d1", "core", "RESOLVED"))}\n`);
    expect(isPreplanningNeeded({ rootDir: testDir })).toBe(false);

    fs.writeFileSync(backlogPath, `${JSON.stringify(mkItem("b1", "core", "PENDING"))}\n`);
    expect(isPreplanningNeeded({ rootDir: testDir })).toBe(true);
  });

  test("runPreplanningTick generates plans and updates bridge state (including dryRun)", () => {
    fs.writeFileSync(backlogPath, `${JSON.stringify(mkItem("b-core-1", "core"))}\n`);
    fs.writeFileSync(defectsPath, `${JSON.stringify(mkDefect("d-core-1", "core"))}\n`);

    const result = runPreplanningTick({ rootDir: testDir });
    expect(result.clusters.length).toBe(1);
    expect(result.items_planned).toBe(1);
    expect(result.defects_planned).toBe(1);
    expect(result.plan_files_written.length).toBe(1);
    expect(fs.existsSync(result.plan_files_written[0]!)).toBe(true);
    expect(fs.readFileSync(backlogPath, "utf-8")).toContain('"status":"PLANNED"');
    expect(fs.readFileSync(defectsPath, "utf-8")).toContain('"status":"PLANNED"');

    fs.writeFileSync(backlogPath, `${JSON.stringify(mkItem("b-dry", "engine"))}\n`);
    const dryRes = runPreplanningTick({ rootDir: testDir, dryRun: true });
    expect(dryRes.items_planned).toBe(1);
    expect(fs.readFileSync(backlogPath, "utf-8")).toContain('"status":"PENDING"');
  });

  test("startPreplanningDaemon executes ticks and aggregates counts", async () => {
    fs.writeFileSync(backlogPath, `${JSON.stringify(mkItem("b-daemon", "reporting"))}\n`);
    const res = await startPreplanningDaemon({ rootDir: testDir, maxTicks: 2, intervalMs: 10 });
    expect(res.totalTicks).toBe(2);
    expect(res.totalPlanned).toBe(1);
  });

  test("updateBridgeStateBatch performs atomic batch updates across multiple clusters and ledgers", () => {
    const item1 = mkItem("b1", "core");
    const item2 = mkItem("b2", "engine");
    const defect1 = mkDefect("d1", "core");
    const defect2 = mkDefect("d2", "engine");
    fs.writeFileSync(backlogPath, `${JSON.stringify(item1)}\n${JSON.stringify(item2)}\n`);
    fs.writeFileSync(defectsPath, `${JSON.stringify(defect1)}\n${JSON.stringify(defect2)}\n`);

    const c1 = mkCluster("c1", "core", "b1", "d1");
    const c2 = mkCluster("c2", "engine", "b2", "d2");
    const batchRes = updateBridgeStateBatch([c1, c2], { rootDir: testDir });
    expect(batchRes.itemsUpdated).toBe(2);
    expect(batchRes.defectsUpdated).toBe(2);
    expect(fs.readFileSync(backlogPath, "utf-8")).toContain(
      '"plan_path":"docs/planning/c1/PLAN.md"',
    );
    expect(fs.readFileSync(defectsPath, "utf-8")).toContain(
      '"plan_path":"docs/planning/c2/PLAN.md"',
    );
  });

  test("Kahn topologicalOrder handles dangling prerequisites without deadlocking or false cycles", () => {
    const depMap = new Map<string, ReadonlySet<string>>([
      ["task-a", new Set()],
      ["task-b", new Set(["task-a", "non-existent-prereq"])],
      ["task-c", new Set(["task-b"])],
    ]);
    const dangling: { dep: string; prereq: string }[] = [];
    const order = topologicalOrder(depMap, {
      onDanglingPrerequisite: (dep, prereq) => dangling.push({ dep, prereq }),
    });
    expect(order).toEqual(["task-a", "task-b", "task-c"]);
    expect(dangling).toEqual([{ dep: "task-b", prereq: "non-existent-prereq" }]);
  });

  test("Mind PO DAG compiles smart task plans into Kahn toposort waves with disjoint write scopes", () => {
    const tasks: readonly SmartTaskPlan[] = [
      mkTask("task-1", "src/storage/kv.ts"),
      mkTask("task-2", "src/storage/index.ts", ["task-1"]),
      mkTask("task-3", "src/cache/lru.ts"),
    ];
    const wavePlan = compileSmartTasksToWavePlan(tasks);
    expect(wavePlan.waves.length).toBe(2);
    expect(wavePlan.waves[0]!.task_ids).toContain("task-1");
    expect(wavePlan.waves[0]!.task_ids).toContain("task-3");
    expect(wavePlan.waves[1]!.task_ids).toEqual(["task-2"]);

    const executed = planWaveExecution(tasks);
    expect(executed.total_tasks).toBe(3);
    expect(executed.waves.length).toBe(2);
  });

  test("Mind PO DAG compiler rejects cyclic dependencies with HarnessError", () => {
    const cyclicTasks: readonly SmartTaskPlan[] = [
      mkTask("task-alpha", "src/alpha.ts", ["task-beta"]),
      mkTask("task-beta", "src/beta.ts", ["task-alpha"]),
    ];
    expect(() => compileSmartTasksToWavePlan(cyclicTasks)).toThrow(HarnessError);
  });

  test("Tarjan SCC cycle-cutting diagnoses cyclic graphs and identifies feedback arc cuts", () => {
    const nodes = [
      { id: "n1", label: "T1" },
      { id: "n2", label: "T2" },
      { id: "n3", label: "T3" },
    ];
    const edges = [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
      { from: "n3", to: "n1" },
    ];
    const result = detectCyclesTarjan(nodes, edges);
    expect(result.hasCycle).toBe(true);
    expect(result.cyclePaths.length).toBe(1);

    const feedbackArcs = extractFeedbackArcSet(nodes, edges);
    expect(feedbackArcs.feedbackArcs.length).toBeGreaterThanOrEqual(1);
  });
});

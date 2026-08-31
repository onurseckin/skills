import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CANONICAL_DOMAINS,
  classifyDomain,
  clusterBacklogAndDefects,
  filterEligibleBacklogItems,
  filterEligibleDefects,
  generateClusterId,
  generatePlanPath,
  loadBacklogItems,
  loadDefectItems,
  type RawBacklogItem,
  type RawDefectItem,
} from "../../../olt/scripts/src/mind/preplanning/index.ts";
import { validateTaskQueueDag } from "../../../olt/scripts/src/task/queue/enqueue.ts";
import { detectCyclesTarjan } from "../../../olt/scripts/src/reporting/sugiyama-dag/tarjan.ts";
import { scratchRoot } from "../../shared/scratch-root.ts";

describe("Backlog Clusterer Engine & Cluster DAG Verification", () => {
  const testDir = scratchRoot(import.meta.path, "test-backlog-clusterer");

  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  test("filterEligibleBacklogItems checks actual disk existence rather than path prefix", () => {
    const existingPlan = join(testDir, "existing-plan.md");
    writeFileSync(existingPlan, "# Existing Plan\n");

    const items: RawBacklogItem[] = [
      { id: "i1", status: "PENDING" },
      { id: "i2", status: "COMPLETED" },
      { id: "i3", status: "PROCESSED" },
      { id: "i4", status: "DECLINED" },
      { id: "i5", status: "BLOCKED" },
      { id: "i6", status: "PLANNED", plan_path: existingPlan },
      { id: "i7", status: "PENDING", plan_path: "docs/planning/non-existent/PLAN.md" },
      { id: "i8", status: "OPEN" },
      { id: "i9", status: "DISPATCHED" },
      { id: "i10", status: "IN_PROGRESS" },
      { id: "i11", status: "CLAIMED" },
      { id: "i12", status: "RUNNING" },
    ];

    const eligible = filterEligibleBacklogItems(items, { rootDir: testDir });
    expect(eligible.map((i) => i.id)).toEqual(["i1", "i7", "i8"]);
  });

  test("filterEligibleDefects checks disk existence for plan path and filters in-flight defects", () => {
    const existingPlan = join(testDir, "existing-defect-plan.md");
    writeFileSync(existingPlan, "# Defect Plan\n");

    const defects: RawDefectItem[] = [
      { id: "d1", status: "OPEN" },
      { id: "d2", status: "RESOLVED" },
      { id: "d3", status: "COMPLETED" },
      { id: "d4", status: "CLOSED" },
      { id: "d5", status: "PLANNED", plan_path: existingPlan },
      { id: "d6", status: "REOPENED", plan_path: "docs/planning/unwritten/PLAN.md" },
      { id: "d7", status: "DISPATCHED" },
      { id: "d8", status: "IN_PROGRESS" },
      { id: "d9", status: "CLAIMED" },
      { id: "d10", status: "RUNNING" },
    ];

    const eligible = filterEligibleDefects(defects, { rootDir: testDir });
    expect(eligible.map((d) => d.id)).toEqual(["d1", "d6"]);
  });

  test("classifyDomain categorizes correctly across canonical domains with word boundary precision", () => {
    expect(CANONICAL_DOMAINS.length).toBe(6);
    expect(classifyDomain("Brainstorm Mind Charter")).toBe("mind");
    expect(classifyDomain("APCA Contrast Coverage Test")).toBe("validation");
    expect(classifyDomain("Harness CLI flags tool")).toBe("tooling");
    expect(classifyDomain("KV storage ledger pipeline")).toBe("engine");
    expect(classifyDomain("Doctor Telemetry Summary Report")).toBe("reporting");
    expect(classifyDomain("Unknown item", "", "validation")).toBe("validation");
    expect(classifyDomain("Random untagged task")).toBe("core");

    // Word boundary anti-false-positive validation
    expect(classifyDomain("A mindless wanderer in the system")).toBe("core");
    expect(classifyDomain("New testament generator")).toBe("core");
    expect(classifyDomain("A client library connection")).toBe("core");
  });

  test("generateClusterId and generatePlanPath produce deterministic identifiers", () => {
    const id1 = generateClusterId("engine", ["item-1", "item-2"], ["def-1"]);
    const id2 = generateClusterId("engine", ["item-2", "item-1"], ["def-1"]);
    expect(id1).toBe(id2);
    expect(id1.startsWith("cluster-engine-")).toBe(true);

    const path = generatePlanPath(id1, "custom/dir");
    expect(path).toBe(`custom/dir/${id1}/PLAN.md`);
  });

  test("clusterBacklogAndDefects partitions items by domain", () => {
    const items: RawBacklogItem[] = [
      { id: "i-eng", title: "Storage Engine", category: "engine", status: "PENDING" },
      { id: "i-val", title: "Validator Test", category: "validation", status: "PENDING" },
    ];
    const defects: RawDefectItem[] = [
      { id: "d-eng", title: "Storage Crash", category: "engine", status: "OPEN" },
    ];

    const clusters = clusterBacklogAndDefects(items, defects, { targetDir: testDir });
    expect(clusters.length).toBe(2);

    const engineCluster = clusters.find((c) => c.domain === "engine");
    expect(engineCluster).toBeDefined();
    expect(engineCluster!.backlog_item_ids).toEqual(["i-eng"]);
    expect(engineCluster!.defect_ids).toEqual(["d-eng"]);

    const valCluster = clusters.find((c) => c.domain === "validation");
    expect(valCluster).toBeDefined();
    expect(valCluster!.backlog_item_ids).toEqual(["i-val"]);
    expect(valCluster!.defect_ids).toEqual([]);
  });

  test("clusterBacklogAndDefects returns empty array when all items are ineligible", () => {
    const items: RawBacklogItem[] = [{ id: "i1", status: "COMPLETED" }];
    const defects: RawDefectItem[] = [{ id: "d1", status: "RESOLVED" }];
    expect(clusterBacklogAndDefects(items, defects)).toEqual([]);
  });

  test("loadBacklogItems and loadDefectItems handle JSONL parsing and missing files", () => {
    expect(loadBacklogItems(join(testDir, "missing.jsonl"))).toEqual([]);
    expect(loadDefectItems(join(testDir, "missing.jsonl"))).toEqual([]);

    const backlogFile = join(testDir, "backlog.jsonl");
    writeFileSync(
      backlogFile,
      '{"id":"b1","title":"Item 1"}\n\n{"id":"b2","title":"Item 2"}\ninvalid-json\n',
    );
    const loadedItems = loadBacklogItems(backlogFile);
    expect(loadedItems.length).toBe(2);
    expect(loadedItems[0]!.id).toBe("b1");
    expect(loadedItems[1]!.id).toBe("b2");

    const defectsFile = join(testDir, "defects.jsonl");
    writeFileSync(defectsFile, '{"id":"d1","title":"Defect 1"}\n{"id":"d2","title":"Defect 2"}\n');
    const loadedDefects = loadDefectItems(defectsFile);
    expect(loadedDefects.length).toBe(2);
  });

  test("Thematic cluster synthesized task DAG passes Kahn acyclicity and Tarjan diagnostics", () => {
    const clusterItems: RawBacklogItem[] = [
      { id: "req-1", title: "Storage Foundation", category: "engine", status: "PENDING" },
      { id: "req-2", title: "Storage Indexing", category: "engine", status: "PENDING" },
    ];
    const clusters = clusterBacklogAndDefects(clusterItems, [], { targetDir: testDir });
    expect(clusters.length).toBe(1);

    const taskQueueItems = [
      {
        id: "task-1",
        title: "Task 1",
        description: "Req 1",
        priority: "HIGH" as const,
        status: "PENDING" as const,
        write_scope: ["src/storage.ts"],
        gate: "G1",
        charter_goals: ["G1"],
        acceptance_criteria: [],
        dependencies: [],
        blocked_by: [],
        lease: null,
        source_type: "direct_prompt" as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        retry_count: 0,
        max_retries: 3,
      },
      {
        id: "task-2",
        title: "Task 2",
        description: "Req 2",
        priority: "HIGH" as const,
        status: "PENDING" as const,
        write_scope: ["src/index.ts"],
        gate: "G1",
        charter_goals: ["G1"],
        acceptance_criteria: [],
        dependencies: ["task-1"],
        blocked_by: ["task-1"],
        lease: null,
        source_type: "direct_prompt" as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        retry_count: 0,
        max_retries: 3,
      },
    ];

    const dagCheck = validateTaskQueueDag(taskQueueItems);
    expect(dagCheck.ok).toBe(true);
    expect(dagCheck.cycles.length).toBe(0);

    const nodes = taskQueueItems.map((t) => ({ id: t.id, label: t.title }));
    const edges = [{ from: "task-1", to: "task-2" }];
    const tarjanDiag = detectCyclesTarjan(nodes, edges);
    expect(tarjanDiag.hasCycle).toBe(false);
  });
});

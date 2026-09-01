import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import * as fs from "node:fs";
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
} from "../../../../olt/scripts/src/mind/preplanning/index.ts";
import { validateTaskQueueDag } from "../../../../olt/scripts/src/task/queue/enqueue.ts";
import { detectCyclesTarjan } from "../../../../olt/scripts/src/reporting/sugiyama-dag/tarjan.ts";

describe("Backlog Clusterer Engine & Cluster DAG Verification (in-memory virtual)", () => {
  const testDir = `${process.cwd()}/.olt/virtual-preplan-cluster-scratch`;
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    mockDirs.add(testDir);

    const existsSpy = spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
      const pathStr = String(p);
      return mockFiles.has(pathStr) || mockDirs.has(pathStr);
    });
    spies.push(existsSpy);

    const mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation((p: fs.PathLike) => {
      mockDirs.add(String(p));
      return undefined as unknown as string;
    });
    spies.push(mkdirSpy);

    const writeSpy = spyOn(fs, "writeFileSync").mockImplementation(
      (p: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView) => {
        const pathStr = String(p);
        mockFiles.set(
          pathStr,
          typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf-8"),
        );
      },
    );
    spies.push(writeSpy);

    const readSpy = spyOn(fs, "readFileSync").mockImplementation((p: fs.PathOrFileDescriptor) => {
      const pathStr = String(p);
      const val = mockFiles.get(pathStr);
      if (val !== undefined) return val;
      throw new Error(`ENOENT: no such file or directory, open '${pathStr}'`);
    });
    spies.push(readSpy);
  });

  afterEach(() => {
    while (spies.length > 0) {
      spies.pop()?.mockRestore();
    }
  });

  test("filterEligibleBacklogItems checks actual disk existence rather than path prefix", () => {
    const existingPlan = join(testDir, "existing-plan.md");
    mockFiles.set(existingPlan, "# Existing Plan\n");

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
    mockFiles.set(existingPlan, "# Defect Plan\n");

    const defects: RawDefectItem[] = [
      { id: "d1", status: "open" },
      { id: "d2", status: "resolved" },
      { id: "d3", status: "wontfix" },
      { id: "d4", status: "closed" },
      { id: "d5", status: "declined" },
      { id: "d6", status: "in_progress" },
      { id: "d7", status: "dispatched" },
      { id: "d8", status: "running" },
      { id: "d9", status: "claimed" },
      { id: "d10", status: "planned", plan_path: existingPlan },
      { id: "d11", status: "open", plan_path: "docs/planning/missing-plan/PLAN.md" },
    ];

    const eligible = filterEligibleDefects(defects, { rootDir: testDir });
    expect(eligible.map((d) => d.id)).toEqual(["d1", "d3", "d11"]);
  });

  test("classifyDomain categorizes correctly across canonical domains with word boundary precision", () => {
    expect(classifyDomain("Setup Engine Core", undefined, "core")).toBe("core");
    expect(classifyDomain("Refactor task dag queue")).toBe("engine");
    expect(classifyDomain("Improve test coverage and assertions")).toBe("validation");
    expect(classifyDomain("Install tool and update manifests")).toBe("tooling");
    expect(classifyDomain("Refactor mind agent charter")).toBe("mind");
    expect(classifyDomain("Generate weekly doctor report")).toBe("reporting");
    expect(classifyDomain("random unknown title without keywords")).toBe("core");
    expect(CANONICAL_DOMAINS.length).toBeGreaterThanOrEqual(5);
  });

  test("generateClusterId and generatePlanPath produce deterministic identifiers", () => {
    const id1 = generateClusterId("core", ["b1", "b2"], ["d1"]);
    const id2 = generateClusterId("core", ["b1", "b2"], ["d1"]);
    const id3 = generateClusterId("core", ["b2", "b1"], ["d1"]);
    expect(id1).toBe(id2);
    expect(id1).toBe(id3);
    expect(id1.startsWith("cluster-core-")).toBe(true);

    const path1 = generatePlanPath(id1, "docs/planning");
    expect(path1).toBe(`docs/planning/${id1}/PLAN.md`);
  });

  test("clusterBacklogAndDefects partitions items by domain", () => {
    const items: RawBacklogItem[] = [
      { id: "i-core", category: "core", title: "Core Work", status: "PENDING" },
      { id: "i-task", category: "task", title: "Task Pipeline", status: "PENDING" },
      { id: "i-val", category: "validation", title: "Test Invariants", status: "PENDING" },
    ];
    const defects: RawDefectItem[] = [
      { id: "d-core", category: "core", observation: "Core bug", status: "open" },
    ];

    const clusters = clusterBacklogAndDefects(items, defects, { targetDir: testDir });
    expect(clusters.length).toBe(3);

    const coreCluster = clusters.find((c) => c.domain === "core");
    expect(coreCluster).toBeDefined();
    expect(coreCluster!.backlog_item_ids).toEqual(["i-core"]);
    expect(coreCluster!.defect_ids).toEqual(["d-core"]);

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
    mockFiles.set(
      backlogFile,
      '{"id":"b1","title":"Item 1"}\n\n{"id":"b2","title":"Item 2"}\ninvalid-json\n',
    );
    const loadedItems = loadBacklogItems(backlogFile);
    expect(loadedItems.length).toBe(2);
    expect(loadedItems[0]!.id).toBe("b1");
    expect(loadedItems[1]!.id).toBe("b2");

    const defectsFile = join(testDir, "defects.jsonl");
    mockFiles.set(defectsFile, '{"id":"d1","title":"Defect 1"}\n{"id":"d2","title":"Defect 2"}\n');
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

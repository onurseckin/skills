import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyDomain,
  clusterBacklogAndDefects,
  filterEligibleBacklogItems,
  filterEligibleDefects,
  generateClusterId,
  generatePlanPath,
  loadBacklogItems,
  loadDefectItems,
} from "../../../olt/scripts/src/mind/preplanning/backlog-clusterer.ts";
import type {
  RawBacklogItem,
  RawDefectItem,
} from "../../../olt/scripts/src/mind/preplanning/types.ts";

describe("Mind Continuous Pre-Planning: Backlog & Defect Clusterer (Task 1.1)", () => {
  it("classifies domain heuristics correctly based on title, category, and error codes", () => {
    expect(classifyDomain("Mind Preplanning Engine", "Autonomous zero-idle loop")).toBe("mind");
    expect(classifyDomain("Fix validator assertion failure", "Apca contrast gate")).toBe(
      "validation",
    );
    expect(classifyDomain("CLI factory operations command", "Add factory:preplan")).toBe("tooling");
    expect(classifyDomain("KV store ledger persistence", "Flock transactional write")).toBe(
      "engine",
    );
    expect(classifyDomain("Doctor telemetry summary", "Health report metrics")).toBe("reporting");
    expect(classifyDomain("Unknown item", "General architectural invariant")).toBe("core");

    // Explicit category override
    expect(classifyDomain("Some title", "Some description", "tooling")).toBe("tooling");
    expect(classifyDomain("Some title", "Some description", "validation")).toBe("validation");
  });

  it("filters out items that are already planned, processed, resolved, or have plan_path", () => {
    const backlog: readonly RawBacklogItem[] = [
      { id: "item-1", title: "Open item", status: "PENDING" },
      { id: "item-2", title: "Planned item", status: "PLANNED" },
      { id: "item-3", title: "Processed item", status: "PROCESSED" },
      {
        id: "item-4",
        title: "Item with plan path",
        status: "PENDING",
        plan_path: "docs/planning/p1/PLAN.md",
      },
      { id: "item-5", title: "Admitted item", status: "ADMITTED" },
    ];

    const eligibleBacklog = filterEligibleBacklogItems(backlog);
    expect(eligibleBacklog.map((i) => i.id)).toEqual(["item-1", "item-5"]);

    const defects: readonly RawDefectItem[] = [
      { id: "def-1", title: "Open defect", status: "OPEN" },
      { id: "def-2", title: "Resolved defect", status: "RESOLVED" },
      { id: "def-3", title: "Closed defect", status: "CLOSED" },
      {
        id: "def-4",
        title: "Defect with plan path",
        status: "OPEN",
        plan_path: "docs/planning/p2/PLAN.md",
      },
      { id: "def-5", title: "Reopened defect", status: "REOPENED" },
    ];

    const eligibleDefects = filterEligibleDefects(defects);
    expect(eligibleDefects.map((d) => d.id)).toEqual(["def-1", "def-5"]);
  });

  it("generates deterministic cluster IDs and plan paths", () => {
    const clusterId1 = generateClusterId("mind", ["item-1", "item-2"], ["def-1"]);
    const clusterId2 = generateClusterId("mind", ["item-2", "item-1"], ["def-1"]);
    expect(clusterId1).toBe(clusterId2);
    expect(clusterId1.startsWith("cluster-mind-")).toBe(true);

    const planPath = generatePlanPath(clusterId1);
    expect(planPath).toBe(`docs/planning/${clusterId1}/PLAN.md`);

    const customPlanPath = generatePlanPath(clusterId1, "custom/plans");
    expect(customPlanPath).toBe(`custom/plans/${clusterId1}/PLAN.md`);
  });

  it("clusters backlog items and defects into domain groups deterministically", () => {
    const backlog: readonly RawBacklogItem[] = [
      { id: "fb-1", title: "Mind continuous pulse stagnation", category: "mind" },
      { id: "fb-2", title: "Add CLI factory ops commands", category: "tooling" },
      { id: "fb-3", title: "Verification test suite for station landing", category: "validation" },
    ];

    const defects: readonly RawDefectItem[] = [
      { id: "def-1", title: "Mind cognitive loop deadlock", error_code: "MIND_DEADLOCK" },
      { id: "def-2", title: "KV Store corruption under load", category: "engine" },
    ];

    const clusters = clusterBacklogAndDefects(backlog, defects, {
      timestamp: "2026-08-29T00:00:00Z",
    });
    expect(clusters.length).toBe(4);

    const mindCluster = clusters.find((c) => c.domain === "mind");
    expect(mindCluster).toBeDefined();
    expect(mindCluster?.backlog_item_ids).toEqual(["fb-1"]);
    expect(mindCluster?.defect_ids).toEqual(["def-1"]);
    expect(mindCluster?.title).toBe("Mind Continuous Pre-Planning Domain Cluster");

    const toolingCluster = clusters.find((c) => c.domain === "tooling");
    expect(toolingCluster).toBeDefined();
    expect(toolingCluster?.backlog_item_ids).toEqual(["fb-2"]);

    const validationCluster = clusters.find((c) => c.domain === "validation");
    expect(validationCluster).toBeDefined();
    expect(validationCluster?.backlog_item_ids).toEqual(["fb-3"]);

    const engineCluster = clusters.find((c) => c.domain === "engine");
    expect(engineCluster).toBeDefined();
    expect(engineCluster?.defect_ids).toEqual(["def-2"]);
  });

  it("returns empty array if no eligible backlog items or defects exist", () => {
    const emptyClusters = clusterBacklogAndDefects([], []);
    expect(emptyClusters).toEqual([]);

    const allPlannedBacklog: readonly RawBacklogItem[] = [
      { id: "item-1", title: "Done", status: "PLANNED" },
    ];
    const allResolvedDefects: readonly RawDefectItem[] = [
      { id: "def-1", title: "Done", status: "RESOLVED" },
    ];

    const noEligibleClusters = clusterBacklogAndDefects(allPlannedBacklog, allResolvedDefects);
    expect(noEligibleClusters).toEqual([]);
  });

  it("reads and parses .jsonl files safely, handling missing or corrupt files", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clusterer-test-"));
    try {
      const backlogFile = join(tempDir, "backlog.jsonl");
      const defectFile = join(tempDir, "defects.jsonl");

      writeFileSync(
        backlogFile,
        JSON.stringify({ id: "b1", title: "Item 1", status: "PENDING" }) +
          "\n\n" +
          "INVALID_JSON_LINE\n" +
          JSON.stringify({ id: "b2", title: "Item 2", status: "PENDING" }) +
          "\n",
      );

      writeFileSync(
        defectFile,
        JSON.stringify({ id: "d1", title: "Defect 1", status: "OPEN" }) +
          "\n" +
          JSON.stringify({ id: "d2", title: "Defect 2", status: "OPEN" }) +
          "\n",
      );

      const loadedBacklog = loadBacklogItems(backlogFile);
      expect(loadedBacklog.length).toBe(2);
      expect(loadedBacklog[0].id).toBe("b1");
      expect(loadedBacklog[1].id).toBe("b2");

      const loadedDefects = loadDefectItems(defectFile);
      expect(loadedDefects.length).toBe(2);
      expect(loadedDefects[0].id).toBe("d1");
      expect(loadedDefects[1].id).toBe("d2");

      // Non-existent files return empty array
      expect(loadBacklogItems(join(tempDir, "non-existent.jsonl"))).toEqual([]);
      expect(loadDefectItems(join(tempDir, "non-existent-defects.jsonl"))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

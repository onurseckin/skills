import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { setupVirtualMindFS, cleanupVirtualMindFS, scratchRoot } from "../../fixtures/index.ts";
import {
  assertValidBlueprintStructure,
  deriveDisjointTaskScope,
  generateAndWritePlan,
  generatePlanMarkdown,
  writePlanFile,
  type RawBacklogItem,
  type RawDefectItem,
  type ThematicCluster,
} from "../../../../olt/scripts/src/mind/preplanning/index.ts";

describe("Plan Factory Engine (in-memory virtual)", () => {
  let testDir: string;

  beforeEach(() => {
    setupVirtualMindFS();
    testDir = scratchRoot("plan-factory", "test");
  });

  afterEach(() => {
    cleanupVirtualMindFS();
  });

  const mockCluster: ThematicCluster = {
    cluster_id: "cluster-core-abc12345",
    domain: "core",
    title: "Core Continuous Pre-Planning Domain Cluster",
    plan_path: "docs/planning/cluster-core-abc12345/PLAN.md",
    backlog_item_ids: ["item-1", "item-2"],
    defect_ids: ["def-1"],
    planned_at: "2026-08-29T12:00:00.000Z",
    description: "Core cluster covering 2 items and 1 defect",
  };

  const mockItems: RawBacklogItem[] = [
    {
      id: "item-1",
      title: "Add Core Store",
      content: "Implement key-value store",
      status: "PENDING",
      category: "core",
    },
    {
      id: "item-2",
      title: "Add Cache",
      content: "Implement LRU memory cache",
      status: "PENDING",
      category: "core",
    },
  ];

  const mockDefects: RawDefectItem[] = [
    {
      id: "def-1",
      title: "Store Memory Leak",
      observation: "Store retains uncollected buffers",
      status: "open",
      remediation: "Add explicit dispose method",
    },
  ];

  test("generatePlanMarkdown generates valid blueprint with all required sections", () => {
    const markdown = generatePlanMarkdown(mockCluster, mockItems, mockDefects);

    expect(markdown).toContain("# Core Continuous Pre-Planning Domain Cluster Master Plan");
    expect(markdown).toContain("## 1. Executive Summary & The Assembly Pipeline Vision");
    expect(markdown).toContain("## 2. Core Architectural Pillars & Design Specifications");
    expect(markdown).toContain("## 3. Work Breakdown & Disjoint Task Specifications");
    expect(markdown).toContain("## 4. Sequential Execution Order & Critical Path");
    expect(markdown).toContain("## 5. Exhaustive Traceability Matrix");
    expect(markdown).toContain("### Task 1.1: Feature: Add Core Store");
    expect(markdown).toContain("### Task 1.2: Feature: Add Cache");
    expect(markdown).toContain("### Task 1.3: Defect Remediation: Store Memory Leak");
    expect(assertValidBlueprintStructure(markdown)).toBe(true);
  });

  test("deriveDisjointTaskScope produces unique suffixed file paths and scope envelopes", () => {
    const scope1 = deriveDisjointTaskScope("engine", "req-1", "KV Store WAL Sync");
    const scope2 = deriveDisjointTaskScope("engine", "req-2", "KV Store WAL Sync");

    expect(scope1.writeScope).toBe("olt/scripts/src/engine/kv-store-wal-sync-req-1.ts");
    expect(scope2.writeScope).toBe("olt/scripts/src/engine/kv-store-wal-sync-req-2.ts");
    expect(scope1.writeScope).not.toBe(scope2.writeScope);
    expect(scope1.scopeEnvelope).toEqual([
      "olt/scripts/src/engine/kv-store-wal-sync-req-1.ts",
      "tests/engine/kv-store-wal-sync-req-1.test.ts",
    ]);
  });

  test("generatePlanMarkdown generates fallback task when no matched items", () => {
    const emptyCluster: ThematicCluster = {
      ...mockCluster,
      backlog_item_ids: [],
      defect_ids: [],
    };
    const markdown = generatePlanMarkdown(emptyCluster, [], []);
    expect(markdown).toContain(
      "### Task 1.1: Core Continuous Pre-Planning Domain Cluster Implementation",
    );
    expect(assertValidBlueprintStructure(markdown)).toBe(true);
  });

  test("assertValidBlueprintStructure rejects malformed or empty markdown", () => {
    expect(assertValidBlueprintStructure("")).toBe(false);
    expect(assertValidBlueprintStructure("Just some text")).toBe(false);
    expect(
      assertValidBlueprintStructure(
        "# Plan\n## 1. Executive Summary\n## 2. Core Architectural Pillars",
      ),
    ).toBe(false);
  });

  test("writePlanFile creates directories and writes markdown file", () => {
    const targetFile = join(testDir, "docs/planning/cluster-1/PLAN.md");
    const written = writePlanFile(targetFile, "# Test Plan", testDir);
    expect(written).toBe(targetFile);
    expect(fs.existsSync(targetFile)).toBe(true);
    expect(fs.readFileSync(targetFile, "utf-8")).toBe("# Test Plan");
  });

  test("generateAndWritePlan outputs plan and writes to destination", () => {
    const cluster: ThematicCluster = {
      ...mockCluster,
      plan_path: "docs/planning/custom-cluster/PLAN.md",
    };
    const result = generateAndWritePlan(cluster, mockItems, mockDefects, testDir);
    expect(result.planPath).toBe(join(testDir, "docs/planning/custom-cluster/PLAN.md"));
    expect(fs.existsSync(result.planPath)).toBe(true);
    expect(assertValidBlueprintStructure(result.markdown)).toBe(true);
  });
});

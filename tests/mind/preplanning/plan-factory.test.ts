import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  assertValidBlueprintStructure,
  deriveDisjointTaskScope,
  generateAndWritePlan,
  generatePlanMarkdown,
  writePlanFile,
  type RawBacklogItem,
  type RawDefectItem,
  type ThematicCluster,
} from "../../../olt/scripts/src/mind/preplanning/index.ts";
import { scratchRoot } from "../../../support/scratch-root.ts";

describe("Plan Factory Engine", () => {
  const testDir = scratchRoot(import.meta.path, "test-plan-factory");

  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
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
      description: "Fix memory leak in store",
      status: "OPEN",
      category: "core",
      error_code: "ERR_MEM_LEAK",
    },
  ];

  test("generatePlanMarkdown generates valid blueprint with all required sections", () => {
    const markdown = generatePlanMarkdown(mockCluster, mockItems, mockDefects);
    expect(typeof markdown).toBe("string");
    expect(markdown).toContain("# Core Continuous Pre-Planning Domain Cluster Master Plan");
    expect(markdown).toContain("> **Tracking ID:** `fb-cluster-core-abc12345`");
    expect(markdown).toContain("## 1. Executive Summary");
    expect(markdown).toContain("## 2. Core Architectural Pillars");
    expect(markdown).toContain("## 3. Work Breakdown");
    expect(markdown).toContain("## 4. Sequential Execution Order");
    expect(markdown).toContain("## 5. Exhaustive Traceability Matrix");

    expect(markdown).toContain("### Task 1.1: Feature: Add Core Store");
    expect(markdown).toContain(
      "- **Write Scope:** `olt/scripts/src/core/add-core-store-item-1.ts`, `tests/unit/core/add-core-store-item-1.test.ts`",
    );
    expect(markdown).toContain("`bun test tests/unit/core/add-core-store-item-1.test.ts`");
    expect(markdown).toContain("### Task 1.2: Feature: Add Cache");
    expect(markdown).toContain(
      "- **Write Scope:** `olt/scripts/src/core/add-cache-item-2.ts`, `tests/unit/core/add-cache-item-2.test.ts`",
    );
    expect(markdown).toContain("`bun test tests/unit/core/add-cache-item-2.test.ts`");
    expect(markdown).toContain("### Task 1.3: Defect Remediation: Store Memory Leak");
    expect(markdown).toContain(
      "- **Write Scope:** `olt/scripts/src/core/store-memory-leak-def-1.ts`, `tests/unit/core/store-memory-leak-def-1.test.ts`",
    );
    expect(markdown).toContain("`bun test tests/unit/core/store-memory-leak-def-1.test.ts`");
    expect(markdown).toContain("`ERR_MEM_LEAK`");
    expect(markdown).toContain(
      "Execution Flow: [Task 1.1: Add Core Store] ──► [Task 1.2: Add Cache] ──► [Task 1.3: Store Memory Leak] ──► [Verification: bun test tests/unit/core/] ──► [Git Staging: git add -A] ──► [Landing]",
    );
    expect(assertValidBlueprintStructure(markdown)).toBe(true);
  });

  test("deriveDisjointTaskScope produces unique suffixed file paths and scope envelopes", () => {
    const scope1 = deriveDisjointTaskScope("engine", "req-1", "KV Store WAL Sync");
    const scope2 = deriveDisjointTaskScope("engine", "req-2", "KV Store WAL Sync");

    expect(scope1.writeScope).toBe("olt/scripts/src/engine/kv-store-wal-sync-req-1.ts");
    expect(scope2.writeScope).toBe("olt/scripts/src/engine/kv-store-wal-sync-req-2.ts");
    expect(scope1.writeScope).not.toBe(scope2.writeScope); // Zero slug collision
    expect(scope1.scopeEnvelope).toEqual([
      "olt/scripts/src/engine/kv-store-wal-sync-req-1.ts",
      "tests/unit/engine/kv-store-wal-sync-req-1.test.ts",
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
    expect(existsSync(targetFile)).toBe(true);
    expect(readFileSync(targetFile, "utf-8")).toBe("# Test Plan");
  });

  test("generateAndWritePlan outputs plan and writes to destination", () => {
    const cluster: ThematicCluster = {
      ...mockCluster,
      plan_path: "docs/planning/custom-cluster/PLAN.md",
    };
    const result = generateAndWritePlan(cluster, mockItems, mockDefects, testDir);
    expect(result.planPath).toBe(join(testDir, "docs/planning/custom-cluster/PLAN.md"));
    expect(existsSync(result.planPath)).toBe(true);
    expect(assertValidBlueprintStructure(result.markdown)).toBe(true);
  });
});

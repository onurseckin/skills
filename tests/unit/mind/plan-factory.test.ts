import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateAndWritePlan,
  generatePlanMarkdown,
  writePlanFile,
} from "../../../olt/scripts/src/mind/preplanning/plan-factory.ts";
import {
  transitionBacklogItemsToPlanned,
  transitionDefectsToPlanned,
  updateBridgeState,
} from "../../../olt/scripts/src/mind/preplanning/bridge-state.ts";
import type {
  RawBacklogItem,
  RawDefectItem,
  ThematicCluster,
} from "../../../olt/scripts/src/mind/preplanning/types.ts";

describe("Mind Continuous Pre-Planning: Plan Factory & Bridge State (Task 1.2)", () => {
  const sampleCluster: ThematicCluster = {
    cluster_id: "cluster-mind-a1b2c3d4",
    domain: "mind",
    title: "Mind Continuous Pre-Planning Engine",
    plan_path: "docs/planning/cluster-mind-a1b2c3d4/PLAN.md",
    backlog_item_ids: ["fb-mind-engine-1"],
    defect_ids: ["def-mind-pulse-1"],
    planned_at: "2026-08-29T10:00:00.000Z",
  };

  const sampleBacklog: readonly RawBacklogItem[] = [
    {
      id: "fb-mind-engine-1",
      title: "Mind continuous preplanner loop",
      content: "Implement non-stop preplanning pulse",
      priority: "CRITICAL_USER_FEEDBACK",
      status: "PENDING",
      category: "mind",
    },
  ];

  const sampleDefects: readonly RawDefectItem[] = [
    {
      id: "def-mind-pulse-1",
      title: "Mind pulse stagnation defect",
      description: "Mind idles while backlog is unprocessed",
      error_code: "MIND_PREPLANNING_STAGNATION",
      status: "OPEN",
      category: "mind",
    },
  ];

  it("generates structured Phase 1 markdown blueprint according to specification", () => {
    const md = generatePlanMarkdown(sampleCluster, sampleBacklog, sampleDefects);

    expect(md).toContain("# Mind Continuous Pre-Planning Engine Master Plan");
    expect(md).toContain("> **Tracking ID:** `fb-cluster-mind-a1b2c3d4`");
    expect(md).toContain(
      "> **Status:** `PHASE 1 - EXHAUSTIVE ARCHITECTURAL SPECIFICATION & TASK BREAKDOWN`",
    );
    expect(md).toContain("> **Target Subsystems:** `olt/scripts/src/mind/`, `tests/unit/mind/`");
    expect(md).toContain("## 1. Executive Summary & The Assembly Pipeline Vision");
    expect(md).toContain("## 2. Core Architectural Pillars & Design Specifications");
    expect(md).toContain("## 3. Work Breakdown & Disjoint Task Specifications");
    expect(md).toContain("Feature: Mind continuous preplanner loop");
    expect(md).toContain("Defect Remediation: Mind pulse stagnation defect");
    expect(md).toContain("## 4. Sequential Execution Order & Critical Path");
    expect(md).toContain("## 5. Exhaustive Traceability Matrix");
    expect(md).toContain(
      "| `fb-mind-engine-1` | Task 1.x | `tests/unit/mind/fb-mind-engine-1.test.ts` |",
    );
    expect(md).toContain(
      "| `def-mind-pulse-1` | Task 1.x | `tests/unit/mind/def-mind-pulse-1.test.ts` |",
    );
  });

  it("writes plan file to disk correctly", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "plan-factory-test-"));
    try {
      const result = generateAndWritePlan(sampleCluster, sampleBacklog, sampleDefects, tempDir);

      expect(existsSync(result.planPath)).toBe(true);
      const content = readFileSync(result.planPath, "utf-8");
      expect(content).toBe(result.markdown);
      expect(content).toContain("fb-cluster-mind-a1b2c3d4");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("transitions backlog items and defect items to PLANNED in bridge state ledgers", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "bridge-state-test-"));
    try {
      const oltDir = join(tempDir, ".olt");
      mkdirSync(oltDir, { recursive: true });
      const backlogFile = join(oltDir, "backlog.jsonl");
      const defectsFile = join(oltDir, "defects.jsonl");

      // Write initial state
      writeFileSync(
        backlogFile,
        JSON.stringify({ id: "fb-mind-engine-1", title: "Task 1", status: "PENDING" }) +
          "\n" +
          JSON.stringify({ id: "other-task", title: "Other", status: "PENDING" }) +
          "\n",
      );

      writeFileSync(
        defectsFile,
        JSON.stringify({ id: "def-mind-pulse-1", title: "Defect 1", status: "OPEN" }) +
          "\n" +
          JSON.stringify({ id: "other-def", title: "Other Defect", status: "OPEN" }) +
          "\n",
      );

      const updateResult = updateBridgeState(sampleCluster, {
        backlogFile,
        defectsFile,
        rootDir: tempDir,
      });

      expect(updateResult.itemsUpdated).toBe(1);
      expect(updateResult.defectsUpdated).toBe(1);

      // Verify updated backlog file
      const updatedBacklogLines = readFileSync(backlogFile, "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));

      expect(updatedBacklogLines[0].id).toBe("fb-mind-engine-1");
      expect(updatedBacklogLines[0].status).toBe("PLANNED");
      expect(updatedBacklogLines[0].plan_path).toBe(sampleCluster.plan_path);
      expect(updatedBacklogLines[0].planned_at).toBe(sampleCluster.planned_at);

      // Untouched item should retain original status
      expect(updatedBacklogLines[1].id).toBe("other-task");
      expect(updatedBacklogLines[1].status).toBe("PENDING");

      // Verify updated defects file
      const updatedDefectLines = readFileSync(defectsFile, "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));

      expect(updatedDefectLines[0].id).toBe("def-mind-pulse-1");
      expect(updatedDefectLines[0].status).toBe("PLANNED");
      expect(updatedDefectLines[0].plan_path).toBe(sampleCluster.plan_path);
      expect(updatedDefectLines[0].planned_at).toBe(sampleCluster.planned_at);

      // Untouched defect should retain original status
      expect(updatedDefectLines[1].id).toBe("other-def");
      expect(updatedDefectLines[1].status).toBe("OPEN");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

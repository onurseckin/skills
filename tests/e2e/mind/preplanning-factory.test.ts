import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { auditMindPreplanningStagnation } from "../../../olt/scripts/src/mind/auditing/mind-stagnation-auditor.ts";
import {
  isPreplanningNeeded,
  runPreplanningTick,
} from "../../../olt/scripts/src/mind/preplanning/continuous-preplanner.ts";
import { assertValidBlueprintStructure } from "../../../olt/scripts/src/mind/preplanning/plan-factory.ts";
import type {
  RawBacklogItem,
  RawDefectItem,
} from "../../../olt/scripts/src/mind/preplanning/types.ts";

describe("Mind Pre-Planning Factory End-to-End Suite (Task 3.2)", () => {
  it("executes complete lifecycle intake, clustering, blueprint formulation, bridge locking, and stagnation audit", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "preplanning-e2e-"));
    try {
      const oltDir = join(tempDir, ".olt");
      mkdirSync(oltDir, { recursive: true });
      const backlogPath = join(oltDir, "backlog.jsonl");
      const defectsPath = join(oltDir, "defects.jsonl");

      // 1. Simulate 10 realistic backlog items across diverse domains
      const backlogItems: readonly RawBacklogItem[] = [
        {
          id: "fb-core-01",
          title: "Global type registry synchronization",
          category: "core",
          status: "PENDING",
        },
        {
          id: "fb-core-02",
          title: "Immutable state projection cache",
          category: "core",
          status: "PENDING",
        },
        {
          id: "fb-mind-01",
          title: "Cognitive pulse frequency coordinator",
          category: "mind",
          status: "PENDING",
        },
        {
          id: "fb-mind-02",
          title: "Charter goal divergence watcher",
          category: "mind",
          status: "PENDING",
        },
        {
          id: "fb-val-01",
          title: "APCA contrast ratio assertion gate",
          category: "validation",
          status: "PENDING",
        },
        {
          id: "fb-val-02",
          title: "Flock lock contention stress tests",
          category: "validation",
          status: "PENDING",
        },
        {
          id: "fb-tool-01",
          title: "CLI preplan command integration",
          category: "tooling",
          status: "PENDING",
        },
        {
          id: "fb-tool-02",
          title: "Telemetry inspection formatter",
          category: "tooling",
          status: "PENDING",
        },
        {
          id: "fb-eng-01",
          title: "RocksDB KV storage engine driver",
          category: "engine",
          status: "PENDING",
        },
        {
          id: "fb-rep-01",
          title: "Doctor health check diagnostics report",
          category: "reporting",
          status: "PENDING",
        },
      ];

      // 2. Simulate 5 realistic defect entries across diverse domains
      const defectItems: readonly RawDefectItem[] = [
        {
          id: "def-mind-01",
          title: "Mind pulse starvation under load",
          category: "mind",
          status: "OPEN",
          error_code: "MIND_STARVATION",
        },
        {
          id: "def-val-01",
          title: "Flaky assertion in lease verifier",
          category: "validation",
          status: "OPEN",
          error_code: "VERIFIER_FLAKE",
        },
        {
          id: "def-tool-01",
          title: "CLI argument parser flag drop",
          category: "tooling",
          status: "OPEN",
          error_code: "CLI_FLAG_DROP",
        },
        {
          id: "def-eng-01",
          title: "Stale file descriptor leak on abort",
          category: "engine",
          status: "OPEN",
          error_code: "FD_LEAK",
        },
        {
          id: "def-rep-01",
          title: "Doctor summary table markdown wrap error",
          category: "reporting",
          status: "OPEN",
          error_code: "MD_WRAP",
        },
      ];

      writeFileSync(
        backlogPath,
        backlogItems.map((item) => JSON.stringify(item)).join("\n") + "\n",
      );
      writeFileSync(defectsPath, defectItems.map((def) => JSON.stringify(def)).join("\n") + "\n");

      // 3. Assert initial state: preplanning needed, stagnation auditor detects backlog
      expect(
        isPreplanningNeeded({
          rootDir: tempDir,
          backlogFile: backlogPath,
          defectsFile: defectsPath,
        }),
      ).toBe(true);

      const preAudit = auditMindPreplanningStagnation({
        rootDir: tempDir,
        backlogFile: backlogPath,
        defectsFile: defectsPath,
        lastPreplanTimestamp: new Date(Date.now() - 300_000).toISOString(),
      });
      expect(preAudit.is_stagnant).toBe(true);
      expect(preAudit.pending_backlog_count).toBe(10);
      expect(preAudit.open_defects_count).toBe(5);

      // 4. Test Dry-Run Mode first
      const dryResult = runPreplanningTick({
        rootDir: tempDir,
        backlogFile: backlogPath,
        defectsFile: defectsPath,
        targetDir: join(tempDir, "docs/planning"),
        dryRun: true,
      });
      expect(dryResult.clusters.length).toBe(6); // core, mind, validation, tooling, engine, reporting
      expect(dryResult.items_planned).toBe(10);
      expect(dryResult.defects_planned).toBe(5);

      // Verify dry-run did not alter files on disk
      const unchangedBacklog = readFileSync(backlogPath, "utf-8").trim().split("\n");
      expect(unchangedBacklog.every((l) => JSON.parse(l).status === "PENDING")).toBe(true);

      // 5. Execute Full Pre-Planning Factory Tick
      const liveResult = runPreplanningTick({
        rootDir: tempDir,
        backlogFile: backlogPath,
        defectsFile: defectsPath,
        targetDir: join(tempDir, "docs/planning"),
      });

      expect(liveResult.clusters.length).toBe(6);
      expect(liveResult.items_planned).toBe(10);
      expect(liveResult.defects_planned).toBe(5);
      expect(liveResult.plan_files_written.length).toBe(6);

      // 6. Verify each generated Phase 1 blueprint file on disk
      for (const writtenFile of liveResult.plan_files_written) {
        expect(existsSync(writtenFile)).toBe(true);
        const planContent = readFileSync(writtenFile, "utf-8");
        expect(assertValidBlueprintStructure(planContent)).toBe(true);
        expect(planContent).toContain("## 1. Executive Summary");
        expect(planContent).toContain("## 2. Core Architectural Pillars");
        expect(planContent).toContain("## 3. Work Breakdown");
        expect(planContent).toContain("## 4. Sequential Execution Order");
        expect(planContent).toContain("## 5. Exhaustive Traceability Matrix");
      }

      // 7. Verify Bridge State in ledgers
      const postBacklog = readFileSync(backlogPath, "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as RawBacklogItem);
      expect(postBacklog.length).toBe(10);
      expect(postBacklog.every((item) => item.status === "PLANNED")).toBe(true);
      expect(
        postBacklog.every(
          (item) => typeof item.plan_path === "string" && item.plan_path.endsWith("PLAN.md"),
        ),
      ).toBe(true);
      expect(postBacklog.every((item) => typeof item.planned_at === "string")).toBe(true);

      const postDefects = readFileSync(defectsPath, "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as RawDefectItem);
      expect(postDefects.length).toBe(5);
      expect(postDefects.every((d) => d.status === "PLANNED")).toBe(true);
      expect(
        postDefects.every(
          (d) => typeof d.plan_path === "string" && d.plan_path.endsWith("PLAN.md"),
        ),
      ).toBe(true);

      // 8. Assert Stagnation Auditor reports healthy status post-run
      const postAudit = auditMindPreplanningStagnation({
        rootDir: tempDir,
        backlogFile: backlogPath,
        defectsFile: defectsPath,
        lastPreplanTimestamp: liveResult.completed_at,
      });
      expect(postAudit.is_stagnant).toBe(false);
      expect(postAudit.pending_backlog_count).toBe(0);
      expect(postAudit.open_defects_count).toBe(0);
      expect(postAudit.error_code).toBeUndefined();

      // 9. Execute CLI harness operations and verify responses
      const cliStatusResult = await execute(["factory:status", "--repo", tempDir], {
        executingRuntime: tempDir,
      });
      expect(cliStatusResult).toBeDefined();
      expect(typeof (cliStatusResult as { markdown?: string }).markdown).toBe("string");
      expect((cliStatusResult as { markdown: string }).markdown).toContain(
        "Factory Engine & Assembly Pipeline Status",
      );
      expect((cliStatusResult as { markdown: string }).markdown).toContain(
        "Pre-Planning Needed**: NO",
      );

      const cliPreplanResult = await execute(["factory:preplan", "--repo", tempDir], {
        executingRuntime: tempDir,
      });
      expect(cliPreplanResult).toBeDefined();
      expect((cliPreplanResult as { markdown: string }).markdown).toContain(
        "Continuous Pre-Planning Factory Run Summary",
      );
      expect((cliPreplanResult as { markdown: string }).markdown).toContain(
        "Clusters Created**: 0",
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

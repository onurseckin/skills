import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isPreplanningNeeded,
  runPreplanningTick,
} from "../../../olt/scripts/src/mind/preplanning/continuous-preplanner.ts";

describe("Mind Continuous Pre-Planning: Autonomous Zero-Idle Loop (Task 1.3)", () => {
  it("detects preplanning need and executes end-to-end continuous preplanning tick", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "preplanner-test-"));
    try {
      const oltDir = join(tempDir, ".olt");
      mkdirSync(oltDir, { recursive: true });
      const backlogFile = join(oltDir, "backlog.jsonl");
      const defectsFile = join(oltDir, "defects.jsonl");

      // Write sample backlog items
      writeFileSync(
        backlogFile,
        JSON.stringify({
          id: "fb-mind-engine-1",
          title: "Mind continuous preplanner engine",
          content: "Zero idle continuous loop",
          category: "mind",
          status: "PENDING",
        }) +
          "\n" +
          JSON.stringify({
            id: "fb-cli-tooling-1",
            title: "CLI factory ops commands",
            content: "factory:preplan and factory:status",
            category: "tooling",
            status: "PENDING",
          }) +
          "\n",
      );

      // Write sample defects
      writeFileSync(
        defectsFile,
        JSON.stringify({
          id: "def-mind-stagnation-1",
          title: "Mind preplanning stagnation defect",
          error_code: "MIND_PREPLANNING_STAGNATION",
          category: "mind",
          status: "OPEN",
        }) + "\n",
      );

      // 1. Check preplanning is needed
      expect(isPreplanningNeeded({ rootDir: tempDir, backlogFile, defectsFile })).toBe(true);

      // 2. Run preplanning tick
      const result = runPreplanningTick({
        rootDir: tempDir,
        backlogFile,
        defectsFile,
      });

      expect(result.clusters.length).toBe(2); // mind and tooling clusters
      expect(result.items_planned).toBe(2);
      expect(result.defects_planned).toBe(1);
      expect(result.plan_files_written.length).toBe(2);

      for (const planPath of result.plan_files_written) {
        expect(existsSync(planPath)).toBe(true);
        const content = readFileSync(planPath, "utf-8");
        expect(content).toContain("Master Plan");
        expect(content).toContain("PHASE 1 - EXHAUSTIVE ARCHITECTURAL SPECIFICATION");
      }

      // 3. Verify bridge state in ledgers
      const updatedBacklog = readFileSync(backlogFile, "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));

      expect(updatedBacklog.every((item) => item.status === "PLANNED")).toBe(true);
      expect(updatedBacklog.every((item) => typeof item.plan_path === "string")).toBe(true);

      const updatedDefects = readFileSync(defectsFile, "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));

      expect(updatedDefects.every((d) => d.status === "PLANNED")).toBe(true);
      expect(updatedDefects.every((d) => typeof d.plan_path === "string")).toBe(true);

      // 4. Second preplanning tick should be clean no-op
      expect(isPreplanningNeeded({ rootDir: tempDir, backlogFile, defectsFile })).toBe(false);
      const secondResult = runPreplanningTick({
        rootDir: tempDir,
        backlogFile,
        defectsFile,
      });
      expect(secondResult.clusters.length).toBe(0);
      expect(secondResult.items_planned).toBe(0);
      expect(secondResult.defects_planned).toBe(0);
      expect(secondResult.plan_files_written.length).toBe(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("handles dry-run mode without modifying files on disk", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "preplanner-dry-"));
    try {
      const oltDir = join(tempDir, ".olt");
      mkdirSync(oltDir, { recursive: true });
      const backlogFile = join(oltDir, "backlog.jsonl");
      const defectsFile = join(oltDir, "defects.jsonl");

      writeFileSync(
        backlogFile,
        JSON.stringify({
          id: "fb-validation-1",
          title: "Validator test suite",
          category: "validation",
          status: "PENDING",
        }) + "\n",
      );
      writeFileSync(defectsFile, "");

      const result = runPreplanningTick({
        rootDir: tempDir,
        backlogFile,
        defectsFile,
        dryRun: true,
      });

      expect(result.clusters.length).toBe(1);
      expect(result.items_planned).toBe(1);

      // In dry run, plan file should not have been created on disk
      const fullPlanPath = join(tempDir, result.clusters[0].plan_path);
      expect(existsSync(fullPlanPath)).toBe(false);

      // Backlog item status should remain PENDING
      const backlogContent = readFileSync(backlogFile, "utf-8");
      expect(backlogContent).toContain('"PENDING"');
      expect(backlogContent).not.toContain('"PLANNED"');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

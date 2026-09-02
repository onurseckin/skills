import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectRepositoryStructure,
  synthesizeSmartTasksFromSelfEvolution,
} from "../../../../olt/scripts/src/mind/tasks/smart/executor/evolution/self-evolution.ts";

describe("Self-Evolution Smart Task Synthesis Suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `self-evo-cov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Default 3-Step Creative PM Flow Synthesis", () => {
    it("synthesizes the standard 3-step PM flow when defect log has no open defects", () => {
      const result = synthesizeSmartTasksFromSelfEvolution({
        capsulesDir: tempDir,
        workspaceRoot: tempDir,
      });

      expect(result.mode).toBe("self_evolution");
      expect(result.tasks.length).toBe(3);
      expect(result.source_items_count).toBe(0);
      expect(result.anti_batching_enforced).toBe(true);
      expect(typeof result.fast_path_compaction).toBe("boolean");
      expect(result.summary).toContain("Autonomous self-evolution synthesized 3 isolated task(s)");

      const [step1, step2, step3] = result.tasks;
      expect(step1).toBeDefined();
      expect(step2).toBeDefined();
      expect(step3).toBeDefined();

      // Step 1: Baseline Quality & Invariant Hygiene
      expect(step1?.id).toBe("task-1-invariant-hardening");
      expect(step1?.label).toContain("Step 1: Baseline Quality & Invariant Hygiene");
      expect(step1?.source_type).toBe("self_evolution");
      expect(step1?.priority).toBe("HIGH");
      expect(step1?.assigned_tier).toBe("Tier_3_Implementer");
      expect(step1?.assigned_implementer).toBe("implementer-invariant-hardening");
      expect(step1?.assigned_validator).toBe("validator-invariant-hardening");
      expect(step1?.charter_goals).toEqual(["G1"]);
      expect(step1?.acceptance_criteria.length).toBe(3);

      // Step 2: Product & UX Quality Audit
      expect(step2?.id).toBe("task-2-product-ux-quality-audit");
      expect(step2?.label).toContain("Step 2: Product & UX Quality Audit");
      expect(step2?.source_type).toBe("self_evolution");
      expect(step2?.priority).toBe("HIGH");
      expect(step2?.assigned_tier).toBe("Tier_2_Coordinator");
      expect(step2?.assigned_implementer).toBe("implementer-product-ux-audit");
      expect(step2?.assigned_validator).toBe("validator-product-ux-audit");
      expect(step2?.charter_goals).toEqual(["G2"]);

      // Step 3: Autonomous Creative Ideation
      expect(step3?.id).toBe("task-3-autonomous-creative-ideation");
      expect(step3?.label).toContain("Step 3: Autonomous Creative Ideation");
      expect(step3?.source_type).toBe("self_evolution");
      expect(step3?.priority).toBe("MEDIUM");
      expect(step3?.assigned_tier).toBe("Tier_1_Orchestrator");
      expect(step3?.assigned_implementer).toBe("implementer-creative-ideation");
      expect(step3?.assigned_validator).toBe("validator-creative-ideation");
      expect(step3?.charter_goals).toEqual(["G3"]);
      expect(step3?.write_scope).toEqual(["docs/planning/PLAN.md", "docs/planning/"]);
    });

    it("re-exports detectRepositoryStructure pure function", () => {
      expect(typeof detectRepositoryStructure).toBe("function");
      const structure = detectRepositoryStructure(tempDir);
      expect(typeof structure.hasTests).toBe("boolean");
      expect(typeof structure.hasSrc).toBe("boolean");
      expect(typeof structure.hasApps).toBe("boolean");
      expect(typeof structure.hasPackages).toBe("boolean");
    });
  });

  describe("Open Defect Autonomous Remediation Task Synthesis", () => {
    it("synthesizes critical defect remediation task when open defect is discovered", () => {
      const defectEntry = {
        id: "DEF-CORE-101",
        status: "open",
        category: "boundary_violation",
        observation: "Boundary violation detected in state machine dispatch loop",
        description: "Core dispatch state loop bypasses validation guard",
      };
      writeFileSync(join(tempDir, "defects.jsonl"), `${JSON.stringify(defectEntry)}\n`, "utf-8");

      const result = synthesizeSmartTasksFromSelfEvolution({
        capsulesDir: tempDir,
        workspaceRoot: tempDir,
        charterGoals: ["CHARTER-001"],
      });

      expect(result.source_items_count).toBe(1);
      expect(result.tasks.length).toBe(4);

      const defectTask = result.tasks[0];
      expect(defectTask?.id).toBe("task-1-defect-def-core-101");
      expect(defectTask?.label).toBe("Automated Defect Remediation (boundary_violation)");
      expect(defectTask?.source_type).toBe("defect_remediation");
      expect(defectTask?.priority).toBe("CRITICAL");
      expect(defectTask?.assigned_tier).toBe("Tier_3_Implementer");
      expect(defectTask?.candidate_id).toBe("DEF-CORE-101");
      expect(defectTask?.assigned_implementer).toBe("implementer-defect-def-core-101");
      expect(defectTask?.assigned_validator).toBe("validator-defect-def-core-101");
      expect(defectTask?.charter_goals).toEqual(["CHARTER-001"]);
      expect(defectTask?.acceptance_criteria[0]).toContain("DEF-CORE-101");
      expect(defectTask?.acceptance_criteria[0]).toContain(
        "Boundary violation detected in state machine dispatch loop",
      );
      expect(defectTask?.rationale).toContain(
        "Autonomous remediation for open defect DEF-CORE-101",
      );
      expect(defectTask?.metadata?.candidate_id).toBe("DEF-CORE-101");

      // Verify subsequent step numbers and task IDs shifted
      expect(result.tasks[1]?.id).toBe("task-2-invariant-hardening");
      expect(result.tasks[2]?.id).toBe("task-3-product-ux-quality-audit");
      expect(result.tasks[3]?.id).toBe("task-4-autonomous-creative-ideation");
    });

    it("falls back to description and slices observation at 100 chars when observation is absent", () => {
      const longDescription = "A".repeat(150);
      const defectEntry = {
        id: "DEF-LONG-202",
        status: "open",
        category: "syntax_error",
        description: longDescription,
      };
      writeFileSync(join(tempDir, "defects.jsonl"), `${JSON.stringify(defectEntry)}\n`, "utf-8");

      const result = synthesizeSmartTasksFromSelfEvolution({
        capsulesDir: tempDir,
        workspaceRoot: tempDir,
      });

      const defectTask = result.tasks[0];
      expect(defectTask?.acceptance_criteria[0]).toBe(
        `Remediate open defect DEF-LONG-202: ${"A".repeat(100)}`,
      );
      expect(defectTask?.charter_goals).toEqual(["G2"]);
    });
  });
});

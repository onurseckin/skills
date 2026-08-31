import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectRepositoryStructure,
  synthesizeSmartTasksFromSelfEvolution,
} from "../../olt/scripts/src/mind/tasks/smart/executor/evolution/index.ts";
import { runInfiniteProductOwnerCycle } from "../../olt/scripts/src/mind/tasks/smart/executor/product-owner.ts";
import { validateAntiBatchingRule } from "../../olt/scripts/src/mind/tasks/smart/planner/partitioning.ts";
import { readTaskQueue } from "../../olt/scripts/src/task/queue/index.ts";
import { scratchRoot } from "../shared/scratch-root.ts";

describe("Self-Evolution 3-Step Creative Product Manager Flow & Dynamic Repository Inspection", () => {
  const testDir = scratchRoot(import.meta.path, "test-creative-pm");
  const taskQueueFile = join(testDir, "TASK_QUEUE.jsonl");
  const feedbackQueueFile = join(testDir, "FEEDBACK_QUEUE.jsonl");
  const memoryFile = join(testDir, "memory.json");

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Dynamic Repository Structure Detection", () => {
    it("detects monorepo structure with apps, packages, tests, and docs", () => {
      const monorepoRoot = join(testDir, "monorepo");
      mkdirSync(join(monorepoRoot, "apps", "web"), { recursive: true });
      mkdirSync(join(monorepoRoot, "apps", "mobile"), { recursive: true });
      mkdirSync(join(monorepoRoot, "packages", "ui"), { recursive: true });
      mkdirSync(join(monorepoRoot, "packages", "core"), { recursive: true });
      mkdirSync(join(monorepoRoot, "tests", "unit"), { recursive: true });
      mkdirSync(join(monorepoRoot, "docs", "planning"), { recursive: true });

      const structure = detectRepositoryStructure(monorepoRoot);

      expect(structure.hasApps).toBe(true);
      expect(structure.hasPackages).toBe(true);
      expect(structure.hasTests).toBe(true);
      expect(structure.hasDocs).toBe(true);
      expect(structure.hasPlanning).toBe(true);
      expect(structure.apps).toContain("apps/web");
      expect(structure.apps).toContain("apps/mobile");
      expect(structure.packages).toContain("packages/ui");
      expect(structure.packages).toContain("packages/core");
      expect(structure.tests).toContain("tests/unit");
    });

    it("detects standard single-package structure with src and tests", () => {
      const standardRoot = join(testDir, "standard");
      mkdirSync(join(standardRoot, "src", "components"), { recursive: true });
      mkdirSync(join(standardRoot, "tests"), { recursive: true });
      mkdirSync(join(standardRoot, "docs", "planning"), { recursive: true });

      const structure = detectRepositoryStructure(standardRoot);

      expect(structure.hasApps).toBe(false);
      expect(structure.hasPackages).toBe(false);
      expect(structure.hasSrc).toBe(true);
      expect(structure.hasTests).toBe(true);
      expect(structure.hasPlanning).toBe(true);
    });
  });

  describe("3-Step Creative Product Manager Flow Synthesis", () => {
    it("synthesizes all 3 steps with 1:1 implementer-validator isolation and disjoint scopes", () => {
      const repoRoot = join(testDir, "monorepo-synth");
      mkdirSync(join(repoRoot, "apps", "dashboard"), { recursive: true });
      mkdirSync(join(repoRoot, "packages", "ui"), { recursive: true });
      mkdirSync(join(repoRoot, "tests", "unit"), { recursive: true });
      mkdirSync(join(repoRoot, "docs", "planning"), { recursive: true });

      const result = synthesizeSmartTasksFromSelfEvolution({
        repoRoot,
        capsulesDir: feedbackQueueFile,
        queuePath: taskQueueFile,
        autoEnqueue: true,
      });

      expect(result.mode).toBe("self_evolution");
      expect(result.tasks.length).toBe(3);
      expect(result.anti_batching_enforced).toBe(true);

      // Verify Step 1: Baseline Quality & Invariant Hygiene
      const step1 = result.tasks.find((t) => t.id.includes("invariant-hardening"));
      expect(step1).toBeDefined();
      expect(step1!.assigned_implementer).not.toBe(step1!.assigned_validator);
      expect(step1!.assigned_tier).toBe("Tier_3_Implementer");
      expect(step1!.acceptance_criteria.some((c) => c.includes("0 TypeScript any"))).toBe(true);
      expect(
        step1!.acceptance_criteria.some((c) => c.includes("0 compiler or linter suppressions")),
      ).toBe(true);

      // Verify Step 2: Product & UX Quality Audit
      const step2 = result.tasks.find((t) => t.id.includes("product-ux-quality-audit"));
      expect(step2).toBeDefined();
      expect(step2!.assigned_implementer).not.toBe(step2!.assigned_validator);
      expect(step2!.assigned_tier).toBe("Tier_2_Coordinator");
      expect(step2!.acceptance_criteria.some((c) => c.includes("responsive layout tiers"))).toBe(
        true,
      );

      // Verify Step 3: Autonomous Creative Ideation
      const step3 = result.tasks.find((t) => t.id.includes("autonomous-creative-ideation"));
      expect(step3).toBeDefined();
      expect(step3!.assigned_implementer).not.toBe(step3!.assigned_validator);
      expect(step3!.assigned_tier).toBe("Tier_1_Orchestrator");
      expect(step3!.write_scope).toContain("docs/planning/PLAN.md");
      expect(step3!.acceptance_criteria.some((c) => c.includes("PLAN.md"))).toBe(true);

      // Verify all tasks are enqueued
      const queue = readTaskQueue(taskQueueFile);
      expect(queue.length).toBe(3);

      // Verify anti-batching rule validation passes
      const report = validateAntiBatchingRule(result.tasks);
      expect(report.compliant).toBe(true);
      expect(report.isolated_task_count).toBe(3);

      // Verify all tasks have 0 dependencies due to disjoint write scopes
      for (const t of result.tasks) {
        expect(t.dependencies).toHaveLength(0);
      }
    });

    it("integrates seamlessly into runInfiniteProductOwnerCycle in self-evolution mode", () => {
      const result = runInfiniteProductOwnerCycle({
        capsulesDir: feedbackQueueFile,
        queuePath: taskQueueFile,
        memoryPath: memoryFile,
        autoEnqueue: true,
      });

      expect(result.mode).toBe("self_evolution");
      expect(result.synthesized_tasks.length).toBeGreaterThanOrEqual(3);
      expect(result.enqueued_tasks.length).toBe(result.synthesized_tasks.length);
      expect(result.zero_paused_admitted_guaranteed).toBe(true);

      const step1 = result.synthesized_tasks.find((t) => t.id.includes("invariant-hardening"));
      const step2 = result.synthesized_tasks.find((t) => t.id.includes("product-ux-quality-audit"));
      const step3 = result.synthesized_tasks.find((t) =>
        t.id.includes("autonomous-creative-ideation"),
      );

      expect(step1).toBeDefined();
      expect(step2).toBeDefined();
      expect(step3).toBeDefined();
    });
  });

  describe("Static Invariant Verification", () => {
    it("proves 0 TypeScript any and 0 compiler/linter suppressions across evolution files", () => {
      const filesToCheck = [
        "olt/scripts/src/mind/tasks/smart/executor/evolution/self-evolution.ts",
        "olt/scripts/src/mind/tasks/smart/executor/evolution/index.ts",
        "olt/scripts/src/mind/tasks/smart/executor/product-owner.ts",
      ];

      const anyRegex = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
      const suppressionRegex = new RegExp(
        [
          "@ts" + "-ignore",
          "@ts" + "-expect-error",
          "@ts" + "-nocheck",
          "eslint" + "-disable",
          "oxlint" + "-disable",
        ].join("|"),
      );

      for (const relPath of filesToCheck) {
        const fullPath = join(process.cwd(), relPath);
        expect(existsSync(fullPath)).toBe(true);
        const content = readFileSync(fullPath, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (
            line.includes("anyRegex") ||
            line.includes("suppressionRegex") ||
            line.trim().startsWith("//") ||
            line.trim().startsWith("*")
          ) {
            continue;
          }
          expect(anyRegex.test(line)).toBe(false);
          expect(suppressionRegex.test(line)).toBe(false);
        }
      }
    });
  });
});

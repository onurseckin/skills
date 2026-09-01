import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  validateCriticAntiBatching,
  validateReviewAntiBatching,
} from "../../../olt/scripts/src/validation/anti-batching.ts";
import {
  assertAntiBatchingRule,
  detectScopeCollisions,
  partitionCandidatesStrictly,
  partitionGroupedFeedbacksStrictly,
  partitionIntoDisjointWaves,
  synthesizeAutonomousTasks,
  validateAntiBatchingIsolation,
  type SmartTaskPlan,
} from "../../../olt/scripts/src/mind/tasks/smart/index.ts";
import {
  assertDefectCandidatesIsolated,
  assertDiscriminatingSignOffProofs,
  assertOneToOneImplementerValidatorIsolation,
  partitionDefectsToIsolatedTasks,
} from "../../../olt/scripts/src/orchestrator/anti-batching.ts";
import { validateReview } from "../../../olt/scripts/src/workflow/review/validate-review.ts";
import { parseCompletionAssessment } from "../../../olt/scripts/src/workflow/completion/review-input.ts";
import type { TaskRecord, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";
import type { FeedbackItem } from "../../../olt/scripts/src/mind/feedback/queue/index.ts";
import { tmpdir } from "node:os";

describe("Strict Anti-Batching Pipeline & 1:1 Isolated Implementer-Validator Verification", () => {
  const testDir = join(
    tmpdir(),
    "test-validation-anti-batching-" + Math.random().toString(36).slice(2),
  );
  const feedbackFile = join(testDir, "FEEDBACK_QUEUE.jsonl");
  const taskQueueFile = join(testDir, "TASK_QUEUE.jsonl");

  function setup(): void {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  }

  function teardown(): void {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  describe("1. Strict 1:1 Feedback & Directive Partitioning", () => {
    describe("7. Orchestrator Defect Candidate Partitioning", () => {
      it("partitionDefectsToIsolatedTasks creates 1:1 isolated repair tasks from findings", () => {
        const findings = [
          {
            id: "FINDING-NULL-PTR",
            requirement_id: "REQ-1",
            severity: "critical" as const,
            observation: "Null pointer when payload is empty in src/parser.ts",
            remediation: "Add null check in src/parser.ts",
            revalidation: "bun test tests/validation/parser.test.ts",
            file_paths: ["src/parser.ts"],
          },
          {
            id: "FINDING-RACE-COND",
            requirement_id: "REQ-2",
            severity: "important" as const,
            observation: "Race condition in transaction ledger in src/ledger.ts",
            remediation: "Add mutex lock in src/ledger.ts",
            revalidation: "bun test tests/validation/ledger.test.ts",
            file_paths: ["src/ledger.ts"],
          },
        ];

        const repairTasks = partitionDefectsToIsolatedTasks(findings, { roundNumber: 2 });
        expect(repairTasks.length).toBe(2);

        expect(repairTasks[0]!.id).toContain("repair-r2-1-finding-null-ptr");
        expect(repairTasks[0]!.assigned_implementer).toBe("implementer-finding-null-ptr");
        expect(repairTasks[0]!.assigned_validator).toBe("validator-finding-null-ptr");
        expect(repairTasks[0]!.priority).toBe("CRITICAL");
        expect(repairTasks[0]!.write_scope).toEqual(["src/parser.ts"]);

        expect(repairTasks[1]!.id).toContain("repair-r2-2-finding-race-cond");
        expect(repairTasks[1]!.assigned_implementer).toBe("implementer-finding-race-cond");
        expect(repairTasks[1]!.assigned_validator).toBe("validator-finding-race-cond");
        expect(repairTasks[1]!.priority).toBe("HIGH");
        expect(repairTasks[1]!.write_scope).toEqual(["src/ledger.ts"]);

        const report = validateAntiBatchingIsolation(repairTasks);
        expect(report.compliant).toBe(true);
        expect(report.isolated_task_count).toBe(2);
      });

      it("assertDefectCandidatesIsolated checks for duplicate finding IDs", () => {
        const duplicateFindings = [
          {
            id: "FINDING-1",
            requirement_id: "REQ-1",
            severity: "minor" as const,
            observation: "obs 1",
            remediation: "rem 1",
          },
          {
            id: "FINDING-1",
            requirement_id: "REQ-2",
            severity: "minor" as const,
            observation: "obs 2",
            remediation: "rem 2",
          },
        ];

        expect(() => {
          assertDefectCandidatesIsolated(duplicateFindings);
        }).toThrow("Duplicate defect candidate id: FINDING-1");
      });
    });

    describe("8. Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
      it("verifies zero TypeScript any and zero suppressions across all anti-batching pipeline source and test files", () => {
        const filesToAudit = [
          "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/validation/anti-batching.ts",
          "/Users/onurseckinsenoglu/repos/skills/tests/validation/anti-batching/anti-batching-pipeline.test.ts",
        ];

        const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
        const suppressionPattern = new RegExp(
          [
            "@ts" + "-ignore",
            "@ts" + "-expect-error",
            "@ts" + "-nocheck",
            "eslint" + "-disable",
            "oxlint" + "-disable",
          ].join("|"),
        );

        for (const filePath of filesToAudit) {
          expect(existsSync(filePath)).toBe(true);
          const content = readFileSync(filePath, "utf-8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;

            expect(anyPattern.test(line)).toBe(false);
            expect(suppressionPattern.test(line)).toBe(false);
          }
        }
      });
    });
  });
});

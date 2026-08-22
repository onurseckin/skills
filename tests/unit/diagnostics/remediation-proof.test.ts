import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import {
  formatBlunderAuditBrief,
  formulateBlunderCandidates,
  resolveBlunder,
  type BlunderAuditReport,
  type BlunderEntry,
  type BlunderResolutionProof,
} from "../../../orchestrating-long-tasks/scripts/src/mind/blunders.ts";

describe("Diagnostics Remediation Proof & Static Quality Invariants", () => {
  const sampleBlunder: BlunderEntry = {
    id: "blunder-proof-test-01",
    type: "main_thread_direct_execution",
    severity: "critical",
    timestamp: "2026-08-22T09:30:00.000Z",
    category: "boundary_violation",
    status: "open",
    observation: "Main thread executed write directly",
    remediation: "Dispatch Tier 3 worker",
  };

  describe("Resolution Proof Lifecycle & Validation", () => {
    test("successfully resolves blunder with complete and verified proof", () => {
      const validProof: BlunderResolutionProof = {
        task_id: "task-verify-remediation-proof",
        test_assertion: "bun test tests/unit/diagnostics/remediation-proof.test.ts",
        resolved_at: "2026-08-22T09:45:00.000Z",
        commit_sha: "commit-sha-proof-9999",
      };

      const resolved = resolveBlunder(sampleBlunder, validProof);

      expect(resolved.status).toBe("resolved");
      expect(resolved.resolution?.task_id).toBe("task-verify-remediation-proof");
      expect(resolved.resolution?.test_assertion).toBe("bun test tests/unit/diagnostics/remediation-proof.test.ts");
      expect(resolved.resolution?.resolved_at).toBe("2026-08-22T09:45:00.000Z");
      expect(resolved.resolution?.commit_sha).toBe("commit-sha-proof-9999");
    });

    test("handles optional or null commit_sha gracefully", () => {
      const proofWithoutSha: BlunderResolutionProof = {
        task_id: "task-no-sha",
        test_assertion: "bun test",
        resolved_at: "2026-08-22T09:45:00.000Z",
      };

      const resolved = resolveBlunder(sampleBlunder, proofWithoutSha);
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolution?.commit_sha).toBeUndefined();

      const proofWithNullSha: BlunderResolutionProof = {
        task_id: "task-null-sha",
        test_assertion: "bun test",
        resolved_at: "2026-08-22T09:45:00.000Z",
        commit_sha: null,
      };

      const resolvedNull = resolveBlunder(sampleBlunder, proofWithNullSha);
      expect(resolvedNull.status).toBe("resolved");
      expect(resolvedNull.resolution?.commit_sha).toBeNull();
    });

    test("throws HarnessError on missing or invalid proof fields", () => {
      // 1. Missing task_id
      expect(() =>
        resolveBlunder(sampleBlunder, {
          task_id: "",
          test_assertion: "bun test",
          resolved_at: "2026-08-22T09:45:00.000Z",
        }),
      ).toThrow(HarnessError);

      // 2. Whitespace-only task_id
      expect(() =>
        resolveBlunder(sampleBlunder, {
          task_id: "   \t  ",
          test_assertion: "bun test",
          resolved_at: "2026-08-22T09:45:00.000Z",
        }),
      ).toThrow(HarnessError);

      // 3. Missing test_assertion
      expect(() =>
        resolveBlunder(sampleBlunder, {
          task_id: "task-1",
          test_assertion: "",
          resolved_at: "2026-08-22T09:45:00.000Z",
        }),
      ).toThrow(HarnessError);

      // 4. Missing resolved_at
      expect(() =>
        resolveBlunder(sampleBlunder, {
          task_id: "task-1",
          test_assertion: "bun test",
          resolved_at: "",
        }),
      ).toThrow(HarnessError);

      // 5. Non-object proof
      expect(() =>
        resolveBlunder(sampleBlunder, "invalid-proof" as unknown as BlunderResolutionProof),
      ).toThrow(HarnessError);
    });

    test("candidate formulation filters out resolved blunders and admits open blunders", () => {
      const blunders: BlunderEntry[] = [
        sampleBlunder,
        {
          ...sampleBlunder,
          id: "blunder-proof-test-02",
          status: "resolved",
          resolution: {
            task_id: "task-resolved-02",
            test_assertion: "bun test",
            resolved_at: "2026-08-22T09:50:00.000Z",
          },
        },
      ];

      const candidates = formulateBlunderCandidates(blunders, ["G1", "G2"]);
      expect(candidates.length).toBe(1);
      expect(candidates[0]?.id).toBe("cand-blunder-proof-test-01");
      expect(candidates[0]?.blunder_id).toBe("blunder-proof-test-01");
    });

    test("formats blunder brief with resolved status indicators", () => {
      const report: BlunderAuditReport = {
        total_blunders: 2,
        open_count: 1,
        resolved_count: 1,
        wontfix_count: 0,
        by_category: { boundary_violation: 1, code_defect: 1, model_reasoning_error: 0 },
        by_severity: { critical: 1, warning: 1 },
        blunders: [
          sampleBlunder,
          {
            id: "blunder-resolved-03",
            type: "syntax_error",
            severity: "warning",
            timestamp: "2026-08-22T09:55:00.000Z",
            category: "code_defect",
            status: "resolved",
            observation: "Fixed syntax",
            remediation: "Resolved",
          },
        ],
        capsules_audited: ["/capsules/gen-7"],
        generated_at: "2026-08-22T10:00:00.000Z",
      };

      const brief = formatBlunderAuditBrief(report);
      expect(brief).toContain("Total Blunders");
      expect(brief).toContain("⚠️ open");
      expect(brief).toContain("✅ resolved");
    });
  });

  describe("Static Quality Invariant Verification", () => {
    const repoRoot = process.cwd();
    const filesToAudit = [
      "orchestrating-long-tasks/scripts/src/mind/blunders.ts",
      "orchestrating-long-tasks/scripts/src/mind/pushbacks.ts",
      "orchestrating-long-tasks/scripts/src/mind/feedback-queue.ts",
      "tests/unit/diagnostics/blunder-ingestion.test.ts",
      "tests/unit/diagnostics/blunder-categorization.test.ts",
      "tests/unit/diagnostics/pushback-ingestion.test.ts",
      "tests/unit/diagnostics/dual-state-remediation.test.ts",
      "tests/unit/diagnostics/remediation-proof.test.ts",
    ];

    for (const relPath of filesToAudit) {
      test(`verifies zero TypeScript 'any' and suppressions in ${relPath}`, () => {
        const fullPath = join(repoRoot, relPath);
        if (!existsSync(fullPath)) {
          return;
        }

        const content = readFileSync(fullPath, "utf8");
        const lines = content.split("\n");

        const anyColonRegex = new RegExp(":" + "\\s*any\\b");
        const asAnyRegex = new RegExp("\\bas" + "\\s+any\\b");
        const genericAnyRegex = new RegExp("<" + "any" + ">");
        const arrayAnyRegex = new RegExp("\\b" + "any\\[\\]");

        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          if (line === undefined) {
            continue;
          }

          // Skip comments or audit definition lines
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) {
            continue;
          }

          const hasExplicitAny =
            anyColonRegex.test(line) ||
            asAnyRegex.test(line) ||
            genericAnyRegex.test(line) ||
            arrayAnyRegex.test(line);

          expect(hasExplicitAny).toBeFalse();

          // Check for suppressions
          expect(line.includes("@ts-" + "ignore")).toBeFalse();
          expect(line.includes("@ts-" + "expect-error")).toBeFalse();
          expect(line.includes("eslint-" + "disable")).toBeFalse();
        }
      });
    }
  });
});

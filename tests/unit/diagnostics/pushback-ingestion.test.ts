import { resolveDefectsPath, resolveBacklogPath } from "../../../olt/scripts/src/shared/paths.ts";
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getFeedbackStats,
  readFeedbackQueue,
  type FeedbackCategory,
  type FeedbackItem,
} from "../../../olt/scripts/src/mind/feedback-queue.ts";
import {
  ingestPushbacks,
  mapFeedbackCategoryToDefectCategory,
  parsePushbackMarkdown,
  resolvePushbackMarkdownPath,
  type PushbackAuditReport,
  type PushbackRecord,
} from "../../../olt/scripts/src/mind/pushbacks.ts";

describe("Diagnostics Pushback Ingestion Engine", () => {
  const repoRoot = process.cwd();
  const feedbackQueuePath = join(repoRoot, ".capsules", "FEEDBACK_QUEUE.jsonl");
  const pushbackDocPath = join(repoRoot, "USER_PUSHBACK_AND_SELF_AUDIT.md");

  describe("FEEDBACK_QUEUE.jsonl Ingestion", () => {
    test("reads and parses all items from actual FEEDBACK_QUEUE.jsonl", () => {
      if (!existsSync(feedbackQueuePath)) {
        return;
      }

      const items = readFeedbackQueue(feedbackQueuePath);
      expect(items.length).toBeGreaterThanOrEqual(1);

      const stats = getFeedbackStats(items);
      expect(stats.total).toBe(items.length);
      expect(
        stats.pending + stats.processed + stats.admitted + stats.declined + stats.completed,
      ).toBe(items.length);

      const validPriorities = new Set([
        "CRITICAL_USER_FEEDBACK",
        "HIGH_ARCHITECTURAL_FEATURE",
        "USER_DIRECTIVE",
        "NORMAL",
        "LOW",
      ]);
      const validStatuses = new Set(["PENDING", "ADMITTED", "DECLINED", "PROCESSED", "COMPLETED"]);

      // Check that all items match expected schema and properties
      for (const item of items) {
        expect(typeof item.id).toBe("string");
        expect(item.id.length).toBeGreaterThan(0);
        expect(typeof item.title).toBe("string");
        expect(item.title.length).toBeGreaterThan(0);
        expect(typeof item.content).toBe("string");
        expect(typeof item.timestamp).toBe("string");
        expect(validPriorities.has(item.priority)).toBeTrue();
        expect(validStatuses.has(item.status)).toBeTrue();
        expect(typeof item.category).toBe("string");
        expect(item.category.length).toBeGreaterThan(0);
      }
    });

    test("maps feedback queue categories to canonical defect categories", () => {
      // Boundary violations
      expect(mapFeedbackCategoryToDefectCategory("AGENT_CONTRACTS")).toBe("boundary_violation");
      expect(mapFeedbackCategoryToDefectCategory("WATCHDOG")).toBe("boundary_violation");
      expect(mapFeedbackCategoryToDefectCategory("EXECUTION_EFFICIENCY")).toBe(
        "boundary_violation",
      );
      expect(mapFeedbackCategoryToDefectCategory("ROLE_CONFUSION")).toBe("boundary_violation");
      expect(mapFeedbackCategoryToDefectCategory("boundary_confinement")).toBe(
        "boundary_violation",
      );

      // Model reasoning errors
      expect(mapFeedbackCategoryToDefectCategory("DOCUMENTATION")).toBe("model_reasoning_error");
      expect(mapFeedbackCategoryToDefectCategory("GENERAL")).toBe("model_reasoning_error");
      expect(mapFeedbackCategoryToDefectCategory("ARCHITECTURE")).toBe("model_reasoning_error");
      expect(mapFeedbackCategoryToDefectCategory("plan_revision")).toBe("model_reasoning_error");

      // Code defects
      expect(mapFeedbackCategoryToDefectCategory("CLI_TOOLING")).toBe("code_defect");
      expect(mapFeedbackCategoryToDefectCategory("CORE_ENGINE")).toBe("code_defect");
      expect(mapFeedbackCategoryToDefectCategory("REPAIR")).toBe("code_defect");
      expect(mapFeedbackCategoryToDefectCategory("SCALING")).toBe("code_defect");
      expect(mapFeedbackCategoryToDefectCategory("CORE_SCHEDULER")).toBe("code_defect");
      expect(mapFeedbackCategoryToDefectCategory("VALIDATION_ENGINE")).toBe("code_defect");
    });
  });

  const SAMPLE_PUSHBACK_MD = `# User Pushback & Canonical Self-Audit Record

## 1. Executive Summary & Pulse Generation 1 Convergence
- **Tier 0 Mind**: Candidate admission
- **Invariants**:
| Invariant | Requirement | Status | Evidence |
| :--- | :--- | :--- | :--- |
| **0 TypeScript any** | Strict ban | ✅ Verified | tsc clean |

## 2. Pushback Log & Forensics
### User Pushback #8: Canonical Command De-duplication (\`whoami\`), Zero Dead Code
- **Pushback Item 1 (G1: Command De-duplication)**:
  - _Issue_: Redundant \`whoami\` aliases.
  - _Resolution_: Canonicalized on whoami.
- **Pushback Item 2 (G2: Zero Dead Code)**:
  - _Issue_: Dead code in mind scripts.
  - _Resolution_: Eliminated dead code.

## 6. Pulse Generation 6 Convergence
- **Invariants**:
| Invariant | Requirement | Status | Evidence |
| :--- | :--- | :--- | :--- |
| **Critic Verification** | Approved | ✅ Verified | critic sign-off |
`;

  describe("USER_PUSHBACK_AND_SELF_AUDIT.md Parsing", () => {
    test("parses markdown audit records with pushback items and invariants", () => {
      const records = parsePushbackMarkdown(SAMPLE_PUSHBACK_MD);

      expect(records.length).toBeGreaterThanOrEqual(2);

      // Verify User Pushback #8 record
      const pushback8 = records.find((r) => r.pushback_number === 8);
      expect(pushback8 !== undefined).toBeTrue();
      if (pushback8 !== undefined) {
        expect(pushback8.title).toContain("Pushback #8");
        expect(pushback8.items.length).toBeGreaterThanOrEqual(2);

        const g1Item = pushback8.items.find(
          (it) =>
            it.title?.includes("G1") ||
            it.issue.includes("whoami") ||
            it.issue.includes("thread:identify"),
        );
        expect(g1Item !== undefined).toBeTrue();
        if (g1Item !== undefined) {
          expect(g1Item.issue.length).toBeGreaterThan(0);
          expect(g1Item.resolution.length).toBeGreaterThan(0);
        }

        const g2Item = pushback8.items.find(
          (it) =>
            it.title?.includes("G2") ||
            it.issue.includes("Dead code") ||
            it.issue.includes("dead code"),
        );
        expect(g2Item !== undefined).toBeTrue();
      }

      // Verify generation convergence records
      const gen1 = records.find((r) => r.generation === 1);
      expect(gen1 !== undefined).toBeTrue();
      if (gen1 !== undefined) {
        expect(gen1.invariants.length).toBeGreaterThanOrEqual(1);
        const anyInv = gen1.invariants.find((inv) => inv.invariant.includes("TypeScript"));
        expect(anyInv !== undefined).toBeTrue();
        if (anyInv !== undefined) {
          expect(anyInv.status).toContain("Verified");
        }
      }

      const gen6 = records.find((r) => r.generation === 6);
      expect(gen6 !== undefined).toBeTrue();
      if (gen6 !== undefined) {
        expect(gen6.invariants.length).toBeGreaterThanOrEqual(1);
        const criticInv = gen6.invariants.find((inv) => inv.invariant.includes("Critic"));
        expect(criticInv !== undefined).toBeTrue();
      }
    });

    test("resolves pushback markdown path correctly from current and parent directory", () => {
      const resolved = resolvePushbackMarkdownPath();
      expect(resolved.endsWith("USER_PUSHBACK_AND_SELF_AUDIT.md")).toBeTrue();
    });
  });

  describe("Aggregated Pushback Ingestion & Candidate Formulation", () => {
    test("ingestPushbacks aggregates records, feedback items, category stats, and proposals", () => {
      const report: PushbackAuditReport = ingestPushbacks(undefined, feedbackQueuePath);

      expect(report.total_feedback_items).toBeGreaterThanOrEqual(1);
      expect(report.feedback_items.length).toBe(report.total_feedback_items);
      expect(report.by_category.code_defect).toBeGreaterThanOrEqual(0);
    });

    test("handles non-existent files gracefully without throwing", () => {
      const report = ingestPushbacks("/non/existent/pushback.md", "/non/existent/feedback.jsonl");
      expect(report.total_pushbacks).toBe(0);
      expect(report.total_feedback_items).toBe(0);
      expect(report.candidate_proposals).toEqual([]);
      expect(report.by_category.code_defect).toBe(0);
      expect(report.by_category.model_reasoning_error).toBe(0);
      expect(report.by_category.boundary_violation).toBe(0);
    });
  });
});

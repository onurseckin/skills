import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getFeedbackStats,
  readFeedbackQueue,
  type FeedbackCategory,
  type FeedbackItem,
} from "../../../orchestrating-long-tasks/scripts/src/mind/feedback-queue.ts";
import {
  ingestPushbacks,
  mapFeedbackCategoryToBlunderCategory,
  parsePushbackMarkdown,
  resolvePushbackMarkdownPath,
  type PushbackAuditReport,
  type PushbackRecord,
} from "../../../orchestrating-long-tasks/scripts/src/mind/pushbacks.ts";

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
      expect(items.length).toBeGreaterThanOrEqual(11);

      const stats = getFeedbackStats(items);
      expect(stats.total).toBe(items.length);
      expect(
        stats.pending + stats.processed + stats.admitted + stats.declined + stats.completed,
      ).toBe(items.length);

      // Check specific known feedback items
      const p00 = items.find((i) => i.id === "p00-perpetual-mind-cadence-and-anti-idle-rollover");
      expect(p00 !== undefined).toBeTrue();
      if (p00 !== undefined) {
        expect(p00.title).toContain("Perpetual Autonomic Mind Cadence");
        expect(p00.content).toContain("mind:pulse-close");
      }

      const p01 = items.find((i) => i.id === "p01-role-confinement-and-whoami");
      expect(p01 !== undefined).toBeTrue();
      if (p01 !== undefined) {
        expect(p01.title).toContain("Mandatory `whoami` Startup Self-Identification");
        expect(p01.content).toContain("whoami");
      }
    });

    test("maps feedback queue categories to canonical blunder categories", () => {
      // Boundary violations
      expect(mapFeedbackCategoryToBlunderCategory("AGENT_CONTRACTS")).toBe("boundary_violation");
      expect(mapFeedbackCategoryToBlunderCategory("WATCHDOG")).toBe("boundary_violation");
      expect(mapFeedbackCategoryToBlunderCategory("EXECUTION_EFFICIENCY")).toBe(
        "boundary_violation",
      );
      expect(mapFeedbackCategoryToBlunderCategory("ROLE_CONFUSION")).toBe("boundary_violation");
      expect(mapFeedbackCategoryToBlunderCategory("boundary_confinement")).toBe(
        "boundary_violation",
      );

      // Model reasoning errors
      expect(mapFeedbackCategoryToBlunderCategory("DOCUMENTATION")).toBe("model_reasoning_error");
      expect(mapFeedbackCategoryToBlunderCategory("GENERAL")).toBe("model_reasoning_error");
      expect(mapFeedbackCategoryToBlunderCategory("ARCHITECTURE")).toBe("model_reasoning_error");
      expect(mapFeedbackCategoryToBlunderCategory("plan_revision")).toBe("model_reasoning_error");

      // Code defects
      expect(mapFeedbackCategoryToBlunderCategory("CLI_TOOLING")).toBe("code_defect");
      expect(mapFeedbackCategoryToBlunderCategory("CORE_ENGINE")).toBe("code_defect");
      expect(mapFeedbackCategoryToBlunderCategory("REPAIR")).toBe("code_defect");
      expect(mapFeedbackCategoryToBlunderCategory("SCALING")).toBe("code_defect");
      expect(mapFeedbackCategoryToBlunderCategory("CORE_SCHEDULER")).toBe("code_defect");
      expect(mapFeedbackCategoryToBlunderCategory("VALIDATION_ENGINE")).toBe("code_defect");
    });
  });

  describe("USER_PUSHBACK_AND_SELF_AUDIT.md Parsing", () => {
    test("parses markdown audit records with pushback items and invariants", () => {
      if (!existsSync(pushbackDocPath)) {
        return;
      }

      const content = readFileSync(pushbackDocPath, "utf8");
      const records = parsePushbackMarkdown(content);

      expect(records.length).toBeGreaterThanOrEqual(5);

      // Verify User Pushback #8 record
      const pushback8 = records.find((r) => r.pushback_number === 8);
      expect(pushback8 !== undefined).toBeTrue();
      if (pushback8 !== undefined) {
        expect(pushback8.title).toContain("Pushback #8");
        expect(pushback8.items.length).toBeGreaterThanOrEqual(3);

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
        expect(gen1.invariants.length).toBeGreaterThanOrEqual(4);
        const anyInv = gen1.invariants.find((inv) => inv.invariant.includes("TypeScript"));
        expect(anyInv !== undefined).toBeTrue();
        if (anyInv !== undefined) {
          expect(anyInv.status).toContain("Verified");
        }
      }

      const gen6 = records.find((r) => r.generation === 6);
      expect(gen6 !== undefined).toBeTrue();
      if (gen6 !== undefined) {
        expect(gen6.invariants.length).toBeGreaterThanOrEqual(5);
        const criticInv = gen6.invariants.find((inv) => inv.invariant.includes("Critic"));
        expect(criticInv !== undefined).toBeTrue();
      }
    });

    test("resolves pushback markdown path correctly from current and parent directory", () => {
      const resolved = resolvePushbackMarkdownPath();
      expect(existsSync(resolved)).toBeTrue();
      expect(resolved.endsWith("USER_PUSHBACK_AND_SELF_AUDIT.md")).toBeTrue();
    });
  });

  describe("Aggregated Pushback Ingestion & Candidate Formulation", () => {
    test("ingestPushbacks aggregates records, feedback items, category stats, and proposals", () => {
      const report: PushbackAuditReport = ingestPushbacks(pushbackDocPath, feedbackQueuePath);

      expect(report.total_pushbacks).toBeGreaterThanOrEqual(5);
      expect(report.total_feedback_items).toBeGreaterThanOrEqual(11);
      expect(report.records.length).toBe(report.total_pushbacks);
      expect(report.feedback_items.length).toBe(report.total_feedback_items);

      // Verify category aggregation
      expect(report.by_category.boundary_violation).toBeGreaterThan(0);
      expect(report.by_category.model_reasoning_error).toBeGreaterThan(0);
      expect(report.by_category.code_defect).toBeGreaterThan(0);

      // Verify candidate proposals
      expect(report.candidate_proposals.length).toBeGreaterThan(0);
      for (const p of report.candidate_proposals) {
        expect(typeof p.id).toBe("string");
        expect(p.id.startsWith("cand-")).toBeTrue();
        expect(["proposal", "defect"]).toContain(p.kind);
        expect(p.statement.length).toBeGreaterThan(0);
        expect(p.rationale.length).toBeGreaterThan(0);
        expect(p.charter_goal_ids.length).toBeGreaterThan(0);
        expect(p.write_scope.length).toBeGreaterThan(0);
        expect(["needs_authority", "admitted"]).toContain(p.status);
        expect(p.disposition).toBe("actionable");
      }
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

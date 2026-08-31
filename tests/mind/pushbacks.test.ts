import { describe, it, expect, beforeEach } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolvePushbackMarkdownPath,
  mapFeedbackCategoryToDefectCategory,
  parsePushbackMarkdown,
  ingestPushbacks,
} from "../../olt/scripts/src/mind/feedback/pushbacks/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("mind/pushbacks", () => {
  let scratchDir: string;

  beforeEach(() => {
    scratchDir = scratchRoot(import.meta.path, "mind-pushbacks-test");
  });

  describe("resolvePushbackMarkdownPath", () => {
    it("returns custom path when provided", () => {
      const custom = join(scratchDir, "custom-pushback.md");
      expect(resolvePushbackMarkdownPath(custom)).toBe(custom);
    });

    it("falls back to default path when custom path is undefined or empty", () => {
      const p1 = resolvePushbackMarkdownPath();
      expect(typeof p1).toBe("string");
      expect(p1.length).toBeGreaterThan(0);

      const p2 = resolvePushbackMarkdownPath("   ");
      expect(typeof p2).toBe("string");
      expect(p2.length).toBeGreaterThan(0);
    });
  });

  describe("mapFeedbackCategoryToDefectCategory", () => {
    it("handles explicit defect category strings", () => {
      expect(mapFeedbackCategoryToDefectCategory("BOUNDARY_VIOLATION")).toBe("boundary_violation");
      expect(mapFeedbackCategoryToDefectCategory("ROLE_CONFUSION")).toBe("boundary_violation");
      expect(mapFeedbackCategoryToDefectCategory("MODEL_REASONING_ERROR")).toBe(
        "model_reasoning_error",
      );
      expect(mapFeedbackCategoryToDefectCategory("CODE_DEFECT")).toBe("code_defect");
    });

    it("handles switch case mappings", () => {
      expect(mapFeedbackCategoryToDefectCategory("AGENT_CONTRACTS")).toBe("boundary_violation");
      expect(mapFeedbackCategoryToDefectCategory("WATCHDOG")).toBe("boundary_violation");
      expect(mapFeedbackCategoryToDefectCategory("EXECUTION_EFFICIENCY")).toBe(
        "boundary_violation",
      );

      expect(mapFeedbackCategoryToDefectCategory("DOCUMENTATION")).toBe("model_reasoning_error");
      expect(mapFeedbackCategoryToDefectCategory("GENERAL")).toBe("model_reasoning_error");
      expect(mapFeedbackCategoryToDefectCategory("ARCHITECTURE")).toBe("model_reasoning_error");

      expect(mapFeedbackCategoryToDefectCategory("CLI_TOOLING")).toBe("code_defect");
      expect(mapFeedbackCategoryToDefectCategory("CORE_ENGINE")).toBe("code_defect");
      expect(mapFeedbackCategoryToDefectCategory("REPAIR")).toBe("code_defect");
      expect(mapFeedbackCategoryToDefectCategory("SCALING")).toBe("code_defect");
      expect(mapFeedbackCategoryToDefectCategory("CORE_SCHEDULER")).toBe("code_defect");
      expect(mapFeedbackCategoryToDefectCategory("VALIDATION_ENGINE")).toBe("code_defect");
    });

    it("handles substring fallback heuristics", () => {
      expect(mapFeedbackCategoryToDefectCategory("agent_boundary_check")).toBe(
        "boundary_violation",
      );
      expect(mapFeedbackCategoryToDefectCategory("role_limit")).toBe("boundary_violation");
      expect(mapFeedbackCategoryToDefectCategory("scope_restraint")).toBe("boundary_violation");
      expect(mapFeedbackCategoryToDefectCategory("subagent_contract")).toBe("boundary_violation");
      expect(mapFeedbackCategoryToDefectCategory("auth_error")).toBe("boundary_violation");
      expect(mapFeedbackCategoryToDefectCategory("confinement_breach")).toBe("boundary_violation");

      expect(mapFeedbackCategoryToDefectCategory("reasoning_failure")).toBe(
        "model_reasoning_error",
      );
      expect(mapFeedbackCategoryToDefectCategory("logic_flaw")).toBe("model_reasoning_error");
      expect(mapFeedbackCategoryToDefectCategory("hallucination_detected")).toBe(
        "model_reasoning_error",
      );
      expect(mapFeedbackCategoryToDefectCategory("doc_mismatch")).toBe("model_reasoning_error");
      expect(mapFeedbackCategoryToDefectCategory("plan_inconsistency")).toBe(
        "model_reasoning_error",
      );
      expect(mapFeedbackCategoryToDefectCategory("analysis_paralysis")).toBe(
        "model_reasoning_error",
      );
      expect(mapFeedbackCategoryToDefectCategory("drift_warning")).toBe("model_reasoning_error");

      expect(mapFeedbackCategoryToDefectCategory("something_random")).toBe("code_defect");
    });

    it("returns code_defect for non-string input", () => {
      const nonString = 123 as unknown as string;
      expect(mapFeedbackCategoryToDefectCategory(nonString)).toBe("code_defect");
    });
  });

  describe("parsePushbackMarkdown", () => {
    it("returns empty array for empty or whitespace content", () => {
      expect(parsePushbackMarkdown("")).toEqual([]);
      expect(parsePushbackMarkdown("   \n\t  ")).toEqual([]);
      expect(parsePushbackMarkdown(null as unknown as string)).toEqual([]);
    });

    it("parses full pushback markdown with items and invariants table", () => {
      const md = `## User Pushback #8: Single Writer & Coordinator Rule
- **Pushback Item 1 (G1: Command De-duplication)**: Duplicate commands dispatched.
  *Issue*: Commands run multiple times concurrently.
  *Resolution*: Enforce idempotency keying.
- **Pushback Item 2 (G2: Lease Boundary)**:
  - Worker exceeded write scope boundary

| Invariant | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| **Single-Writer** | Only 1 coordinator active | PASS | test/lease.test.ts |
| **No-Orphan** | Clean up leases on exit | PASS | logs/audit.jsonl |

## Pulse Generation 1 Convergence
1. **Objective 1** (Goal A): Implement strict token authentication.
   *Issue*: Missing token validation.
   *Resolution*: Add bearer token check.

### Generation 1 Invariants Verification
| Invariant | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| **Token-Check** | Validate all requests | PASS | auth.test.ts |

## User Pushback #9: Generic Section Without Bullets
This section contains raw text describing a boundary violation issue without specific bullet items.
More details about how the system violated boundaries.`;

      const records = parsePushbackMarkdown(md);
      expect(records.length).toBe(3);

      const rec1 = records[0];
      expect(rec1?.pushback_number).toBe(8);
      expect(rec1?.title).toBe("User Pushback #8: Single Writer & Coordinator Rule");
      expect(rec1?.items.length).toBe(2);
      expect(rec1?.invariants.length).toBe(2);
      expect(rec1?.invariants[0]?.invariant).toBe("Single-Writer");

      const rec2 = records[1];
      expect(rec2?.generation).toBe(1);
      expect(rec2?.items.length).toBeGreaterThanOrEqual(1);
      expect(rec2?.invariants.length).toBe(1);

      const rec3 = records[2];
      expect(rec3?.pushback_number).toBe(9);
      expect(rec3?.items.length).toBe(1);
      expect(rec3?.items[0]?.title).toBe("User Pushback #9: Generic Section Without Bullets");
    });
  });

  describe("ingestPushbacks", () => {
    it("ingests from both markdown and feedback queue", () => {
      const mdFile = join(scratchDir, "pushbacks.md");
      const mdContent = `## User Pushback #10: Agent Boundary Enforcement
- **Pushback Item 1 (Boundary)**:
  *Issue*: Agent modified files outside root.
  *Resolution*: Enforce workspace lock.
- **Pushback Item 2 (Reasoning)**:
  *Issue*: Agent assumed wrong plan state.
  *Resolution*: Check current status.
- **Pushback Item 3 (Code)**:
  *Issue*: Compilation failure in parser.
  *Resolution*: Fix syntax error.`;
      writeFileSync(mdFile, mdContent, "utf8");

      const fqFile = join(scratchDir, "FEEDBACK_QUEUE.jsonl");
      const fqContent = [
        JSON.stringify({
          id: "fb-001",
          title: "Role restriction violated",
          content: "Validator attempted implementer actions",
          category: "AGENT_CONTRACTS",
          priority: "USER_DIRECTIVE",
          status: "PENDING",
          timestamp: "2026-08-24T00:00:00Z",
          source: "audit",
        }),
        JSON.stringify({
          id: "fb-002",
          title: "Admitted planning bug",
          content: "Plan generation stalled",
          category: "ARCHITECTURE",
          priority: "USER_DIRECTIVE",
          status: "ADMITTED",
          candidate_id: "cand-existing-002",
          timestamp: "2026-08-24T00:01:00Z",
          source: "audit",
        }),
        JSON.stringify({
          id: "fb-003",
          title: "Resolved bug",
          content: "Already resolved",
          category: "CORE_ENGINE",
          priority: "USER_DIRECTIVE",
          status: "COMPLETED",
          timestamp: "2026-08-24T00:02:00Z",
          source: "audit",
        }),
      ].join("\n");
      writeFileSync(fqFile, fqContent, "utf8");

      const report = ingestPushbacks(mdFile, fqFile);

      expect(report.total_pushbacks).toBe(1);
      expect(report.records[0]?.items.length).toBeGreaterThanOrEqual(3);
      expect(report.total_feedback_items).toBe(3);
      expect(report.candidate_proposals.length).toBeGreaterThanOrEqual(5);
      expect(report.by_category.boundary_violation).toBeGreaterThan(0);
      expect(report.by_category.model_reasoning_error).toBeGreaterThan(0);
      expect(report.by_category.code_defect).toBeGreaterThan(0);
    });

    it("handles non-existent files gracefully", () => {
      const report = ingestPushbacks(
        join(scratchDir, "does-not-exist.md"),
        join(scratchDir, "does-not-exist.jsonl"),
      );
      expect(report.total_pushbacks).toBe(0);
      expect(report.total_feedback_items).toBe(0);
      expect(report.candidate_proposals).toEqual([]);
    });
  });
});

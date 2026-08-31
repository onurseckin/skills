/**
 * @file sync-ledger-and-loop.test.ts
 * Unit tests for Defect Sync Ledger Operations, Boundary Violations, and Continuous Loop
 */

import { describe, expect, it } from "bun:test";
import {
  formulateBoundaryViolationHypothesis,
  mergeDefectsById,
  requireDistinctLedgerPaths,
  resolveCanonicalCompletedDefectsPath,
  resolveCanonicalDefectLogPath,
} from "../../../../olt/scripts/src/mind/defects/loop/ledger-ops.ts";
import {
  normalizeFindingToDefect,
  parseDefectsJsonl,
  serializeDefectsJsonl,
} from "../../../../olt/scripts/src/mind/defects/sync/lifecycle-sync.ts";
import {
  auditDefectLog,
  formatDefectAuditBrief,
} from "../../../../olt/scripts/src/mind/defects/loop/audit.ts";
import { createMockDefectEntry } from "./defect-fixture.ts";

describe("Defect Sync Ledger & Loop Operations", () => {
  describe("Path Resolution & Invariant Guards", () => {
    it("enforces distinct paths for active and completed defect ledgers", () => {
      const activePath = "/workspace/.olt/defects.jsonl";
      const completedPath = "/workspace/.olt/completed-defects.jsonl";

      expect(() => requireDistinctLedgerPaths(activePath, completedPath)).not.toThrow();
      expect(() => requireDistinctLedgerPaths(activePath, activePath)).toThrow();
    });

    it("resolves canonical defect log and completed paths", () => {
      const p1 = resolveCanonicalDefectLogPath("/workspace");
      expect(p1).toContain("defects.jsonl");

      const c1 = resolveCanonicalCompletedDefectsPath("/workspace");
      expect(c1).toContain("completed-defects.jsonl");
    });
  });

  describe("Ledger Merging & Boundary Violation Hypotheses", () => {
    it("merges defect lists by ID taking most recent updates", () => {
      const base = [
        createMockDefectEntry({ id: "d1", status: "open", title: "Original title" }),
        createMockDefectEntry({ id: "d2", status: "open" }),
      ];

      const updates = [
        createMockDefectEntry({ id: "d1", status: "in_progress", title: "Updated title" }),
        createMockDefectEntry({ id: "d3", status: "open" }),
      ];

      const merged = mergeDefectsById(base, updates);
      expect(merged.length).toBe(3);
      const d1 = merged.find((d) => d.id === "d1");
      expect(d1?.status).toBe("in_progress");
      expect(d1?.title).toBe("Updated title");
    });

    it("formulates boundary violation hypothesis when access violates confinement policy", () => {
      const defect = createMockDefectEntry({
        id: "def-bound-1",
        category: "boundary_violation",
        type: "coordinator_code_writing",
        observation: "Coordinator attempted to write code directly to src/index.ts",
      });

      const hypothesis = formulateBoundaryViolationHypothesis(defect);
      expect(hypothesis.id).toBe("hypo-def-bound-1");
      expect(hypothesis.defect_id).toBe("def-bound-1");
      expect(hypothesis.category).toBe("boundary_violation");
      expect(hypothesis.confidence).toBeGreaterThan(0.9);
      expect(hypothesis.root_cause).toContain("Coordinator");
    });
  });

  describe("Doctor Findings Normalization & JSONL Sync", () => {
    it("normalizes raw doctor findings into standard DefectEntry models", () => {
      const rawFinding = {
        rule: "HEALTH_CHECK_FAILED",
        severity: "error" as const,
        message: "Memory leak detected in pool allocator",
        file: "src/allocator.ts",
        line: 45,
      };

      const normalized = normalizeFindingToDefect(rawFinding);
      expect(normalized.id).toBeDefined();
      expect(normalized.category).toBe("code_defect");
      expect(normalized.status).toBe("open");
      expect(normalized.severity).toBe("high");
    });

    it("parses and serializes defect records faithfully", () => {
      const entries = [
        createMockDefectEntry({ id: "sync-1", status: "open" }),
        createMockDefectEntry({ id: "sync-2", status: "resolved" }),
      ];

      const serialized = serializeDefectsJsonl(entries);
      const deserialized = parseDefectsJsonl(serialized);
      expect(deserialized.length).toBe(2);
      expect(deserialized[0]?.id).toBe("sync-1");
      expect(deserialized[1]?.id).toBe("sync-2");
    });
  });

  describe("Audit Loop Execution", () => {
    it("executes complete defect audit over in-memory defect logs", () => {
      const defects = [
        createMockDefectEntry({ id: "a1", severity: "critical", status: "open" }),
        createMockDefectEntry({ id: "a2", severity: "high", status: "resolved" }),
      ];

      const audit = auditDefectLog(defects);
      expect(audit.total_defects).toBe(2);
      expect(audit.open_count).toBe(1);
      expect(audit.resolved_count).toBe(1);

      const brief = formatDefectAuditBrief(audit);
      expect(brief.length).toBeGreaterThan(10);
    });
  });
});

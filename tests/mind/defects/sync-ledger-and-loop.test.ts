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
  resolveCompletedDefectsPath,
  resolveDefectLogPath,
} from "../../../../olt/scripts/src/mind/defects/loop/ledger-ops.ts";
import {
  normalizeFindingToDefect,
  parseDefectsJsonl,
  serializeDefectsJsonl,
} from "../../../../olt/scripts/src/mind/defects/sync/lifecycle-sync.ts";
import {
  executeDefectAudit,
  formatDefectAuditBrief,
  logBoundaryViolationDefect,
} from "../../../../olt/scripts/src/mind/defects/loop/audit.ts";
import { createMockDefectEntry } from "./defect-fixture.ts";

describe("Defect Sync Ledger & Loop Operations", () => {
  describe("Path Resolution & Invariant Guards", () => {
    it("enforces distinct paths for active and completed defect ledgers", () => {
      const activePath = "/workspace/.olt/defects.jsonl";
      const completedPath = "/workspace/.olt/defects-completed.jsonl";

      expect(() => requireDistinctLedgerPaths(activePath, completedPath)).not.toThrow();
      expect(() => requireDistinctLedgerPaths(activePath, activePath)).toThrow();
    });

    it("resolves canonical defect log and completed paths", () => {
      const p1 = resolveDefectLogPath("/workspace");
      const p2 = resolveCanonicalDefectLogPath("/workspace");
      expect(p1).toBe(p2);

      const c1 = resolveCompletedDefectsPath("/workspace");
      const c2 = resolveCanonicalCompletedDefectsPath("/workspace");
      expect(c1).toBe(c2);
    });
  });

  describe("Ledger Merging & Boundary Violation Hypotheses", () => {
    it("merges defect lists by ID taking most recent status and updates", () => {
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
      const hypothesis = formulateBoundaryViolationHypothesis({
        sourceAgent: "agent-builder-1",
        targetPath: "/etc/passwd",
        operation: "WRITE",
        rule: "RULE_NO_HOST_ACCESS",
      });

      expect(hypothesis.isViolation).toBe(true);
      expect(hypothesis.severity).toBe("P0");
      expect(hypothesis.category).toBe("boundary_violation");
    });

    it("logs boundary violation defects into memory structures cleanly", () => {
      const defect = logBoundaryViolationDefect({
        agentId: "agent-test-2",
        violationType: "UNAUTHORIZED_PROCESS_SPAWN",
        details: "Attempted to spawn root bash shell",
      });

      expect(defect.category).toBe("boundary_violation");
      expect(defect.severity).toBe("P0");
      expect(defect.status).toBe("open");
    });
  });

  describe("Doctor Findings Normalization & JSONL Sync", () => {
    it("normalizes raw doctor findings into standard DefectEntry models", () => {
      const rawFinding = {
        ruleId: "HEALTH_CHECK_FAILED",
        severity: "error",
        message: "Memory leak detected in pool allocator",
        location: "src/allocator.ts:45",
      };

      const normalized = normalizeFindingToDefect(rawFinding);
      expect(normalized.id).toBeDefined();
      expect(normalized.category).toBe("code_defect");
      expect(normalized.status).toBe("open");
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
        createMockDefectEntry({ id: "a1", severity: "P0", status: "open" }),
        createMockDefectEntry({ id: "a2", severity: "P1", status: "resolved" }),
      ];

      const audit = executeDefectAudit(defects);
      expect(audit.totalCount).toBe(2);
      expect(audit.openCount).toBe(1);
      expect(audit.resolvedCount).toBe(1);

      const brief = formatDefectAuditBrief(audit);
      expect(brief.length).toBeGreaterThan(10);
    });
  });
});

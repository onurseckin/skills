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
} from "../../../olt/scripts/src/mind/defects/loop/ledger-ops.ts";
import {
  parseDefectsJsonl,
  serializeDefectsJsonl,
} from "../../../olt/scripts/src/mind/defects/sync/lifecycle-sync.ts";
import {
  auditDefectLog,
  formatDefectAuditBrief,
  logBoundaryViolationDefect,
} from "../../../olt/scripts/src/mind/defects/loop/audit.ts";
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
        createMockDefectEntry({ id: "d1", status: "open", observation: "Original observation" }),
        createMockDefectEntry({ id: "d2", status: "open" }),
      ];

      const updates = [
        createMockDefectEntry({ id: "d1", status: "in_progress", observation: "Updated observation" }),
        createMockDefectEntry({ id: "d3", status: "open" }),
      ];

      const merged = mergeDefectsById(base, updates);
      expect(merged.length).toBe(3);
      const d1 = merged.find((d) => d.id === "d1");
      expect(d1?.status).toBe("in_progress");
      expect(d1?.observation).toBe("Updated observation");
    });

    it("formulates boundary violation hypothesis when access violates confinement policy", () => {
      const defect = createMockDefectEntry({
        id: "d-boundary-1",
        category: "boundary_violation",
        type: "role_escalation",
        observation: "Main thread attempted direct file write without delegation",
      });

      const hypothesis = formulateBoundaryViolationHypothesis(defect);
      expect(hypothesis.id).toBe("hypo-d-boundary-1");
      expect(hypothesis.category).toBe("boundary_violation");
      expect(hypothesis.confidence).toBeGreaterThan(0.9);
    });

    it("logs boundary violation defects into memory structures cleanly", () => {
      const defect = logBoundaryViolationDefect({
        violation_type: "unauthorized_mutation",
        observation: "Attempted direct write to master branch",
        role: "worker",
        agent_id: "agent-1",
      });

      expect(defect.category).toBe("boundary_violation");
      expect(defect.status).toBe("open");
      expect(defect.observation).toBe("Attempted direct write to master branch");
    });
  });

  describe("JSONL Sync Operations", () => {
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

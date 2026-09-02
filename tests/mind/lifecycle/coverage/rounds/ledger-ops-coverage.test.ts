import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import type { DefectEntry } from "../../../../../olt/scripts/src/mind/defects/core/types.ts";
import {
  CANONICAL_COMPLETED_DEFECTS_FILE,
  CANONICAL_DEFECTS_FILE,
  DEFAULT_COMPLETED_DEFECTS_FILE,
  DEFAULT_DEFECTS_FILE,
  appendCompletedDefectLogEntry,
  appendDefectLogEntry,
  atomicWriteDefectLog,
  formulateBoundaryViolationHypothesis,
  mergeDefectsById,
  readCompletedDefectsLog,
  readExistingDefectLog,
  requireDistinctLedgerPaths,
  resolveCanonicalCompletedDefectsPath,
  resolveCanonicalDefectLogPath,
  resolveCompletedDefectsPath,
  resolveDefectLogPath,
  writeCompletedDefectsLog,
} from "../../../../../olt/scripts/src/mind/defects/loop/ledger-ops.ts";

describe("Defect Loop Ledger Operations Suite (ledger-ops.ts)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ledger-ops-cov-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Constants, Distinctness & Path Resolution", () => {
    it("exposes canonical ledger file constants and enforces distinct paths", () => {
      expect(DEFAULT_DEFECTS_FILE).toBe(".olt/defects.jsonl");
      expect(CANONICAL_DEFECTS_FILE).toBe(".olt/defects.jsonl");
      expect(DEFAULT_COMPLETED_DEFECTS_FILE).toBe(".olt/completed-defects.jsonl");
      expect(CANONICAL_COMPLETED_DEFECTS_FILE).toBe(".olt/completed-defects.jsonl");

      const p1 = join(tempDir, "active.jsonl");
      const p2 = join(tempDir, "completed.jsonl");
      expect(() => requireDistinctLedgerPaths(p1, p2)).not.toThrow();
      expect(() => requireDistinctLedgerPaths(p1, p1)).toThrow(HarnessError);
    });

    it("resolves canonical and custom defect paths", () => {
      expect(resolveCanonicalDefectLogPath(tempDir)).toBe(join(tempDir, ".olt", "defects.jsonl"));
      expect(resolveDefectLogPath(join(tempDir, "custom.jsonl"))).toBe(
        join(tempDir, "custom.jsonl"),
      );
      expect(resolveCanonicalCompletedDefectsPath(tempDir)).toBe(
        join(tempDir, ".olt", "completed-defects.jsonl"),
      );
      expect(resolveCanonicalCompletedDefectsPath("")).toContain(".olt/completed-defects.jsonl");
      expect(resolveCompletedDefectsPath("  /custom/completed.jsonl  ")).toBe(
        resolve("/custom/completed.jsonl"),
      );
      expect(resolveCompletedDefectsPath()).toBeDefined();
    });
  });

  describe("Read, Write & Atomic Defect Log Operations", () => {
    it("reads empty list when log file is missing and throws on unreadable path", () => {
      expect(readExistingDefectLog(join(tempDir, "missing.jsonl"))).toEqual([]);
      expect(() => readExistingDefectLog(tempDir)).toThrow(HarnessError);
    });

    it("performs atomic write and completed log reads", () => {
      const p = join(tempDir, "completed.jsonl");
      const defect: DefectEntry = {
        id: "d-1",
        type: "boundary_violation",
        status: "resolved",
        source: "test",
        created_at: "2026-09-01T00:00:00Z",
      };
      atomicWriteDefectLog([defect], p);
      expect(readExistingDefectLog(p).length).toBe(1);

      writeCompletedDefectsLog([defect], p);
      const readBack = readCompletedDefectsLog(p);
      expect(readBack.length).toBe(1);
      expect(readBack[0]?.id).toBe("d-1");
    });
  });

  describe("Append & Merge Operations", () => {
    it("appends and deduplicates active defect entries by id and dedup_key", () => {
      const p = join(tempDir, "active.jsonl");
      const d1: DefectEntry = {
        id: "d-1",
        dedup_key: "k-1",
        type: "violation",
        status: "open",
        source: "test",
        created_at: "2026-09-01T00:00:00Z",
      };
      appendDefectLogEntry(d1, { customPath: p });
      expect(readExistingDefectLog(p).length).toBe(1);

      appendDefectLogEntry({ ...d1, status: "in_progress" }, { customPath: p });
      let list = readExistingDefectLog(p);
      expect(list.length).toBe(1);
      expect(list[0]?.status).toBe("in_progress");

      appendDefectLogEntry({ ...d1, id: "d-2" }, { customPath: p });
      list = readExistingDefectLog(p);
      expect(list.length).toBe(1);
      expect(list[0]?.id).toBe("d-2");

      expect(appendDefectLogEntry(d1, { capsuleRoot: tempDir })).toBe(
        join(tempDir, ".olt", "defects.jsonl"),
      );
    });

    it("appends completed defect entries without duplicating existing entries", () => {
      const p = join(tempDir, "completed.jsonl");
      const d1: DefectEntry = {
        id: "d-1",
        dedup_key: "k-comp",
        type: "violation",
        status: "resolved",
        source: "test",
        created_at: "2026-09-01T00:00:00Z",
      };

      appendCompletedDefectLogEntry(d1, p);
      expect(readExistingDefectLog(p).length).toBe(1);

      appendCompletedDefectLogEntry(d1, p);
      expect(readExistingDefectLog(p).length).toBe(1);

      appendCompletedDefectLogEntry({ ...d1, id: "d-other" }, p);
      expect(readExistingDefectLog(p).length).toBe(1);

      appendCompletedDefectLogEntry({ ...d1, id: "d-new", dedup_key: "k-other" }, p);
      expect(readExistingDefectLog(p).length).toBe(2);
    });

    it("merges defects by id prioritizing incoming entries", () => {
      const d1: DefectEntry = {
        id: "d-1",
        type: "v1",
        status: "open",
        source: "test",
        created_at: "2026-09-01T00:00:00Z",
      };
      const d2: DefectEntry = {
        id: "d-2",
        type: "v2",
        status: "open",
        source: "test",
        created_at: "2026-09-01T00:00:00Z",
      };
      const merged = mergeDefectsById([d1], [{ ...d1, status: "resolved" }, d2]);
      expect(merged.length).toBe(2);
      expect(merged.find((d) => d.id === "d-1")?.status).toBe("resolved");
    });
  });

  describe("formulateBoundaryViolationHypothesis", () => {
    it("formulates hypothesis for coordinator code writing and orchestrator tasks", () => {
      const hypoCoord = formulateBoundaryViolationHypothesis({
        id: "d-coord",
        type: "coordinator_code_writing",
        status: "open",
        source: "auditor",
        observation: "coordinator wrote code",
        remediation: "delegate to coder",
        role: "coordinator",
        agent_id: "agent-coord-1",
        created_at: "2026-09-01T00:00:00Z",
      });
      expect(hypoCoord.root_cause).toContain("Tier 2 Coordinator");
      expect(hypoCoord.confidence).toBe(0.99);
      expect(hypoCoord.evidence.length).toBe(4);

      const hypoOrch = formulateBoundaryViolationHypothesis({
        id: "d-orch",
        type: "orchestrator_direct_implementation",
        status: "open",
        source: "auditor",
        observation: "orchestrator attempted direct task",
        created_at: "2026-09-01T00:00:00Z",
      });
      expect(hypoOrch.root_cause).toContain("Tier 1 Orchestrator");
      expect(hypoOrch.confidence).toBe(0.99);
    });

    it("formulates hypothesis for unassigned test running, cross-tier, and generic breaches", () => {
      const hypoTest = formulateBoundaryViolationHypothesis({
        id: "d-test",
        type: "unassigned_test_running",
        status: "open",
        source: "auditor",
        created_at: "2026-09-01T00:00:00Z",
      });
      expect(hypoTest.root_cause).toContain("Agent breached test running");

      const hypoCross = formulateBoundaryViolationHypothesis({
        id: "d-cross",
        type: "cross_tier_spawning",
        status: "open",
        source: "auditor",
        created_at: "2026-09-01T00:00:00Z",
      });
      expect(hypoCross.root_cause).toContain("Supervisory agent bypassed 4-tier");

      const hypoGeneric = formulateBoundaryViolationHypothesis({
        id: "d-generic",
        type: "other_breach",
        status: "open",
        source: "auditor",
        created_at: "2026-09-01T00:00:00Z",
      });
      expect(hypoGeneric.root_cause).toContain("Agent role confinement failure");
    });
  });
});

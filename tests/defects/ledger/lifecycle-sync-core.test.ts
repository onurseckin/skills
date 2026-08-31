import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  cleanupVestigialDefectsFile,
  parseDefectsJsonl,
  serializeDefectsJsonl,
  syncDoctorFindingsToDefects,
  type DoctorFindingInput,
} from "../../../olt/scripts/src/mind/defects/sync/index.ts";
import type {
  DefectEntry,
  EmpiricalFailureProof,
} from "../../../olt/scripts/src/mind/contracts/defect-contracts.ts";

export const lifecycleSyncCoreSuiteName = "Defect Lifecycle Sync & Key Generation Core Engine";

describe(lifecycleSyncCoreSuiteName, () => {
  let tempDir: string;
  let defectsPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "defect-lifecycle-sync-core-"));
    defectsPath = join(tempDir, ".olt", "defects.jsonl");
    mkdirSync(dirname(defectsPath), { recursive: true });
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe("Deterministic Key Generation & In-Place Deduplication", () => {
    it("generates deterministic SHA-256 defect IDs with zero Date.now() fallbacks", () => {
      const finding: DoctorFindingInput = {
        code: "UNGUARDED_MUTATION",
        message: "File written without mutation lock",
        file: "olt/scripts/src/mind/defects/sync/test.ts",
        line: 42,
        severity: "error",
      };

      const result1 = syncDoctorFindingsToDefects([finding], {
        customPath: defectsPath,
        timestamp: "2026-08-29T10:00:00.000Z",
      });

      const result2 = syncDoctorFindingsToDefects([finding], {
        customPath: defectsPath,
        timestamp: "2026-08-29T10:05:00.000Z",
      });

      expect(result1.newlyCreated).toBe(1);
      expect(result1.defects.length).toBe(1);
      const defectId1 = result1.defects[0]?.id;
      expect(defectId1).toBeDefined();
      expect(defectId1?.startsWith("doctor-unguarded-mutation-")).toBeTrue();

      expect(result2.newlyCreated).toBe(0);
      expect(result2.existingUpdated).toBe(1);
      expect(result2.defects.length).toBe(1);
      expect(result2.defects[0]?.id).toBe(defectId1);
      expect(result2.defects[0]?.count).toBe(2);
      expect(result2.defects[0]?.last_seen_at).toBe("2026-08-29T10:05:00.000Z");
    });

    it("skips repaired doctor findings without creating defect rows", () => {
      const findings: readonly DoctorFindingInput[] = [
        { code: "TORN_EVENT_TAIL", message: "Repaired torn tail", repaired: true },
        { code: "STALE_PROJECTION", message: "Projection recomputed", repaired: true },
        { code: "UNRESOLVED_IMPORT", message: "Cannot find module", repaired: false },
      ];

      const result = syncDoctorFindingsToDefects(findings, {
        customPath: defectsPath,
        timestamp: "2026-08-29T10:00:00.000Z",
      });

      expect(result.totalFindings).toBe(3);
      expect(result.newlyCreated).toBe(1);
      expect(result.unchanged).toBe(2);
      expect(result.defects.length).toBe(1);
      expect(result.defects[0]?.type).toBe("UNRESOLVED_IMPORT");
    });
  });

  describe("Autonomous Recurrence & Regression Re-opening with Empirical Proofs", () => {
    it("automatically re-opens previously completed defects with empirical failure proof", () => {
      const initialFinding: DoctorFindingInput = {
        code: "REGEX_FALSE_POSITIVE",
        message: "AST regex matched comment text incorrectly",
        severity: "error",
      };

      const initialResult = syncDoctorFindingsToDefects([initialFinding], {
        customPath: defectsPath,
        timestamp: "2026-08-29T08:00:00.000Z",
      });
      const defectId = initialResult.defects[0]?.id;
      expect(defectId).toBeDefined();

      const existingEntries = parseDefectsJsonl(readFileSync(defectsPath, "utf-8"));
      const completedEntries: DefectEntry[] = existingEntries.map((d) =>
        d.id === defectId
          ? {
              ...d,
              status: "completed",
              resolution_proof: { task_id: "task-100", resolved_at: "2026-08-29T08:30:00.000Z" },
            }
          : d,
      );
      writeFileSync(defectsPath, serializeDefectsJsonl(completedEntries), "utf-8");

      const failureProof: EmpiricalFailureProof = {
        commit_sha: "abc1234def5678",
        test_assertion: "bun test tests/doctor/rules/ast-purity-engine.test.ts",
        task_id: "doctor-run-99",
        timestamp: "2026-08-29T09:00:00.000Z",
      };

      const syncResult = syncDoctorFindingsToDefects([initialFinding], {
        customPath: defectsPath,
        timestamp: "2026-08-29T09:00:00.000Z",
        failureProof,
        autoReopen: true,
      });

      expect(syncResult.reopened).toBe(1);
      const reopenedDefect = syncResult.defects.find((d) => d.id === defectId);
      expect(reopenedDefect).toBeDefined();
      expect(reopenedDefect?.status).toBe("open");
      expect(reopenedDefect?.count).toBe(2);
      expect(reopenedDefect?.reopened_at).toBe("2026-08-29T09:00:00.000Z");
      expect(reopenedDefect?.failure_proof?.commit_sha).toBe("abc1234def5678");
      expect(reopenedDefect?.failure_proof?.test_assertion).toContain("ast-purity-engine");
    });

    it("throws HarnessError on defect re-opening when strict proof is enabled and proof is missing", () => {
      const defect: DefectEntry = {
        id: "doctor-completed-defect",
        type: "INVARIANT_BREACH",
        category: "boundary_violation",
        severity: "critical",
        status: "completed",
        timestamp: "2026-08-29T01:00:00.000Z",
      };
      writeFileSync(defectsPath, serializeDefectsJsonl([defect]), "utf-8");

      const finding: DoctorFindingInput = {
        id: "doctor-completed-defect",
        code: "INVARIANT_BREACH",
        message: "Invariant re-occurred",
      };

      expect(() => {
        syncDoctorFindingsToDefects([finding], {
          customPath: defectsPath,
          requireStrictProof: true,
        });
      }).toThrow(HarnessError);
    });
  });

  describe("Vestigial Loose Defect Cleanup", () => {
    it("migrates and removes loose olt/defects.jsonl", () => {
      const vestigialPath = join(tempDir, "olt", "defects.jsonl");
      mkdirSync(dirname(vestigialPath), { recursive: true });
      const sampleDefect: DefectEntry = {
        id: "legacy-defect-1",
        type: "LEGACY_BUG",
        status: "open",
        timestamp: "2026-08-29T00:00:00.000Z",
      };
      writeFileSync(vestigialPath, serializeDefectsJsonl([sampleDefect]), "utf-8");

      cleanupVestigialDefectsFile(defectsPath);

      expect(existsSync(vestigialPath)).toBeFalse();
      const canonicalEntries = parseDefectsJsonl(readFileSync(defectsPath, "utf-8"));
      expect(canonicalEntries.some((d) => d.id === "legacy-defect-1")).toBeTrue();
    });
  });
});

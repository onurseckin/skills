import { beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
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
import { scratchRoot, setupVirtualDefectsFS } from "../defects-fixture.ts";

export const lifecycleSyncCoreSuiteName = "Defect Lifecycle Sync & Key Generation Core Engine";

describe(lifecycleSyncCoreSuiteName, () => {
  beforeEach(() => {
    setupVirtualDefectsFS();
  });

  function createTestPaths() {
    const tempDir = scratchRoot(import.meta.path, "lifecycle-core");
    const defectsPath = join(tempDir, ".olt", "defects.jsonl");
    fs.mkdirSync(dirname(defectsPath), { recursive: true });
    return { tempDir, defectsPath };
  }

  describe("Deterministic Key Generation & In-Place Deduplication", () => {
    it("generates deterministic SHA-256 defect IDs with zero Date.now() fallbacks", () => {
      const { defectsPath } = createTestPaths();
      const finding: DoctorFindingInput = {
        code: "UNGUARDED_MUTATION",
        message: "File written without mutation lock",
        file: "olt/scripts/src/mind/defects/sync/test.ts",
        line: 42,
        severity: "error",
      };
      const res1 = syncDoctorFindingsToDefects([finding], {
        customPath: defectsPath,
        timestamp: "2026-08-29T10:00:00.000Z",
      });
      const res2 = syncDoctorFindingsToDefects([finding], {
        customPath: defectsPath,
        timestamp: "2026-08-29T10:05:00.000Z",
      });

      expect(res1.newlyCreated).toBe(1);
      expect(res1.defects[0]?.id?.startsWith("doctor-unguarded-mutation-")).toBeTrue();
      expect(res2.newlyCreated).toBe(0);
      expect(res2.existingUpdated).toBe(1);
      expect(res2.defects[0]?.id).toBe(res1.defects[0]?.id);
      expect(res2.defects[0]?.count).toBe(2);
      expect(res2.defects[0]?.last_seen_at).toBe("2026-08-29T10:05:00.000Z");
    });

    it("skips repaired doctor findings without creating defect rows", () => {
      const { defectsPath } = createTestPaths();
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
      expect(result.defects[0]?.type).toBe("UNRESOLVED_IMPORT");
    });
  });

  describe("Autonomous Recurrence & Regression Re-opening with Empirical Proofs", () => {
    it("automatically re-opens previously completed defects with empirical failure proof", () => {
      const { defectsPath } = createTestPaths();
      const finding: DoctorFindingInput = {
        code: "REGEX_FALSE_POSITIVE",
        message: "AST regex matched comment text incorrectly",
        severity: "error",
      };
      const initResult = syncDoctorFindingsToDefects([finding], {
        customPath: defectsPath,
        timestamp: "2026-08-29T08:00:00.000Z",
      });
      const defectId = initResult.defects[0]?.id;

      const existing = parseDefectsJsonl(fs.readFileSync(defectsPath, "utf-8"));
      const completed = existing.map((d) =>
        d.id === defectId
          ? {
              ...d,
              status: "completed" as const,
              resolution_proof: { task_id: "task-100", resolved_at: "2026-08-29T08:30:00.000Z" },
            }
          : d,
      );
      fs.writeFileSync(defectsPath, serializeDefectsJsonl(completed), "utf-8");

      const failureProof: EmpiricalFailureProof = {
        commit_sha: "abc1234def5678",
        test_assertion: "bun test tests/doctor/rules/ast-purity-engine.test.ts",
        task_id: "doctor-run-99",
        timestamp: "2026-08-29T09:00:00.000Z",
      };
      const syncResult = syncDoctorFindingsToDefects([finding], {
        customPath: defectsPath,
        timestamp: "2026-08-29T09:00:00.000Z",
        failureProof,
        autoReopen: true,
      });

      const reopened = syncResult.defects.find((d) => d.id === defectId);
      expect(syncResult.reopened).toBe(1);
      expect(reopened?.status).toBe("open");
      expect(reopened?.count).toBe(2);
      expect(reopened?.reopened_at).toBe("2026-08-29T09:00:00.000Z");
      expect(reopened?.failure_proof?.commit_sha).toBe("abc1234def5678");
      expect(reopened?.failure_proof?.test_assertion).toContain("ast-purity-engine");
    });

    it("throws HarnessError on defect re-opening when strict proof is enabled and proof is missing", () => {
      const { defectsPath } = createTestPaths();
      const defect: DefectEntry = {
        id: "doctor-completed-defect",
        type: "INVARIANT_BREACH",
        category: "boundary_violation",
        severity: "critical",
        status: "completed",
        timestamp: "2026-08-29T01:00:00.000Z",
      };
      fs.writeFileSync(defectsPath, serializeDefectsJsonl([defect]), "utf-8");
      const finding: DoctorFindingInput = {
        id: "doctor-completed-defect",
        code: "INVARIANT_BREACH",
        message: "Invariant re-occurred",
      };
      expect(() =>
        syncDoctorFindingsToDefects([finding], {
          customPath: defectsPath,
          requireStrictProof: true,
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("Vestigial Loose Defect Cleanup", () => {
    it("migrates and removes loose olt/defects.jsonl", () => {
      const { tempDir, defectsPath } = createTestPaths();
      const vestigialPath = join(tempDir, "olt", "defects.jsonl");
      fs.mkdirSync(dirname(vestigialPath), { recursive: true });
      const sampleDefect: DefectEntry = {
        id: "legacy-defect-1",
        type: "LEGACY_BUG",
        status: "open",
        timestamp: "2026-08-29T00:00:00.000Z",
      };
      fs.writeFileSync(vestigialPath, serializeDefectsJsonl([sampleDefect]), "utf-8");

      cleanupVestigialDefectsFile(defectsPath);
      expect(fs.existsSync(vestigialPath)).toBeFalse();
      const canonicalEntries = parseDefectsJsonl(fs.readFileSync(defectsPath, "utf-8"));
      expect(canonicalEntries.some((d) => d.id === "legacy-defect-1")).toBeTrue();
    });
  });
});

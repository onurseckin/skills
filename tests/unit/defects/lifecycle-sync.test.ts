import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  cleanupVestigialDefectsFile,
  enforceSequentialLifecycleOrdering,
  LIFECYCLE_PHASES,
  parseDefectsJsonl,
  resolveDefectsJsonlPath,
  serializeDefectsJsonl,
  syncDoctorFindingsToDefects,
  validatePhaseTransition,
  transitionDefectState,
  validateDefectStateTransition,
  VALID_DEFECT_STATE_TRANSITIONS,
  type DoctorFindingInput,
} from "../../../olt/scripts/src/mind/defects/sync/index.ts";

import type {
  DefectEntry,
  EmpiricalFailureProof,
} from "../../../olt/scripts/src/mind/contracts/defect-contracts.ts";

describe("Defect Lifecycle Sync & Order Enforcement Engine", () => {
  let tempDir: string;
  let defectsPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "defect-lifecycle-sync-"));
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
        test_assertion: "bun test tests/unit/doctor/ast-purity-engine.test.ts",
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

  describe("Sequential Lifecycle Command Ordering Enforcement", () => {
    it("accepts strictly ordered lifecycle phases", () => {
      const validSeq = [
        "plan:init",
        "plan:enhance",
        "plan:add",
        "plan:compile",
        "run:start",
        "task:claim",
        "task:review",
        "run:submit",
        "quiesce",
      ];
      const result = enforceSequentialLifecycleOrdering(validSeq);
      expect(result.valid).toBeTrue();
      expect(result.highestPhaseReached).toBe("quiesce");
      expect(result.violations.length).toBe(0);
    });

    it("throws HarnessError on out-of-order lifecycle command execution", () => {
      const invalidSeq = ["plan:init", "plan:compile", "plan:enhance"];
      expect(() => enforceSequentialLifecycleOrdering(invalidSeq)).toThrow(HarnessError);
    });

    it("validates phase transitions accurately", () => {
      expect(validatePhaseTransition("plan:init", "plan:enhance")).toBeTrue();
      expect(validatePhaseTransition("plan:enhance", "plan:add")).toBeTrue();
      expect(validatePhaseTransition("plan:compile", "plan:init")).toBeFalse();
      expect(validatePhaseTransition("run:submit", "task:claim")).toBeFalse();
    });

    it("exports all 9 canonical lifecycle phases", () => {
      expect(LIFECYCLE_PHASES.length).toBe(9);
      expect(LIFECYCLE_PHASES).toContain("plan:init");
      expect(LIFECYCLE_PHASES).toContain("quiesce");
    });
  });

  describe("Sequential Defect State Transitions & State Machine Enforcement", () => {
    it("allows valid forward defect lifecycle transitions", () => {
      const openDefect: DefectEntry = {
        id: "defect-sm-1",
        status: "open",
        timestamp: "2026-08-29T00:00:00.000Z",
      };

      const inProgress = transitionDefectState(openDefect, "in_progress");
      expect(inProgress.status).toBe("in_progress");

      const resolved = transitionDefectState(inProgress, "resolved");
      expect(resolved.status).toBe("resolved");

      const completed = transitionDefectState(resolved, "completed");
      expect(completed.status).toBe("completed");
    });

    it("rejects invalid defect state transitions", () => {
      const completedDefect: DefectEntry = {
        id: "defect-sm-2",
        status: "completed",
        timestamp: "2026-08-29T00:00:00.000Z",
      };

      // Completed cannot jump directly to in_progress without reopening to open
      expect(() => transitionDefectState(completedDefect, "in_progress")).toThrow(HarnessError);
    });

    it("requires empirical failure proof when reopening completed defects", () => {
      const completedDefect: DefectEntry = {
        id: "defect-sm-3",
        status: "completed",
        timestamp: "2026-08-29T00:00:00.000Z",
      };

      expect(() => transitionDefectState(completedDefect, "open")).toThrow(HarnessError);

      const validProof: EmpiricalFailureProof = {
        commit_sha: "abc1234567",
        test_assertion: "bun test tests/unit/defects/lifecycle-sync.test.ts",
        task_id: "task-sm-proof",
        timestamp: "2026-08-29T01:00:00.000Z",
      };

      const reopened = transitionDefectState(completedDefect, "open", validProof);
      expect(reopened.status).toBe("open");
      expect(reopened.failure_proof?.commit_sha).toBe("abc1234567");
      expect(reopened.count).toBe(2);
    });
  });

  describe("Static Invariants & Purity", () => {
    it("enforces zero any and zero compiler suppressions across sync files", () => {
      const syncFiles = [
        join(process.cwd(), "olt/scripts/src/mind/defects/sync/lifecycle-sync.ts"),
        join(process.cwd(), "olt/scripts/src/mind/defects/sync/order-enforcement.ts"),
        join(process.cwd(), "olt/scripts/src/mind/defects/sync/index.ts"),
      ];

      const anyRegex = new RegExp(":\\s*" + "any\\b|as\\s+" + "any\\b|<" + "any>");
      const suppressionRegex = new RegExp(
        "@ts-(?:" +
          "ignore|" +
          "expect-error|" +
          "nocheck)|eslint-" +
          "disable|oxlint-" +
          "disable",
      );

      for (const file of syncFiles) {
        if (!existsSync(file)) continue;
        const content = readFileSync(file, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          expect(anyRegex.test(line)).toBeFalse();
          expect(suppressionRegex.test(line)).toBeFalse();
        }
      }
    });
  });
});

import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  enforceSequentialLifecycleOrdering,
  LIFECYCLE_PHASES,
  transitionDefectState,
  validatePhaseTransition,
} from "../../../olt/scripts/src/mind/defects/sync/index.ts";
import type {
  DefectEntry,
  EmpiricalFailureProof,
} from "../../../olt/scripts/src/mind/contracts/defect-contracts.ts";

export const lifecycleSyncEdgeSuiteName =
  "Defect Lifecycle Command Ordering & State Machine Invariants";

describe(lifecycleSyncEdgeSuiteName, () => {
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
        test_assertion: "bun test tests/defects/ledger/lifecycle-sync-core.test.ts",
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
      const sampleSyncSource = `
export interface SyncOptions {
  readonly timestamp: string;
  readonly strict: boolean;
}
export function syncDefects(opts: SyncOptions): readonly string[] {
  return [opts.timestamp];
}
`;
      const anyRegex = new RegExp(":\\s*" + "any\\b|as\\s+" + "any\\b|<" + "any>");
      const suppressionRegex = new RegExp(
        "@ts-(?:" +
          "ignore|" +
          "expect-error|" +
          "nocheck)|eslint-" +
          "disable|oxlint-" +
          "disable",
      );

      const lines = sampleSyncSource.trim().split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        expect(anyRegex.test(line)).toBeFalse();
        expect(suppressionRegex.test(line)).toBeFalse();
      }
      expect(anyRegex.test("const x: " + "any = 1;")).toBeTrue();
      expect(suppressionRegex.test("// @ts-" + "ignore")).toBeTrue();
    });
  });
});

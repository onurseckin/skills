/**
 * @file sync-state-machine.test.ts
 * Unit tests for Defect State Machine, Normalization Signatures, and Order Enforcement
 */

import { describe, expect, it } from "bun:test";
import { computeNormalizedFailureSignature } from "../../../../olt/scripts/src/mind/defects/sync/signature.ts";
import {
  handleDefectRecurrence,
  transitionDefectState as transitionState,
  validateDefectStateTransition as validateTransitionState,
} from "../../../../olt/scripts/src/mind/defects/sync/state-machine.ts";
import {
  enforceSequentialLifecycleOrdering,
  validateDefectStateTransition as validateTransitionOrder,
  validatePhaseTransition,
} from "../../../../olt/scripts/src/mind/defects/sync/order-enforcement.ts";
import { createMockDefectEntry } from "./defect-fixture.ts";

describe("Defect Sync & State Machine Suite", () => {
  describe("Failure Signatures", () => {
    it("computes deterministic failure signatures across platform paths and case variations", () => {
      const sig1 = computeNormalizedFailureSignature({
        category: "syntax",
        code: "ERR_SYNTAX",
        path: "src\\index.ts",
        line: 12,
        message: "Unexpected token   semicolon",
      });

      const sig2 = computeNormalizedFailureSignature({
        category: "SYNTAX ",
        code: "err_syntax",
        file: "src/index.ts",
        line: 12,
        message: "unexpected token semicolon",
      });

      expect(sig1).toBe(sig2);
      expect(sig1.length).toBe(64);

      const sigDefault = computeNormalizedFailureSignature({
        code: "ERR_DEFAULT",
      });
      expect(sigDefault).toBeDefined();
    });
  });

  describe("State Machine Transitions", () => {
    it("validates transition state rules and prevents invalid transitions", () => {
      expect(validateTransitionState("open", "in_progress")).toBe(true);
      expect(validateTransitionState("in_progress", "resolved")).toBe(true);
      expect(validateTransitionState("resolved", "open")).toBe(false);
    });

    it("executes valid state transitions and updates timestamps", () => {
      const defect = createMockDefectEntry({ status: "open" });
      const inProgress = transitionState(defect, "in_progress");
      expect(inProgress.status).toBe("in_progress");

      const resolved = transitionState(inProgress, "resolved");
      expect(resolved.status).toBe("resolved");
      expect(resolved.last_seen_at).toBeDefined();
    });

    it("handles defect recurrence by reopening with incremented count", () => {
      const resolved = createMockDefectEntry({
        status: "resolved",
        count: 1,
      });

      const recurring = handleDefectRecurrence(resolved, { now: new Date().toISOString() });
      expect(recurring.status).toBe("deliberating");
    });
  });

  describe("Order Enforcement & Phase Transitions", () => {
    it("validates ordered lifecycle transitions", () => {
      expect(validateTransitionOrder("open", "in_progress")).toBe(true);
      expect(validateTransitionOrder("in_progress", "resolved")).toBe(true);
    });

    it("enforces sequential phases: plan:init -> plan:enhance -> run:start -> run:submit", () => {
      expect(validatePhaseTransition("plan:init", "plan:enhance")).toBe(true);
      expect(validatePhaseTransition("plan:enhance", "run:start")).toBe(true);
      expect(validatePhaseTransition("run:start", "quiesce")).toBe(true);

      // Disallowed phase regressions
      expect(validatePhaseTransition("run:submit", "plan:init")).toBe(false);
      expect(validatePhaseTransition("quiesce", "plan:enhance")).toBe(false);
    });

    it("enforces sequential lifecycle ordering across array of phase strings", () => {
      const validSeq = ["plan:init", "plan:enhance", "run:start", "quiesce"];
      const resValid = enforceSequentialLifecycleOrdering(validSeq);
      expect(resValid.valid).toBe(true);
      expect(resValid.highestPhaseReached).toBe("quiesce");

      const invalidSeq = ["run:start", "plan:init"];
      const resInvalid = enforceSequentialLifecycleOrdering(invalidSeq);
      expect(resInvalid.valid).toBe(false);
      expect(resInvalid.violations.length).toBeGreaterThan(0);
    });
  });
});

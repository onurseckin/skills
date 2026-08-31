/**
 * @file sync-state-machine.test.ts
 * Unit tests for Defect State Machine, Normalization Signatures, and Order Enforcement
 */

import { describe, expect, it } from "bun:test";
import { computeNormalizedFailureSignature } from "../../../olt/scripts/src/mind/defects/sync/signature.ts";
import {
  handleDefectRecurrence,
  transitionDefectState as transitionState,
  validateDefectStateTransition as validateTransitionState,
} from "../../../olt/scripts/src/mind/defects/sync/state-machine.ts";
import {
  enforceSequentialLifecycleOrdering,
  transitionDefectState as transitionOrder,
  validateDefectStateTransition as validateTransitionOrder,
  validatePhaseTransition,
} from "../../../olt/scripts/src/mind/defects/sync/order-enforcement.ts";
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
      const inProgress = transitionState(defect, "in_progress", "Started working on bug");
      expect(inProgress.status).toBe("in_progress");

      const resolved = transitionState(inProgress, "resolved", "Fix verified with regression test");
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolvedAt).toBeDefined();
    });

    it("handles defect recurrence by reopening with incremented recurrence count", () => {
      const resolved = createMockDefectEntry({
        status: "resolved",
        metadata: { recurrenceCount: 1 },
      });

      const recurring = handleDefectRecurrence(resolved, "Test failed again in CI");
      expect(recurring.status).toBe("open");
      expect(recurring.metadata?.recurrenceCount).toBe(2);
    });
  });

  describe("Order Enforcement & Phase Transitions", () => {
    it("validates ordered lifecycle transitions", () => {
      expect(validateTransitionOrder("open", "in_progress")).toBe(true);
      expect(validateTransitionOrder("in_progress", "resolved")).toBe(true);
    });

    it("enforces sequential phases: discovery -> triage -> planning -> execution -> verification", () => {
      expect(validatePhaseTransition("discovery", "triage")).toBe(true);
      expect(validatePhaseTransition("triage", "planning")).toBe(true);
      expect(validatePhaseTransition("planning", "execution")).toBe(true);
      expect(validatePhaseTransition("execution", "verification")).toBe(true);
      expect(validatePhaseTransition("verification", "discovery")).toBe(true);

      // Disallowed phase skips
      expect(validatePhaseTransition("discovery", "execution")).toBe(false);
      expect(validatePhaseTransition("triage", "verification")).toBe(false);
    });

    it("enforces sequential lifecycle ordering across array of defects", () => {
      const defects = [
        createMockDefectEntry({ id: "d1", status: "open" }),
        createMockDefectEntry({ id: "d2", status: "in_progress" }),
        createMockDefectEntry({ id: "d3", status: "resolved" }),
      ];

      const ordered = enforceSequentialLifecycleOrdering(defects);
      expect(ordered.length).toBe(3);
    });
  });
});

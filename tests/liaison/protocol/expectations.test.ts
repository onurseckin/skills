import { describe, expect, it } from "bun:test";
import {
  DEFAULT_OBLIGATION_TIMEOUT_MS,
  ObligationTracker,
  createExpectationDeclaration,
  detectOverdueObligations,
  evaluateObligationStatus,
  isExpectationType,
} from "../../../olt/scripts/src/liaison/protocol/expectations.ts";
import {
  createReceiptBound,
  createReceiptDelivered,
  createReceiptRefused,
  createTaskScopeProof,
} from "../../../olt/scripts/src/liaison/protocol/receipts.ts";
import type { TrackedObligation } from "../../../olt/scripts/src/liaison/protocol/types.ts";

describe("Explicit expectation handling & unbound obligation detection", () => {
  describe("Expectation declarations", () => {
    it("validates expectation types", () => {
      expect(isExpectationType("receipt")).toBe(true);
      expect(isExpectationType("verdict")).toBe(true);
      expect(isExpectationType("nothing")).toBe(true);
      expect(isExpectationType("invalid")).toBe(false);
      expect(isExpectationType(123)).toBe(false);
    });

    it("creates an explicit expectation declaration with defaults", () => {
      const decl = createExpectationDeclaration("msg-1", "corr-1", "receipt");
      expect(decl.message_id).toBe("msg-1");
      expect(decl.correlation_id).toBe("corr-1");
      expect(decl.expectation).toBe("receipt");
      expect(decl.timeout_ms).toBe(DEFAULT_OBLIGATION_TIMEOUT_MS);
      expect(decl.declared_at).toBeDefined();
    });

    it("allows custom timeout window", () => {
      const decl = createExpectationDeclaration("msg-2", "corr-1", "verdict", 30_000);
      expect(decl.timeout_ms).toBe(30_000);
      expect(decl.expectation).toBe("verdict");
    });
  });

  describe("Obligation evaluation status transitions", () => {
    it("marks informational expectations (nothing) as INFORMATIONAL and never overdue", () => {
      const obligation: TrackedObligation = {
        message_id: "msg-info",
        correlation_id: "corr-1",
        expectation: "nothing",
        timeout_ms: 5000,
        created_at: "2026-09-06T10:00:00.000Z",
      };

      const now = new Date("2026-09-06T12:00:00.000Z").getTime();
      const assessment = evaluateObligationStatus(obligation, now);
      expect(assessment.status).toBe("INFORMATIONAL");
      expect(assessment.is_overdue).toBe(false);
    });

    it("marks undelivered obligations as PENDING_DELIVERY", () => {
      const obligation: TrackedObligation = {
        message_id: "msg-pending",
        correlation_id: "corr-1",
        expectation: "receipt",
        timeout_ms: 10_000,
        created_at: "2026-09-06T10:00:00.000Z",
      };

      const now = new Date("2026-09-06T10:00:05.000Z").getTime();
      const assessment = evaluateObligationStatus(obligation, now);
      expect(assessment.status).toBe("PENDING_DELIVERY");
      expect(assessment.is_overdue).toBe(false);
    });

    it("marks delivered obligations as AWAITING_BINDING within the timeout window", () => {
      const deliveredTime = "2026-09-06T10:00:00.000Z";
      const obligation: TrackedObligation = {
        message_id: "msg-delivered",
        correlation_id: "corr-1",
        expectation: "receipt",
        timeout_ms: 60_000,
        created_at: deliveredTime,
        delivered_receipt: createReceiptDelivered("msg-delivered", "corr-1", deliveredTime),
      };

      // 30 seconds later (within 60s window)
      const now = new Date("2026-09-06T10:00:30.000Z").getTime();
      const assessment = evaluateObligationStatus(obligation, now);
      expect(assessment.status).toBe("AWAITING_BINDING");
      expect(assessment.is_overdue).toBe(false);
      expect(assessment.elapsed_ms).toBe(30_000);
      expect(assessment.remaining_ms).toBe(30_000);
    });

    it("flags delivered obligations as OVERDUE when timeout window is exceeded", () => {
      const deliveredTime = "2026-09-06T10:00:00.000Z";
      const obligation: TrackedObligation = {
        message_id: "msg-overdue",
        correlation_id: "corr-1",
        expectation: "receipt",
        timeout_ms: 60_000,
        created_at: deliveredTime,
        delivered_receipt: createReceiptDelivered("msg-overdue", "corr-1", deliveredTime),
      };

      // 61 seconds later (timeout exceeded!)
      const now = new Date("2026-09-06T10:01:01.000Z").getTime();
      const assessment = evaluateObligationStatus(obligation, now);
      expect(assessment.status).toBe("OVERDUE");
      expect(assessment.is_overdue).toBe(true);
      expect(assessment.elapsed_ms).toBe(61_000);
      expect(assessment.remaining_ms).toBe(0);
    });

    it("marks resolved obligations as RESOLVED_BOUND or RESOLVED_REFUSED", () => {
      const deliveredTime = "2026-09-06T10:00:00.000Z";
      const boundReceipt = createReceiptBound("msg-resolved", "corr-1", [
        createTaskScopeProof("src/app.ts", "run-1", "task-1"),
      ]);

      const obligationBound: TrackedObligation = {
        message_id: "msg-resolved",
        correlation_id: "corr-1",
        expectation: "receipt",
        timeout_ms: 10_000,
        created_at: deliveredTime,
        delivered_receipt: createReceiptDelivered("msg-resolved", "corr-1", deliveredTime),
        phase2_receipt: boundReceipt,
      };

      // Even hours later, a resolved bound obligation is never overdue
      const lateTime = new Date("2026-09-06T15:00:00.000Z").getTime();
      expect(evaluateObligationStatus(obligationBound, lateTime).status).toBe("RESOLVED_BOUND");
      expect(evaluateObligationStatus(obligationBound, lateTime).is_overdue).toBe(false);

      const refusedReceipt = createReceiptRefused(
        "msg-refused",
        "corr-1",
        "out_of_scope",
        "src/unsupported.ts",
      );
      const obligationRefused: TrackedObligation = {
        ...obligationBound,
        message_id: "msg-refused",
        phase2_receipt: refusedReceipt,
      };
      expect(evaluateObligationStatus(obligationRefused, lateTime).status).toBe("RESOLVED_REFUSED");
      expect(evaluateObligationStatus(obligationRefused, lateTime).is_overdue).toBe(false);
    });
  });

  describe("ObligationTracker and overdue detection engine", () => {
    it("tracks multiple obligations and isolates overdue items", () => {
      const tracker = new ObligationTracker();
      const baseTime = new Date("2026-09-06T10:00:00.000Z").getTime();

      // Obligation 1: timeout 10s, delivered at baseTime
      tracker.registerExpectation(
        createExpectationDeclaration(
          "msg-1",
          "corr-1",
          "receipt",
          10_000,
          new Date(baseTime).toISOString(),
        ),
      );
      tracker.recordDelivered(
        createReceiptDelivered("msg-1", "corr-1", new Date(baseTime).toISOString()),
      );

      // Obligation 2: timeout 60s, delivered at baseTime
      tracker.registerExpectation(
        createExpectationDeclaration(
          "msg-2",
          "corr-1",
          "receipt",
          60_000,
          new Date(baseTime).toISOString(),
        ),
      );
      tracker.recordDelivered(
        createReceiptDelivered("msg-2", "corr-1", new Date(baseTime).toISOString()),
      );

      // Obligation 3: informational (nothing)
      tracker.registerExpectation(
        createExpectationDeclaration(
          "msg-3",
          "corr-1",
          "nothing",
          5000,
          new Date(baseTime).toISOString(),
        ),
      );

      // Check at baseTime + 15 seconds:
      // msg-1 is overdue (15s > 10s)
      // msg-2 is awaiting binding (15s < 60s)
      // msg-3 is informational
      const overdueAt15s = tracker.getOverdueObligations(baseTime + 15_000);
      expect(overdueAt15s).toHaveLength(1);
      expect(overdueAt15s[0].message_id).toBe("msg-1");
      expect(overdueAt15s[0].is_overdue).toBe(true);

      // Now resolve msg-1 with a bound receipt
      tracker.recordPhase2(
        createReceiptBound("msg-1", "corr-1", [
          createTaskScopeProof("path/to/file.ts", "run-1", "task-1"),
        ]),
      );

      // Re-check at baseTime + 15s: msg-1 is no longer overdue!
      expect(tracker.getOverdueObligations(baseTime + 15_000)).toHaveLength(0);

      // At baseTime + 65s: msg-2 becomes overdue
      const overdueAt65s = tracker.getOverdueObligations(baseTime + 65_000);
      expect(overdueAt65s).toHaveLength(1);
      expect(overdueAt65s[0].message_id).toBe("msg-2");
    });

    it("blocks on verdict until verification result arrives", () => {
      const tracker = new ObligationTracker();
      tracker.registerExpectation(createExpectationDeclaration("verdict-msg", "corr-v", "verdict"));

      expect(tracker.isBlockedOnVerdict("verdict-msg")).toBe(true);

      tracker.recordDelivered(createReceiptDelivered("verdict-msg", "corr-v"));
      expect(tracker.isBlockedOnVerdict("verdict-msg")).toBe(true);

      tracker.recordPhase2(
        createReceiptBound("verdict-msg", "corr-v", [
          createTaskScopeProof("foo.ts", "run", "task"),
        ]),
      );
      // Now verdict obligation is resolved, unblocked!
      expect(tracker.isBlockedOnVerdict("verdict-msg")).toBe(false);
    });

    it("evaluates overdue using detectOverdueObligations standalone helper", () => {
      const now = Date.now();
      const pastTime = new Date(now - 100_000).toISOString();
      const list: TrackedObligation[] = [
        {
          message_id: "m-old",
          correlation_id: "c-old",
          expectation: "receipt",
          timeout_ms: 50_000,
          created_at: pastTime,
          delivered_receipt: createReceiptDelivered("m-old", "c-old", pastTime),
        },
      ];

      const detected = detectOverdueObligations(list, now);
      expect(detected).toHaveLength(1);
      expect(detected[0].message_id).toBe("m-old");
    });
  });
});

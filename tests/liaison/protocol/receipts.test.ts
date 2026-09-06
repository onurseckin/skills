import { describe, expect, it } from "bun:test";
import {
  createArtefactProof,
  createReceiptBound,
  createReceiptDelivered,
  createReceiptRefused,
  createTaskScopeProof,
  isPathContainedInScope,
  isReceiptBound,
  isReceiptDelivered,
  isReceiptRefused,
  isTwoPhaseReceipt,
  normalizePath,
  verifyBindingProof,
  verifyBindingProofSync,
  verifyReceiptBound,
  verifyReceiptBoundSync,
} from "../../../olt/scripts/src/liaison/protocol/receipts.ts";
import type { WriteScopeRecord } from "../../../olt/scripts/src/liaison/protocol/types.ts";

describe("Two-phase receipts wire contract", () => {
  describe("Receipt creation and type guards", () => {
    it("creates and validates RECEIPT_DELIVERED transport fact", () => {
      const receipt = createReceiptDelivered("msg-101", "corr-202", "2026-09-06T12:00:00.000Z");

      expect(receipt.type).toBe("RECEIPT_DELIVERED");
      expect(receipt.message_id).toBe("msg-101");
      expect(receipt.correlation_id).toBe("corr-202");
      expect(receipt.timestamp).toBe("2026-09-06T12:00:00.000Z");
      expect(isReceiptDelivered(receipt)).toBe(true);
      expect(isTwoPhaseReceipt(receipt)).toBe(true);
      expect(isReceiptBound(receipt)).toBe(false);
      expect(isReceiptRefused(receipt)).toBe(false);
    });

    it("creates and validates RECEIPT_BOUND with checkable proof", () => {
      const proof = createTaskScopeProof("src/auth/token.ts", "run-1", "task-a");
      const receipt = createReceiptBound("msg-102", "corr-202", [proof]);

      expect(receipt.type).toBe("RECEIPT_BOUND");
      expect(receipt.bindings).toHaveLength(1);
      expect(receipt.bindings[0].kind).toBe("task_scope");
      expect(isReceiptBound(receipt)).toBe(true);
      expect(isTwoPhaseReceipt(receipt)).toBe(true);
      expect(isReceiptDelivered(receipt)).toBe(false);
    });

    it("creates and validates RECEIPT_REFUSED with legitimate reasons", () => {
      const refOutOfScope = createReceiptRefused(
        "msg-103",
        "corr-202",
        "out_of_scope",
        "driver/progression",
        "Lane does not cover driver domain",
      );
      expect(refOutOfScope.type).toBe("RECEIPT_REFUSED");
      expect(refOutOfScope.reason).toBe("out_of_scope");
      expect(refOutOfScope.requirement_or_path).toBe("driver/progression");
      expect(isReceiptRefused(refOutOfScope)).toBe(true);
      expect(isTwoPhaseReceipt(refOutOfScope)).toBe(true);

      const refDisagreed = createReceiptRefused(
        "msg-104",
        "corr-202",
        "disagreed",
        "req-arch-change",
      );
      expect(refDisagreed.reason).toBe("disagreed");
      expect(isReceiptRefused(refDisagreed)).toBe(true);

      const refBlocked = createReceiptRefused("msg-105", "corr-202", "blocked", "db/migration");
      expect(refBlocked.reason).toBe("blocked");
      expect(isReceiptRefused(refBlocked)).toBe(true);
    });

    it("rejects invalid receipt shapes", () => {
      expect(isReceiptDelivered(null)).toBe(false);
      expect(isReceiptDelivered({ type: "RECEIPT_DELIVERED" })).toBe(false);
      expect(isReceiptBound({ type: "RECEIPT_BOUND", bindings: "invalid" })).toBe(false);
      expect(isReceiptRefused({ type: "RECEIPT_REFUSED", reason: "invalid_reason" })).toBe(false);
      expect(isTwoPhaseReceipt({})).toBe(false);
    });
  });

  describe("Path normalization and containment", () => {
    it("normalizes path separators and relative markers", () => {
      expect(normalizePath("./src/lib/file.ts")).toBe("src/lib/file.ts");
      expect(normalizePath("src\\lib\\file.ts")).toBe("src/lib/file.ts");
      expect(normalizePath("src/lib/")).toBe("src/lib");
    });

    it("evaluates path containment correctly", () => {
      expect(isPathContainedInScope("src/auth/token.ts", "src/auth")).toBe(true);
      expect(isPathContainedInScope("src/auth/token.ts", "src/auth/token.ts")).toBe(true);
      expect(isPathContainedInScope("src/author/token.ts", "src/auth")).toBe(false);
      expect(isPathContainedInScope("driver/progression", "booking/guest")).toBe(false);
    });
  });

  describe("Mechanical write-scope binding proof verification", () => {
    const scopes: readonly WriteScopeRecord[] = [
      {
        run_id: "wave-37",
        task_id: "task-booking",
        write_scope: ["booking/guest", "admin/dispatch-grid", "passenger-flow"],
      },
      {
        run_id: "wave-38",
        task_id: "task-driver",
        write_scope: ["driver/progression/"],
      },
    ];

    it("verifies valid task scope binding synchronously and asynchronously", async () => {
      const validProof = createTaskScopeProof(
        "booking/guest/checkout.ts",
        "wave-37",
        "task-booking",
      );

      const syncResult = verifyBindingProofSync(validProof, scopes);
      expect(syncResult.valid).toBe(true);
      expect(syncResult.reason).toBeUndefined();

      const asyncResult = await verifyBindingProof(validProof, scopes);
      expect(asyncResult.valid).toBe(true);
    });

    it("mechanically detects unbound path not in task write scope (the Wave 37 defect)", async () => {
      // Forensics 2.1: dwell-ticker in driver/progression claimed under task-booking whose scope is booking/guest
      const invalidProof = createTaskScopeProof(
        "driver/progression/ticker.ts",
        "wave-37",
        "task-booking",
      );

      const syncResult = verifyBindingProofSync(invalidProof, scopes);
      expect(syncResult.valid).toBe(false);
      expect(syncResult.reason).toContain("not found in write scope");

      const asyncResult = await verifyBindingProof(invalidProof, scopes);
      expect(asyncResult.valid).toBe(false);
      expect(asyncResult.reason).toContain("not found in write scope");
    });

    it("fails when task or run does not exist in compiled plan", () => {
      const nonExistent = createTaskScopeProof("src/app.ts", "wave-unknown", "task-unknown");
      const result = verifyBindingProofSync(nonExistent, scopes);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("No write scope found");
    });

    it("verifies satisfying artefact proofs", async () => {
      const artefactProof = createArtefactProof({
        artefact_path: "reports/wave-37-verification.json",
        artefact_class: "unit_test_log",
      });

      const result = verifyBindingProofSync(artefactProof, scopes);
      expect(result.valid).toBe(true);

      const commitProof = createArtefactProof({
        commit_hash: "a1b2c3d4e5f6",
        requirement: "git_commit_sha",
      });
      expect(verifyBindingProofSync(commitProof, scopes).valid).toBe(true);

      const emptyProof = createArtefactProof({});
      const emptyResult = verifyBindingProofSync(emptyProof, scopes);
      expect(emptyResult.valid).toBe(false);
      expect(emptyResult.reason).toContain(
        "requires at least one non-empty artefact_path or commit_hash",
      );
    });

    it("verifies full ReceiptBound summary", async () => {
      const mixedReceipt = createReceiptBound("msg-200", "corr-200", [
        createTaskScopeProof("booking/guest/view.ts", "wave-37", "task-booking"),
        createTaskScopeProof("driver/unbound.ts", "wave-37", "task-booking"), // invalid
      ]);

      const summary = verifyReceiptBoundSync(mixedReceipt, scopes);
      expect(summary.valid).toBe(false);
      expect(summary.results).toHaveLength(2);
      expect(summary.errors).toHaveLength(1);
      expect(summary.errors[0]).toContain("driver/unbound.ts");

      const emptyReceipt = createReceiptBound("msg-201", "corr-200", []);
      const emptySummary = await verifyReceiptBound(emptyReceipt, scopes);
      expect(emptySummary.valid).toBe(false);
      expect(emptySummary.errors[0]).toContain("no binding proofs");
    });
  });
});

import { describe, expect, test } from "bun:test";
import {
  verifyFailureProof,
  assertFailureProofValid,
  validateDefectStateTransition,
  transitionDefectState,
  handleDefectRecurrence,
  type EmpiricalFailureProof,
} from "../../../olt/scripts/src/mind/defects/sync/index.ts";
import type { DefectEntry } from "../../../olt/scripts/src/mind/contracts/defect-contracts.ts";

describe("Wave 3 - Task 3.2: Defect State Transition Validation & Empirical Proof Gate", () => {
  const sampleDefect: DefectEntry = {
    id: "defect-1",
    type: "AST_PURITY_VIOLATION",
    category: "linter",
    severity: "high",
    status: "completed",
    observation: "as any used",
    remediation: "Remove as any",
    timestamp: "2026-08-29T00:00:00.000Z",
    first_seen_at: "2026-08-29T00:00:00.000Z",
    last_seen_at: "2026-08-29T00:00:00.000Z",
    count: 1,
    dedup_key: "linter::ast_purity_violation::hash123",
  };

  test("verifyFailureProof enforces non-empty commit_sha, test_assertion, and task_id", () => {
    const validProof: EmpiricalFailureProof = {
      commit_sha: "abc1234def5678",
      test_assertion: "expect(purity).toBe(true)",
      task_id: "task-test-1",
      timestamp: "2026-08-29T01:00:00.000Z",
    };
    expect(verifyFailureProof(validProof).valid).toBe(true);

    const invalidProof1 = { commit_sha: "", test_assertion: "test", task_id: "task-1" };
    expect(verifyFailureProof(invalidProof1).valid).toBe(false);

    const invalidProof2 = { commit_sha: "abc", test_assertion: "", task_id: "task-1" };
    expect(verifyFailureProof(invalidProof2).valid).toBe(false);

    const invalidProof3 = { commit_sha: "abc", test_assertion: "test", task_id: "" };
    expect(verifyFailureProof(invalidProof3).valid).toBe(false);

    const pendingProof = {
      commit_sha: "empirical-proof-pending",
      test_assertion: "test",
      task_id: "task-1",
    };
    expect(verifyFailureProof(pendingProof).valid).toBe(false);
  });

  test("assertFailureProofValid throws INTEGRITY error on invalid proof", () => {
    expect(() => {
      assertFailureProofValid({ commit_sha: "" });
    }).toThrow(/Cannot reopen previously completed defect without empirical failure proof/u);
  });

  test("transitionDefectState throws INTEGRITY when reopening completed defect without valid proof", () => {
    expect(() => {
      transitionDefectState(sampleDefect, "open");
    }).toThrow(/Invalid defect transition/u);
  });

  test("transitionDefectState succeeds when reopening with valid empirical failure proof", () => {
    const validProof: EmpiricalFailureProof = {
      commit_sha: "abc1234def5678",
      test_assertion: "expect(purity).toBe(true)",
      task_id: "task-test-1",
      timestamp: "2026-08-29T01:00:00.000Z",
    };

    const updated = transitionDefectState(sampleDefect, "open", validProof);
    expect(updated.status).toBe("open");
    expect(updated.count).toBe(2);
    expect(updated.failure_proof).toBeDefined();
    expect(updated.reopened_at).toBeDefined();
  });

  test("handleDefectRecurrence transitions completed defect to deliberating when proof is absent", () => {
    const recurrent = handleDefectRecurrence(sampleDefect);
    expect(recurrent.status).toBe("deliberating");
    expect(recurrent.count).toBe(2);
  });
});

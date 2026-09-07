import { expect, test, describe } from "bun:test";
import {
  deriveTaskTwoKeyPairing,
  taskTwoKeyValidatorPairingIssues,
  verifyTwoKeyValidatorPairing,
} from "../../olt/scripts/src/workflow/completion/index.ts";
import { evaluateSocraticSelfQuestioning } from "../../olt/scripts/src/reporting/socratic-validator/index.ts";
import type { TwoKeyValidatorPairing } from "../../olt/scripts/src/workflow/completion/index.ts";
import type { TaskRecord } from "../../olt/scripts/src/workflow/types.ts";

function doneTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "T-1",
    status: "done",
    requirement_ids: ["R-1"],
    write_scope: ["src/owned"],
    dependencies: [],
    history: [],
    repair_round: 0,
    original_implementer: "implementer-1",
    report: { summary: "done" },
    attempts: [{ agent_id: "implementer-1", submitted_at: "2023-01-01T00:00:00Z" }],
    validations: [
      {
        validator_id: "validator-2",
        domain: "code-quality",
        token_digest: "digest",
        attempt: 1,
        started_at: "2023-01-01T01:00:00Z",
        deadline_at: "2023-01-01T02:00:00Z",
        verdict: "pass",
        reviewed_requirement_ids: ["R-1"],
        checks: [{ command_id: "C-1" }],
      },
    ],
    ...overrides,
  };
}

describe("Two-Key Validator Pairing", () => {
  test("accepts valid independent validator receipts", () => {
    const validPairing: TwoKeyValidatorPairing = {
      implementer_receipt: {
        actor: "implementer-1",
        role: "implementer",
        receipt_sha256: "hash-123",
        timestamp: "2023-01-01T00:00:00Z",
      },
      cognitive_validator_receipt: {
        actor: "validator-2",
        role: "cognitive_validator",
        receipt_sha256: "hash-456",
        timestamp: "2023-01-01T01:00:00Z",
      },
    };

    const result = verifyTwoKeyValidatorPairing(validPairing);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test("rejects if implementer and validator are the same actor", () => {
    const invalidPairing: TwoKeyValidatorPairing = {
      implementer_receipt: {
        actor: "implementer-1",
        role: "implementer",
        receipt_sha256: "hash-123",
        timestamp: "2023-01-01T00:00:00Z",
      },
      cognitive_validator_receipt: {
        actor: "implementer-1",
        role: "cognitive_validator",
        receipt_sha256: "hash-456",
        timestamp: "2023-01-01T01:00:00Z",
      },
    };

    const result = verifyTwoKeyValidatorPairing(invalidPairing);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("independent actors");
  });

  test("rejects if implementer receipt is missing hash", () => {
    const invalidPairing = {
      implementer_receipt: {
        actor: "implementer-1",
        role: "implementer",
        timestamp: "2023-01-01T00:00:00Z",
      },
      cognitive_validator_receipt: {
        actor: "validator-2",
        role: "cognitive_validator",
        receipt_sha256: "hash-456",
        timestamp: "2023-01-01T01:00:00Z",
      },
    } as unknown as TwoKeyValidatorPairing;

    const result = verifyTwoKeyValidatorPairing(invalidPairing);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Implementer test receipt");
  });

  test("rejects if cognitive validator role is incorrect", () => {
    const invalidPairing = {
      implementer_receipt: {
        actor: "implementer-1",
        role: "implementer",
        receipt_sha256: "hash-123",
        timestamp: "2023-01-01T00:00:00Z",
      },
      cognitive_validator_receipt: {
        actor: "validator-2",
        role: "implementer",
        receipt_sha256: "hash-456",
        timestamp: "2023-01-01T01:00:00Z",
      },
    } as unknown as TwoKeyValidatorPairing;

    const result = verifyTwoKeyValidatorPairing(invalidPairing);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Cognitive Validator");
  });
});

describe("deriveTaskTwoKeyPairing: derivation from recorded evidence", () => {
  test("derives independent implementer and validator receipts from the task's report and passing validation", () => {
    const pairing = deriveTaskTwoKeyPairing(doneTask());
    expect(pairing).toBeDefined();
    expect(pairing?.implementer_receipt.actor).toBe("implementer-1");
    expect(pairing?.implementer_receipt.receipt_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pairing?.cognitive_validator_receipt.actor).toBe("validator-2");
    expect(pairing?.cognitive_validator_receipt.receipt_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyTwoKeyValidatorPairing(pairing!).valid).toBe(true);
  });

  test("returns undefined when the task has no submission report", () => {
    const task = doneTask({ report: undefined });
    expect(deriveTaskTwoKeyPairing(task)).toBeUndefined();
  });

  test("returns undefined when no validation reached a passing verdict", () => {
    const task = doneTask({
      validations: [
        {
          validator_id: "validator-2",
          domain: "code-quality",
          token_digest: "digest",
          attempt: 1,
          started_at: "2023-01-01T01:00:00Z",
          deadline_at: "2023-01-01T02:00:00Z",
          verdict: "reject",
        },
      ],
    });
    expect(deriveTaskTwoKeyPairing(task)).toBeUndefined();
  });
});

describe("taskTwoKeyValidatorPairingIssues: landing-path gate", () => {
  test("lands cleanly when both an implementer and an independent validator receipt exist", () => {
    expect(taskTwoKeyValidatorPairingIssues(doneTask())).toEqual([]);
  });

  test("blocks the task when the implementer receipt is missing", () => {
    const task = doneTask({ original_implementer: undefined });
    expect(taskTwoKeyValidatorPairingIssues(task)).toEqual([
      "task T-1 lacks an independent Implementer test receipt",
    ]);
  });

  test("blocks the task when the cognitive validator receipt is missing", () => {
    const task = doneTask({ validations: [], validation_history: [] });
    expect(taskTwoKeyValidatorPairingIssues(task)).toEqual([
      "task T-1 lacks an independent Cognitive Validator audit receipt",
    ]);
  });

  test("blocks the task when the validator identity equals the implementer identity", () => {
    const task = doneTask({
      original_implementer: "same-actor",
      attempts: [{ agent_id: "same-actor", submitted_at: "2023-01-01T00:00:00Z" }],
      validations: [
        {
          validator_id: "same-actor",
          domain: "code-quality",
          token_digest: "digest",
          attempt: 1,
          started_at: "2023-01-01T01:00:00Z",
          deadline_at: "2023-01-01T02:00:00Z",
          verdict: "pass",
        },
      ],
    });
    expect(taskTwoKeyValidatorPairingIssues(task)).toEqual([
      "task T-1 two-key validator pairing invalid: Implementer and Cognitive Validator must be independent actors.",
    ]);
  });
});

describe("Socratic Validator - Two Key Pairing Dimension", () => {
  test("evaluates two key pairing dimension optimally when a completed task has both receipts", () => {
    const state = { tasks: { "T-1": doneTask() } };

    const report = evaluateSocraticSelfQuestioning("/tmp", state);
    const pairingEval = report.questions.find((q) => q.dimension === "two_key_validator_pairing");

    expect(pairingEval).toBeDefined();
    expect(pairingEval?.passed).toBe(true);
    expect(pairingEval?.verdict).toBe("OPTIMAL");
  });

  test("flags defect when a completed task's implementer and validator share an identity", () => {
    const state = {
      tasks: {
        "T-1": doneTask({
          original_implementer: "same-actor",
          attempts: [{ agent_id: "same-actor", submitted_at: "2023-01-01T00:00:00Z" }],
          validations: [
            {
              validator_id: "same-actor",
              domain: "code-quality",
              token_digest: "digest",
              attempt: 1,
              started_at: "2023-01-01T01:00:00Z",
              deadline_at: "2023-01-01T02:00:00Z",
              verdict: "pass",
            },
          ],
        }),
      },
    };

    const report = evaluateSocraticSelfQuestioning("/tmp", state);
    const pairingEval = report.questions.find((q) => q.dimension === "two_key_validator_pairing");

    expect(pairingEval).toBeDefined();
    expect(pairingEval?.passed).toBe(false);
    expect(pairingEval?.verdict).toBe("DEFECT_FLAGGED");
    expect(pairingEval?.observation).toContain("failed");
  });

  test("does not evaluate the dimension while no task has reached done status", () => {
    const state = { tasks: { "T-1": doneTask({ status: "validating" }) } };

    const report = evaluateSocraticSelfQuestioning("/tmp", state);
    const pairingEval = report.questions.find((q) => q.dimension === "two_key_validator_pairing");

    expect(pairingEval).toBeUndefined();
  });
});

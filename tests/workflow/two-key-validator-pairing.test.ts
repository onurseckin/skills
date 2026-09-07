import { expect, test, describe } from "bun:test";
import { verifyTwoKeyValidatorPairing } from "../../olt/scripts/src/workflow/completion/two-key-validator-pairing.ts";
import { evaluateSocraticSelfQuestioning } from "../../olt/scripts/src/reporting/socratic-validator/index.ts";
import type { TwoKeyValidatorPairing } from "../../olt/scripts/src/workflow/completion/two-key-validator-pairing.ts";

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

describe("Socratic Validator - Two Key Pairing Dimension", () => {
  test("evaluates two key pairing dimension optimally when provided", () => {
    const state = {
      two_key_pairing: {
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
      },
    };

    const report = evaluateSocraticSelfQuestioning("/tmp", state);
    const pairingEval = report.questions.find((q) => q.dimension === "two_key_validator_pairing");

    expect(pairingEval).toBeDefined();
    expect(pairingEval?.passed).toBe(true);
    expect(pairingEval?.verdict).toBe("OPTIMAL");
  });

  test("flags defect when pairing is invalid", () => {
    const state = {
      two_key_pairing: {
        implementer_receipt: {
          actor: "same-actor",
          role: "implementer",
          receipt_sha256: "hash-123",
          timestamp: "2023-01-01T00:00:00Z",
        },
        cognitive_validator_receipt: {
          actor: "same-actor",
          role: "cognitive_validator",
          receipt_sha256: "hash-456",
          timestamp: "2023-01-01T01:00:00Z",
        },
      },
    };

    const report = evaluateSocraticSelfQuestioning("/tmp", state);
    const pairingEval = report.questions.find((q) => q.dimension === "two_key_validator_pairing");

    expect(pairingEval).toBeDefined();
    expect(pairingEval?.passed).toBe(false);
    expect(pairingEval?.verdict).toBe("DEFECT_FLAGGED");
    expect(pairingEval?.observation).toContain("failed");
  });
});

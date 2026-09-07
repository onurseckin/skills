import { JsonObject } from "../../core/contracts/index.ts";

export interface ValidatorReceipt extends JsonObject {
  actor: string;
  role: "implementer" | "cognitive_validator";
  receipt_sha256: string;
  timestamp: string;
}

export interface TwoKeyValidatorPairing extends JsonObject {
  implementer_receipt: ValidatorReceipt;
  cognitive_validator_receipt: ValidatorReceipt;
}

export function verifyTwoKeyValidatorPairing(pairing: TwoKeyValidatorPairing): {
  valid: boolean;
  reason?: string;
} {
  const imp = pairing.implementer_receipt;
  const cog = pairing.cognitive_validator_receipt;

  if (!imp || imp.role !== "implementer" || !imp.receipt_sha256) {
    return { valid: false, reason: "Missing or invalid Implementer test receipt." };
  }

  if (!cog || cog.role !== "cognitive_validator" || !cog.receipt_sha256) {
    return { valid: false, reason: "Missing or invalid Cognitive Validator audit receipt." };
  }

  if (imp.actor === cog.actor) {
    return {
      valid: false,
      reason: "Implementer and Cognitive Validator must be independent actors.",
    };
  }

  return { valid: true };
}

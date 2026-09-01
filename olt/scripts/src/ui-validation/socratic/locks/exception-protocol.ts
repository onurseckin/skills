import { HarnessError } from "../../../core/errors/index.ts";
import {
  DEFAULT_UNLOCK_TOKEN_EXPIRATION_MS,
  MIN_ROOT_CAUSE_ANALYSIS_LENGTH,
  type ImmutabilityManifest,
  type EmpiricalRegressionProof,
  type OpticalRegressionUnlockToken,
  type UnlockRecord,
} from "./types.ts";
import { computeSha256, computeManifestSignature } from "./hashing.ts";

export function requestOpticalRegressionUnlock(
  this: any,

  proof: EmpiricalRegressionProof,
  options?: { expirationMs?: number; compensationCredit?: number },
): OpticalRegressionUnlockToken {
  this.verifyRegressionProof(proof);

  const manifest = this.manifests.get(proof.targetSealedRound);
  if (!manifest) {
    throw new HarnessError(
      "NOT_FOUND",
      `Cannot unlock Round ${proof.targetSealedRound}: No sealed milestone found for this round.`,
    );
  }

  if (manifest.lockStatus === "TEMPORARILY_UNLOCKED") {
    throw new HarnessError(
      "INVALID_STATE",
      `Round ${proof.targetSealedRound} is already temporarily unlocked.`,
    );
  }

  const expirationMs = options?.expirationMs ?? DEFAULT_UNLOCK_TOKEN_EXPIRATION_MS;
  const compensationCredit = options?.compensationCredit ?? 1;
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + expirationMs).toISOString();
  const tokenId = `token-opt-reg-${computeSha256({ proofId: proof.proofId, issuedAt }).slice(0, 12)}`;

  const token: OpticalRegressionUnlockToken = {
    tokenId,
    proofId: proof.proofId,
    sessionId: proof.sessionId,
    targetRound: proof.targetSealedRound,
    approvedScope: [proof.affectedScope],
    compensationCredit,
    issuedAt,
    expiresAt,
    isConsumed: false,
  };

  this.issuedTokens.set(tokenId, token);

  // Update manifest lock status to TEMPORARILY_UNLOCKED
  const updatedManifest: ImmutabilityManifest = {
    ...manifest,
    lockStatus: "TEMPORARILY_UNLOCKED",
  };
  this.manifests.set(proof.targetSealedRound, updatedManifest);

  return token;
}

/**
 * Validates the integrity and empirical rigor of the submitted regression proof
 */
export function verifyRegressionProof(proof: EmpiricalRegressionProof): void {
  if (!proof.proofId || proof.proofId.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "Proof ID cannot be empty");
  }

  if (proof.targetSealedRound < 1 || proof.targetSealedRound > 5) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Invalid target sealed round ${proof.targetSealedRound}.`,
    );
  }

  if (proof.currentActiveRound <= proof.targetSealedRound) {
    throw new HarnessError(
      "INVALID_STATE",
      `Invalid regression unlock target: Current active round ${proof.currentActiveRound} must be strictly greater than target sealed round ${proof.targetSealedRound}.`,
    );
  }

  if (!proof.affectedScope || proof.affectedScope.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "Affected scope must be specified");
  }

  if (
    !proof.rootCauseAnalysis ||
    proof.rootCauseAnalysis.trim().length < MIN_ROOT_CAUSE_ANALYSIS_LENGTH
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Root cause analysis must be substantive (minimum ${MIN_ROOT_CAUSE_ANALYSIS_LENGTH} characters). Provided length: ${proof.rootCauseAnalysis?.trim().length ?? 0}`,
    );
  }

  if (typeof proof.opticalDeltaMetric !== "number" || proof.opticalDeltaMetric <= 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Empirical optical delta metric must be a positive number > 0. Provided: ${proof.opticalDeltaMetric}`,
    );
  }

  if (!proof.evidenceArtifactHash || proof.evidenceArtifactHash.trim().length < 16) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Evidence artifact SHA-256 hash must be provided and valid for optical regression verification.",
    );
  }

  if (!proof.proposedRemediation || proof.proposedRemediation.trim().length < 10) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Proposed remediation must be substantively detailed (minimum 10 characters).",
    );
  }
}

/**
 * Reseals a temporarily unlocked milestone after targeted remediation has occurred.
 * Consumes the unlock token, computes new SHA-256 state payload hash, and updates unlock history.
 */
export function resealMilestone(
  this: any,

  roundNumber: number,
  updatedStatePayload: Record<string, unknown>,
  token: OpticalRegressionUnlockToken,
): ImmutabilityManifest {
  this.validateUnlockToken(token, roundNumber);

  const manifest = this.manifests.get(roundNumber);
  if (!manifest) {
    throw new HarnessError("NOT_FOUND", `Cannot reseal Round ${roundNumber}: Manifest not found.`);
  }

  if (manifest.lockStatus !== "TEMPORARILY_UNLOCKED") {
    throw new HarnessError(
      "INVALID_STATE",
      `Cannot reseal Round ${roundNumber}: Milestone is currently '${manifest.lockStatus}', expected 'TEMPORARILY_UNLOCKED'.`,
    );
  }

  // Mark token as consumed
  const consumedToken: OpticalRegressionUnlockToken = {
    ...token,
    isConsumed: true,
  };
  this.issuedTokens.set(token.tokenId, consumedToken);

  const resealedAt = new Date().toISOString();
  const newStatePayloadHash = computeSha256(updatedStatePayload);

  const unlockRecord: UnlockRecord = {
    recordId: `rec-unlock-${computeSha256({ tokenId: token.tokenId, resealedAt }).slice(0, 10)}`,
    tokenId: token.tokenId,
    proofId: token.proofId,
    targetRound: roundNumber,
    unlockedAt: token.issuedAt,
    resealedAt,
    reason: `Remediated optical regression in scope(s): ${token.approvedScope.join(", ")}`,
    compensationCreditGranted: token.compensationCredit,
    modifiedScope: token.approvedScope,
  };

  this.unlockHistory.push(unlockRecord);

  const updatedUnlockHistory = [...manifest.unlockHistory, unlockRecord];

  // Recompute manifest signature with new payload hash and resealed status
  const newManifestSignature = computeManifestSignature({
    sessionId: manifest.sessionId,
    roundNumber: manifest.roundNumber,
    roundName: manifest.roundName,
    sealedScope: manifest.sealedScope,
    statePayloadHash: newStatePayloadHash,
    challengeSummary: manifest.challengeSummary,
    sealedAt: manifest.sealedAt,
  });

  const resealedManifest: ImmutabilityManifest = {
    ...manifest,
    statePayloadHash: newStatePayloadHash,
    statePayloadSnapshot: JSON.parse(JSON.stringify(updatedStatePayload)),
    manifestSignature: newManifestSignature,
    lockStatus: "RESEALED",
    unlockHistory: updatedUnlockHistory,
  };

  this.manifests.set(roundNumber, resealedManifest);
  return resealedManifest;
}

/**
 * Verifies the cryptographic integrity of a single manifest against tampering
 */

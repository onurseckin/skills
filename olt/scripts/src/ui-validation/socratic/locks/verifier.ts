import { HarnessError, type JsonValue } from "../../../core/index.ts";
import type {
  ImmutabilityManifest,
  ManifestIntegrityResult,
  LockSystemIntegrityReport,
} from "./types.ts";
import {
  computeSha256,
  computeManifestSignature,
} from "./hashing.ts";

export function verifyManifestIntegrity(
  this: any,

    manifest: ImmutabilityManifest,
    currentStatePayload?: Record<string, unknown>,
  ): ManifestIntegrityResult {
    // 1. Verify manifest signature
    const expectedSignature = computeManifestSignature({
      sessionId: manifest.sessionId,
      roundNumber: manifest.roundNumber,
      roundName: manifest.roundName,
      sealedScope: manifest.sealedScope,
      statePayloadHash: manifest.statePayloadHash,
      challengeSummary: manifest.challengeSummary,
      sealedAt: manifest.sealedAt,
    });

    const signatureMatches = manifest.manifestSignature === expectedSignature;

    // 2. Verify state payload hash if snapshot or current state provided
    let stateHashMatches = true;
    let discrepancyReason: string | undefined;

    if (currentStatePayload) {
      const computedPayloadHash = computeSha256(currentStatePayload);
      stateHashMatches = computedPayloadHash === manifest.statePayloadHash;
      if (!stateHashMatches) {
        discrepancyReason = `Payload hash mismatch: Expected ${manifest.statePayloadHash}, computed ${computedPayloadHash}`;
      }
    } else if (manifest.statePayloadSnapshot) {
      const snapshotHash = computeSha256(manifest.statePayloadSnapshot);
      stateHashMatches = snapshotHash === manifest.statePayloadHash;
      if (!stateHashMatches) {
        discrepancyReason = `Snapshot payload hash mismatch: Manifest claims ${manifest.statePayloadHash}, but snapshot computes to ${snapshotHash}`;
      }
    }

    if (!signatureMatches && !discrepancyReason) {
      discrepancyReason = `Manifest signature mismatch: Expected ${expectedSignature}, found ${manifest.manifestSignature}`;
    }

    const isValid = signatureMatches && stateHashMatches;
    const tamperingDetected = !isValid;

    return {
      manifestId: manifest.manifestId,
      roundNumber: manifest.roundNumber,
      isValid,
      signatureMatches,
      stateHashMatches,
      tamperingDetected,
      ...(discrepancyReason !== undefined ? { discrepancyReason } : {}),
    };
  }

  /**
   * Verifies integrity of all milestone locks currently registered in the engine
   */
export function verifyAllMilestoneLocks(
  this: any,
): LockSystemIntegrityReport {
    const manifestResults: ManifestIntegrityResult[] = [];
    const tamperedRounds: number[] = [];

    for (const manifest of this.manifests.values()) {
      const result = this.verifyManifestIntegrity(manifest);
      manifestResults.push(result);
      if (result.tamperingDetected) {
        tamperedRounds.push(manifest.roundNumber);
      }
    }

    const isAllValid = tamperedRounds.length === 0;

    return {
      sessionId: this.activeSessionId,
      totalSealedMilestones: this.manifests.size,
      isAllValid,
      tamperedRounds,
      manifestResults,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Asserts system integrity, throwing HarnessError if any tampering is detected
   */
export function assertIntegrity(
  this: any,
): void {
    const report = this.verifyAllMilestoneLocks();
    if (!report.isAllValid) {
      throw new HarnessError(
        "INTEGRITY",
        `Milestone Lock Tampering Detected in Round(s): [${report.tamperedRounds.join(", ")}]. Cryptographic hashes do not match signatures.`,
        report.manifestResults.filter((r: ManifestIntegrityResult) => r.tamperingDetected) as unknown as readonly JsonValue[],
      );
    }
  }

  /**
   * Resets all internal manifests, tokens, and history
   */

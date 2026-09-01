// @ts-nocheck
import { HarnessError } from "../../../core/errors/index.ts";
import {
  ROUND_SCOPES,
  type MilestoneLockStatus,
  type UnlockRecord,
  type ImmutabilityManifest,
  type SealMilestoneInput,
  type EmpiricalRegressionProof,
  type OpticalRegressionUnlockToken,
  type ManifestIntegrityResult,
  type LockSystemIntegrityReport,
  type ScopeMutationRequest,
} from "./types.ts";
import {
  canonicalJsonStringify,
  computeSha256,
  computeManifestSignature,
} from "./hashing.ts";
import {
  requestOpticalRegressionUnlock,
  verifyRegressionProof,
  resealMilestone,
} from "./exception-protocol.ts";
import {
  verifyManifestIntegrity,
  verifyAllMilestoneLocks,
  assertIntegrity,
} from "./verifier.ts";

export class MilestoneLockEngine {
  private readonly manifests: Map<number, ImmutabilityManifest> = new Map();
  private readonly issuedTokens: Map<string, OpticalRegressionUnlockToken> = new Map();
  private readonly unlockHistory: UnlockRecord[] = [];
  private activeSessionId: string = "default-session";
  private highestSealedRound: number = 0;

  public constructor(sessionId?: string) {
    if (sessionId) {
      this.activeSessionId = sessionId;
    }
  }

  public getSessionId(): string {
    return this.activeSessionId;
  }

  public setSessionId(sessionId: string): void {
    if (!sessionId || sessionId.trim().length === 0) {
      throw new HarnessError("INVALID_ARGUMENT", "Session ID cannot be empty");
    }
    this.activeSessionId = sessionId;
  }

  public getHighestSealedRound(): number {
    return this.highestSealedRound;
  }

  /**
   * Seals a milestone upon successful completion of a Socratic round.
   * Enforces Monotonic Convergence Law (cannot seal out of order).
   */
  public sealMilestone(input: SealMilestoneInput): ImmutabilityManifest {
    const { sessionId, roundNumber, roundName, statePayload, challengeSummary, customScopes } = input;

    if (roundNumber < 1 || roundNumber > 5) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Invalid round number ${roundNumber}. Socratic rounds must be between 1 and 5.`,
      );
    }

    // Monotonic Convergence Law: Round N can only be sealed if Round N-1 is sealed (for N > 1)
    if (roundNumber > 1 && !this.manifests.has(roundNumber - 1)) {
      throw new HarnessError(
        "INVALID_STATE",
        `Monotonic Convergence Law Violation: Cannot seal Round ${roundNumber} before Round ${roundNumber - 1} is sealed.`,
        [{ expectedSealedRound: roundNumber - 1, attemptedRound: roundNumber }],
      );
    }

    const sealedScope = customScopes ?? ROUND_SCOPES[roundNumber as keyof typeof ROUND_SCOPES] ?? [];
    const statePayloadHash = computeSha256(statePayload);
    const sealedAt = new Date().toISOString();

    const manifestSignature = computeManifestSignature({
      sessionId,
      roundNumber,
      roundName,
      sealedScope,
      statePayloadHash,
      challengeSummary,
      sealedAt,
    });

    const manifest: ImmutabilityManifest = {
      manifestId: `manifest-r${roundNumber}-${computeSha256({ sessionId, roundNumber, sealedAt }).slice(0, 12)}`,
      sessionId,
      roundNumber,
      roundName,
      sealedScope,
      statePayloadHash,
      statePayloadSnapshot: JSON.parse(JSON.stringify(statePayload)),
      challengeSummary: { ...challengeSummary },
      sealedAt,
      manifestSignature,
      lockStatus: "SEALED",
      unlockHistory: [],
    };

    this.manifests.set(roundNumber, manifest);
    if (roundNumber > this.highestSealedRound) {
      this.highestSealedRound = roundNumber;
    }

    return manifest;
  }

  /**
   * Retrieves the immutability manifest for a given round
   */
  public getManifest(roundNumber: number): ImmutabilityManifest | undefined {
    return this.manifests.get(roundNumber);
  }

  /**
   * Lists all sealed manifests in ascending round order
   */
  public listManifests(): readonly ImmutabilityManifest[] {
    return Array.from(this.manifests.values()).sort((a, b) => a.roundNumber - b.roundNumber);
  }

  /**
   * Anti-Moving-Goalpost Invariant Assertion:
   * Asserts that a target scope is mutable in the current round context.
   * If the scope belongs to a previously sealed round (K < currentRound), mutation is prohibited
   * unless accompanied by a valid, active OpticalRegressionUnlockToken targeting that round and scope.
   */
  public assertScopeMutable(request: ScopeMutationRequest): void {
    const { scope, currentRound, token } = request;

    // Determine if the scope belongs to an upstream sealed round
    for (const [sealedRoundNum, manifest] of this.manifests.entries()) {
      // Upstream sealed round check
      if (sealedRoundNum < currentRound && manifest.lockStatus !== "SUPERSEDED") {
        const isScopeSealedInRound = manifest.sealedScope.some(
          (sealedPrefix) => scope === sealedPrefix || scope.startsWith(`${sealedPrefix}.`) || sealedPrefix.startsWith(`${scope}.`),
        );

        if (isScopeSealedInRound) {
          // Scope is sealed upstream. Verify if an active valid token unblocks it.
          if (!token) {
            throw new HarnessError(
              "INVALID_STATE",
              `Anti-Moving-Goalpost Invariant Violation: Scope '${scope}' was sealed in Round ${sealedRoundNum} ("${manifest.roundName}") and cannot be modified in Round ${currentRound} without an Optical Regression Exception token.`,
              [{ scope, sealedRound: sealedRoundNum, currentRound, status: manifest.lockStatus }],
            );
          }

          this.validateUnlockToken(token, sealedRoundNum, scope);
        }
      }
    }
  }

  /**
   * Validates that an unlock token is active, unexpired, unconsumed, and covers the target round and scope.
   */
  public validateUnlockToken(
    token: OpticalRegressionUnlockToken,
    expectedRound: number,
    targetScope?: string,
  ): void {
    const storedToken = this.issuedTokens.get(token.tokenId);
    if (!storedToken) {
      throw new HarnessError(
        "PERMISSION_DENIED",
        `Invalid Optical Regression Unlock Token '${token.tokenId}': Token does not exist in registry.`,
      );
    }

    if (storedToken.isConsumed) {
      throw new HarnessError(
        "INVALID_STATE",
        `Optical Regression Unlock Token '${token.tokenId}' has already been consumed and cannot be reused.`,
      );
    }

    const now = new Date().getTime();
    const expiresAtMs = new Date(storedToken.expiresAt).getTime();
    if (now > expiresAtMs) {
      throw new HarnessError(
        "INVALID_STATE",
        `Optical Regression Unlock Token '${token.tokenId}' has expired at ${storedToken.expiresAt}.`,
      );
    }

    if (storedToken.targetRound !== expectedRound) {
      throw new HarnessError(
        "PERMISSION_DENIED",
        `Optical Regression Unlock Token target mismatch: token targets Round ${storedToken.targetRound}, but attempted operation targets Round ${expectedRound}.`,
      );
    }

    if (targetScope) {
      const isScopeCovered = storedToken.approvedScope.some(
        (approved) => targetScope === approved || targetScope.startsWith(`${approved}.`) || approved.startsWith(`${targetScope}.`),
      );
      if (!isScopeCovered) {
        throw new HarnessError(
          "PERMISSION_DENIED",
          `Optical Regression Unlock Token does not grant permission for scope '${targetScope}'. Approved scopes: [${storedToken.approvedScope.join(", ")}].`,
        );
      }
    }
  }

  /**
   * Optical Regression Exception Protocol:
   * Evaluates empirical proof and issues a single-use Optical Regression Unlock Token.
   */

  public requestOpticalRegressionUnlock(
    proof: EmpiricalRegressionProof,
    options?: { expirationMs?: number; compensationCredit?: number },
  ): OpticalRegressionUnlockToken {
    return requestOpticalRegressionUnlock.call(this, proof, options);
  }

  public verifyRegressionProof(proof: EmpiricalRegressionProof): void {
    verifyRegressionProof(proof);
  }

  public resealMilestone(
    roundNumber: number,
    updatedStatePayload: Record<string, unknown>,
    token: OpticalRegressionUnlockToken,
  ): ImmutabilityManifest {
    return resealMilestone.call(this, roundNumber, updatedStatePayload, token);
  }

  public verifyManifestIntegrity(
    manifest: ImmutabilityManifest,
    currentStatePayload?: Record<string, unknown>,
  ): ManifestIntegrityResult {
    return verifyManifestIntegrity.call(this, manifest, currentStatePayload);
  }

  public verifyAllMilestoneLocks(): LockSystemIntegrityReport {
    return verifyAllMilestoneLocks.call(this);
  }

  public assertIntegrity(): void {
    assertIntegrity.call(this);
  }

  public reset(): void {
    this.manifests.clear();
    this.issuedTokens.clear();
    this.unlockHistory.length = 0;
    this.highestSealedRound = 0;
  }
}

/**
 * ============================================================================
 * 4. Engine Singletons and Factory Functions
 * ============================================================================
 */

let defaultMilestoneLockEngine: MilestoneLockEngine | null = null;

export function getDefaultMilestoneLockEngine(): MilestoneLockEngine {
  if (!defaultMilestoneLockEngine) {
    defaultMilestoneLockEngine = new MilestoneLockEngine();
  }
  return defaultMilestoneLockEngine;
}

export function setDefaultMilestoneLockEngine(engine: MilestoneLockEngine): void {
  defaultMilestoneLockEngine = engine;
}

export function resetDefaultMilestoneLockEngine(): void {
  if (defaultMilestoneLockEngine) {
    defaultMilestoneLockEngine.reset();
  }
  defaultMilestoneLockEngine = null;
}

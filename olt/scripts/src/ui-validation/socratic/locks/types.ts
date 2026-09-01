import { createHmac, randomBytes } from "node:crypto";
import { HarnessError, type JsonValue } from "../../../core/index.ts";

/**
 * ============================================================================
 * 1. Milestone Locks & Immutability Manifest Framework Constants & Types
 * ============================================================================
 */

export type MilestoneLockStatus = "SEALED" | "TEMPORARILY_UNLOCKED" | "RESEALED" | "SUPERSEDED";

/**
 * Canonical Scope Mapping across the 5 Socratic Validation Rounds
 */
export const ROUND_SCOPES: Readonly<Record<1 | 2 | 3 | 4 | 5, readonly string[]>> = {
  1: [
    "layout.grid",
    "layout.landmarks",
    "layout.containers",
    "layout.spatial-hierarchy",
    "layout.macro-structure",
    "layout.wireframe",
  ],
  2: [
    "typography.scale",
    "typography.line-height",
    "typography.density",
    "typography.rhythm",
    "typography.families",
    "typography.weights",
  ],
  3: [
    "color.tokens",
    "color.contrast",
    "color.elevation-surfaces",
    "color.borders",
    "color.dark-light-modes",
    "color.palettes",
  ],
  4: [
    "motion.transitions",
    "motion.micro-interactions",
    "motion.focus-rings",
    "motion.interactive-states",
    "motion.semantics",
    "motion.springs",
  ],
  5: [
    "optical.anti-aliasing",
    "optical.cross-permutation",
    "optical.subpixel-alignment",
    "optical.final-synthesis",
    "optical.signoff",
  ],
} as const;

/**
 * Default Unlock Token Expiration: 5 minutes (in milliseconds)
 */
export const DEFAULT_UNLOCK_TOKEN_EXPIRATION_MS = 5 * 60 * 1000;

/**
 * Minimum characters required for empirical proof root-cause analysis
 */
export const MIN_ROOT_CAUSE_ANALYSIS_LENGTH = 25;

/**
 * Unlock Record tracking an Optical Regression Exception event
 */
export interface UnlockRecord {
  readonly recordId: string;
  readonly tokenId: string;
  readonly proofId: string;
  readonly targetRound: number;
  readonly unlockedAt: string;
  readonly resealedAt?: string;
  readonly reason: string;
  readonly compensationCreditGranted: number;
  readonly modifiedScope: readonly string[];
}

/**
 * Immutability Manifest locking the state of a validated round milestone
 */
export interface ImmutabilityManifest {
  readonly manifestId: string;
  readonly sessionId: string;
  readonly roundNumber: number;
  readonly roundName: string;
  readonly sealedScope: readonly string[];
  readonly statePayloadHash: string;
  readonly statePayloadSnapshot: Record<string, unknown>;
  readonly challengeSummary: {
    readonly total: number;
    readonly defended: number;
    readonly arbitrated: number;
  };
  readonly sealedAt: string;
  readonly manifestSignature: string;
  readonly lockStatus: MilestoneLockStatus;
  readonly unlockHistory: readonly UnlockRecord[];
}

/**
 * Input for sealing a completed milestone
 */
export interface SealMilestoneInput {
  readonly sessionId: string;
  readonly roundNumber: number;
  readonly roundName: string;
  readonly statePayload: Record<string, unknown>;
  readonly challengeSummary: {
    readonly total: number;
    readonly defended: number;
    readonly arbitrated: number;
  };
  readonly customScopes?: readonly string[];
}

/**
 * Empirical proof submitted to request an Optical Regression Exception
 */
export interface EmpiricalRegressionProof {
  readonly proofId: string;
  readonly sessionId: string;
  readonly targetSealedRound: number;
  readonly currentActiveRound: number;
  readonly affectedScope: string;
  readonly rootCauseAnalysis: string;
  readonly opticalDeltaMetric: number;
  readonly evidenceArtifactHash: string;
  readonly proposedRemediation: string;
  readonly timestamp?: string;
}

/**
 * Single-use token issued upon approval of an Optical Regression Exception
 */
export interface OpticalRegressionUnlockToken {
  readonly tokenId: string;
  readonly proofId: string;
  readonly sessionId: string;
  readonly targetRound: number;
  readonly approvedScope: readonly string[];
  readonly compensationCredit: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly isConsumed: boolean;
}

/**
 * Integrity check result for an immutability manifest
 */
export interface ManifestIntegrityResult {
  readonly manifestId: string;
  readonly roundNumber: number;
  readonly isValid: boolean;
  readonly signatureMatches: boolean;
  readonly stateHashMatches: boolean;
  readonly tamperingDetected: boolean;
  readonly discrepancyReason?: string;
}

/**
 * Global report on all milestone locks
 */
export interface LockSystemIntegrityReport {
  readonly sessionId: string;
  readonly totalSealedMilestones: number;
  readonly isAllValid: boolean;
  readonly tamperedRounds: readonly number[];
  readonly manifestResults: readonly ManifestIntegrityResult[];
  readonly checkedAt: string;
}

/**
 * Request to mutate a specific scope
 */
export interface ScopeMutationRequest {
  readonly scope: string;
  readonly currentRound: number;
  readonly token?: OpticalRegressionUnlockToken;
  readonly operationDescription?: string;
}

/**
 * ============================================================================
 * 2. Deterministic Canonical Hashing & Serialization Utilities
 * ============================================================================
 */

/**
 * Recursively sort object keys for deterministic JSON serialization
 */

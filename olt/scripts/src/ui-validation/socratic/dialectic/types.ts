import { createHash } from "node:crypto";
import { HarnessError, type JsonValue } from "../../../core/index.ts";
import {
  type ImmutabilityManifest,
  type LockSystemIntegrityReport,
  MilestoneLockEngine,
  ROUND_SCOPES,
  computeSha256,
  getDefaultMilestoneLockEngine,
} from "../locks/index.ts";

/**
 * ============================================================================
 * 1. Socratic Dialectic Constants, Types & 5-Round Definitions
 * ============================================================================
 */

import type { SocraticRoundNumber } from "./challenge-types.ts";
export type { SocraticRoundNumber };

export type SocraticRoundId =
  | "MACRO_LAYOUT"
  | "TYPOGRAPHY_AND_RHYTHM"
  | "COLOR_AND_SURFACES"
  | "MOTION_AND_INTERACTION"
  | "OPTICAL_POLISH_AND_CONVERGENCE";

export interface SocraticRoundDefinition {
  readonly roundNumber: SocraticRoundNumber;
  readonly id: SocraticRoundId;
  readonly name: string;
  readonly description: string;
  readonly targetScopes: readonly string[];
  readonly minChallengeQuota: number;
  readonly maxConvergenceCycles: number;
}

export const MANDATORY_CHALLENGE_QUOTA_R1_R4 = 2;
export const MAX_CONVERGENCE_CYCLES_PER_GATE = 4;
export const MIN_SUBSTANTIVE_DEFENSE_LENGTH = 20;

export const SOCRATIC_ROUNDS: readonly [
  SocraticRoundDefinition,
  SocraticRoundDefinition,
  SocraticRoundDefinition,
  SocraticRoundDefinition,
  SocraticRoundDefinition,
] = [
  {
    roundNumber: 1,
    id: "MACRO_LAYOUT",
    name: "Macro-Layout & Structural Hierarchy",
    description:
      "Validates spatial grid, structural hierarchy, semantic landmarks, responsive reflow, and container stability.",
    targetScopes: ROUND_SCOPES[1],
    minChallengeQuota: MANDATORY_CHALLENGE_QUOTA_R1_R4,
    maxConvergenceCycles: MAX_CONVERGENCE_CYCLES_PER_GATE,
  },
  {
    roundNumber: 2,
    id: "TYPOGRAPHY_AND_RHYTHM",
    name: "Typography, Content Density & Visual Rhythm",
    description:
      "Validates typographic scale, line-height proportions, vertical rhythm, font family consistency, and reading density.",
    targetScopes: ROUND_SCOPES[2],
    minChallengeQuota: MANDATORY_CHALLENGE_QUOTA_R1_R4,
    maxConvergenceCycles: MAX_CONVERGENCE_CYCLES_PER_GATE,
  },
  {
    roundNumber: 3,
    id: "COLOR_AND_SURFACES",
    name: "Color, Surface Elevation & Thematic Consistency",
    description:
      "Validates color token compliance, APCA/WCAG contrast ratios, dark/light elevation tiers, surface borders, and theme fidelity.",
    targetScopes: ROUND_SCOPES[3],
    minChallengeQuota: MANDATORY_CHALLENGE_QUOTA_R1_R4,
    maxConvergenceCycles: MAX_CONVERGENCE_CYCLES_PER_GATE,
  },
  {
    roundNumber: 4,
    id: "MOTION_AND_INTERACTION",
    name: "Motion, Interactive States & Component Semantics",
    description:
      "Validates micro-interactions, focus rings, hover lifts, spring physics, frame-budget compliance, and interactive feedback.",
    targetScopes: ROUND_SCOPES[4],
    minChallengeQuota: MANDATORY_CHALLENGE_QUOTA_R1_R4,
    maxConvergenceCycles: MAX_CONVERGENCE_CYCLES_PER_GATE,
  },
  {
    roundNumber: 5,
    id: "OPTICAL_POLISH_AND_CONVERGENCE",
    name: "Optical Polish, Cross-Permutation Convergence & Final Sign-Off",
    description:
      "Validates subpixel alignment, anti-aliasing purity, cross-permutation matrix zero-defect state, and holistic visual synthesis.",
    targetScopes: ROUND_SCOPES[5],
    minChallengeQuota: 0,
    maxConvergenceCycles: MAX_CONVERGENCE_CYCLES_PER_GATE,
  },
] as const;

export const SOCRATIC_ROUND_MAP: Readonly<Record<SocraticRoundNumber, SocraticRoundDefinition>> = {
  1: SOCRATIC_ROUNDS[0],
  2: SOCRATIC_ROUNDS[1],
  3: SOCRATIC_ROUNDS[2],
  4: SOCRATIC_ROUNDS[3],
  5: SOCRATIC_ROUNDS[4],
};

/**
 * Common boilerplate or evasive phrases that fail substantive defense checks
 */
export const TRIVIAL_DEFENSE_PATTERNS: readonly RegExp[] = [
  /^lgtm$/i,
  /^looks\s+good(\s+to\s+me)?$/i,
  /^fixed(\s+it)?$/i,
  /^done$/i,
  /^ok$/i,
  /^fine$/i,
  /^resolved$/i,
  /^no\s+issue$/i,
  /^no\s+change\s+needed$/i,
  /^as\s+expected$/i,
  /^working\s+fine$/i,
  /^it\s+works$/i,
];

/**
 * ============================================================================
 * 2. Cognitive Challenge & Defense Data Structures
 * ============================================================================
 */

export type {
  CognitiveChallengeSeverity,
  CognitiveChallengeStatus,
  DefenseRecord,
  CognitiveChallenge,
  CreateChallengeInput,
  DefenseSubmission,
  DefenseEvaluationResult,
  CollateralDefect,
  InterRoundAuditResult,
  CompetingForce,
  CandidateResolution,
  ParetoArbitrationInput,
  ParetoArbitrationDecision,
  RoundGateEvaluation,
  RoundAdvanceResult,
  SocraticSessionSummary,
  DialecticSessionOptions,
} from "./challenge-types.ts";

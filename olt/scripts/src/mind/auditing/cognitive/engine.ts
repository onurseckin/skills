import { auditMindPulseHelper } from "./pulse-auditor.ts";
import {
  auditRepositoryGovernanceHelper,
  type GovernanceAuditResult,
} from "./governance-auditor.ts";
import {
  resolveActivePulse,
  resolveActiveMindGrant,
  resolveLatestCapsule,
  resolveLatestPulseTimestamp,
} from "./capsule-resolver.ts";
import type { AuditorCursor, MindAuditLiveResult } from "./types.ts";

import {
  generateCognitiveChallengePrompt,
  generateZeroDeltaChallengePrompt,
  CognitiveChallengePromptGenerator,
  type CognitiveChallenge,
  type CognitiveChallengeOptions,
  type ZeroDeltaChallengeOptions,
} from "./challenge-generator.ts";

export class MindAuditorEngine {
  public static resolveActivePulse = resolveActivePulse;
  public static resolveActiveMindGrant = resolveActiveMindGrant;
  public static resolveLatestCapsule = resolveLatestCapsule;
  public static resolveLatestPulseTimestamp = resolveLatestPulseTimestamp;
  public static generateCognitiveChallengePrompt = generateCognitiveChallengePrompt;
  public static generateZeroDeltaChallengePrompt = generateZeroDeltaChallengePrompt;
  public static generateCognitiveChallenge = CognitiveChallengePromptGenerator.generateCognitiveChallenge;

  public static auditRepositoryGovernance(
    repoRoot: string,
    capsuleRunRoot?: string,
  ): GovernanceAuditResult {
    return auditRepositoryGovernanceHelper(
      repoRoot,
      capsuleRunRoot,
      resolveLatestCapsule,
      resolveActiveMindGrant,
      resolveLatestPulseTimestamp,
    );
  }

  public static auditMindPulse(
    repoRoot: string,
    options?: {
      cursor?: AuditorCursor | undefined;
      stagnationThresholdSeconds?: number | undefined;
      conversationId?: string | undefined;
      now?: string | undefined;
      capsuleRunRoot?: string | undefined;
    },
  ): MindAuditLiveResult {
    return auditMindPulseHelper(repoRoot, options);
  }

  public static verifyEvidenceReceipts(
    receipts: Record<string, unknown> | undefined,
    commandIds: readonly string[],
  ): {
    readonly valid: boolean;
    readonly unprovenClaims: readonly string[];
  } {
    const unprovenClaims: string[] = [];
    const available = receipts !== undefined ? receipts : {};

    for (const cmdId of commandIds) {
      const receipt = (available as Record<string, unknown>)[cmdId];
      if (!receipt || typeof receipt !== "object") {
        unprovenClaims.push(cmdId);
        continue;
      }
      const rec = receipt as Record<string, unknown>;
      if (rec["exit_code"] !== 0 || rec["status"] !== "succeeded") {
        unprovenClaims.push(cmdId);
      }
    }

    return {
      valid: unprovenClaims.length === 0,
      unprovenClaims,
    };
  }
}

import {
  ORDER_OF_MAGNITUDE_REOPEN_THRESHOLD,
  SETTLED_INVARIANT_STATUSES,
  type AntiPatternRecord,
  type CommitInvariantInput,
  type ReopenChallengeInput,
  type ReopenChallengeResult,
  type SettledInvariant,
  type SettledInvariantHistoryEntry,
  type SettledInvariantStore,
} from "./types.ts";

/**
 * Repository for Tier 1 Bedrock Invariants and Anti-Patterns.
 *
 * Enforces the inviolability of settled decisions:
 * Settled Invariants can NEVER be casually reopened or relitigated.
 * Reopening requires an empirical order-of-magnitude delta (>= 10x or 1000% improvement).
 */
export class SettledInvariantRepository {
  private readonly invariants = new Map<string, SettledInvariant>();
  private readonly antiPatterns = new Map<string, AntiPatternRecord>();

  public constructor(initialStore?: SettledInvariantStore) {
    if (initialStore) {
      this.loadState(initialStore);
    }
  }

  private static seq = 0;

  /**
   * Commits a winning approach from an empirical crucible or arbitration as a Tier 1 Bedrock Invariant.
   */
  public commitInvariant(input: CommitInvariantInput): SettledInvariant {
    const now = new Date().toISOString();
    SettledInvariantRepository.seq += 1;
    const invariantId =
      input.invariantId ??
      `bedrock-${input.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}-${SettledInvariantRepository.seq}`;

    // Enforce >= 10.0x reopen threshold (order-of-magnitude invariant protection)
    const reopenThreshold = Math.max(
      ORDER_OF_MAGNITUDE_REOPEN_THRESHOLD,
      input.reopenThreshold ?? ORDER_OF_MAGNITUDE_REOPEN_THRESHOLD,
    );

    const initialHistoryEntry: SettledInvariantHistoryEntry = {
      timestamp: now,
      action: "COMMITTED",
      reason: `Settled via Pareto Arbitration: ${input.arbitrationSummary}`,
      ...(input.spikeId !== undefined ? { details: { spikeId: input.spikeId } } : {}),
    };

    const invariant: SettledInvariant = {
      invariantId,
      topic: input.topic,
      title: input.title,
      ...(input.description !== undefined ? { description: input.description } : {}),
      winningApproach: input.winningApproach,
      paretoPriorityLevel: input.paretoPriorityLevel,
      arbitrationSummary: input.arbitrationSummary,
      timestamp: now,
      reopenThreshold,
      status: SETTLED_INVARIANT_STATUSES.ACTIVE,
      ...(input.spikeId !== undefined ? { spikeId: input.spikeId } : {}),
      ...(input.candidateApproachesEvaluated !== undefined
        ? { candidateApproachesEvaluated: [...input.candidateApproachesEvaluated] }
        : {}),
      ...(input.empiricalEvidence !== undefined
        ? { empiricalEvidence: { ...input.empiricalEvidence } }
        : {}),
      ...(input.antiPatterns !== undefined ? { antiPatterns: [...input.antiPatterns] } : {}),
      history: [initialHistoryEntry],
      ...(input.metadata !== undefined ? { metadata: { ...input.metadata } } : {}),
    };

    this.invariants.set(invariantId, invariant);
    return invariant;
  }

  /**
   * Evaluates a challenge to reopen a Settled Bedrock Invariant.
   * Rejects challenge unless the challenger provides an order-of-magnitude (>= 10.0x) empirical delta.
   */
  public challengeSettledInvariant(
    invariantId: string,
    challenge: ReopenChallengeInput,
  ): ReopenChallengeResult {
    const invariant = this.invariants.get(invariantId);
    const now = new Date().toISOString();

    if (!invariant) {
      return {
        accepted: false,
        invariantId,
        empiricalDeltaRatio: challenge.empiricalPerformanceDeltaRatio,
        requiredThresholdRatio: ORDER_OF_MAGNITUDE_REOPEN_THRESHOLD,
        reason: `Bedrock Invariant "${invariantId}" does not exist.`,
      };
    }

    if (invariant.status === "SUPERSEDED" || invariant.status === "DEPRECATED") {
      return {
        accepted: false,
        invariantId,
        empiricalDeltaRatio: challenge.empiricalPerformanceDeltaRatio,
        requiredThresholdRatio: invariant.reopenThreshold,
        reason: `Bedrock Invariant "${invariantId}" is already ${invariant.status} and cannot be challenged directly.`,
      };
    }

    const threshold = invariant.reopenThreshold;
    const deltaRatio = challenge.empiricalPerformanceDeltaRatio;

    if (deltaRatio < threshold) {
      // Reject challenge: insufficient empirical delta
      const rejectReason = `Challenge rejected: Order-of-magnitude empirical delta (>= ${threshold.toFixed(1)}x / ${(threshold * 100).toFixed(0)}%) is required to reopen settled bedrock invariant, but received ${deltaRatio.toFixed(2)}x (${(deltaRatio * 100).toFixed(0)}%). Claim: "${challenge.falsifiableClaim}". Marginal or speculative claims cannot reopen settled bedrock invariants.`;

      const rejectHistory: SettledInvariantHistoryEntry = {
        timestamp: now,
        action: "CHALLENGE_REJECTED",
        reason: rejectReason,
        challengerId: challenge.challengerId,
        empiricalDeltaRatio: deltaRatio,
        details: {
          proposedApproach: challenge.proposedApproach,
          falsifiableClaim: challenge.falsifiableClaim,
          benchmarkData: challenge.benchmarkData,
        },
      };

      const updatedInvariant: SettledInvariant = {
        ...invariant,
        history: [...invariant.history, rejectHistory],
      };
      this.invariants.set(invariantId, updatedInvariant);

      return {
        accepted: false,
        invariantId,
        empiricalDeltaRatio: deltaRatio,
        requiredThresholdRatio: threshold,
        reason: rejectReason,
      };
    }

    // Accept challenge: order-of-magnitude delta achieved
    const acceptReason = `Challenge accepted: Order-of-magnitude empirical delta (${deltaRatio.toFixed(2)}x >= ${threshold.toFixed(1)}x) satisfied by challenger "${challenge.challengerId}". Proposed approach: "${challenge.proposedApproach}". Invariant unlocked for empirical crucible reconsideration.`;

    const acceptHistory: SettledInvariantHistoryEntry = {
      timestamp: now,
      action: "CHALLENGE_ACCEPTED",
      reason: acceptReason,
      challengerId: challenge.challengerId,
      empiricalDeltaRatio: deltaRatio,
      details: {
        proposedApproach: challenge.proposedApproach,
        falsifiableClaim: challenge.falsifiableClaim,
        benchmarkData: challenge.benchmarkData,
        functionalSuperiorityProof: challenge.functionalSuperiorityProof,
      },
    };

    const updatedInvariant: SettledInvariant = {
      ...invariant,
      status: SETTLED_INVARIANT_STATUSES.CHALLENGED,
      history: [...invariant.history, acceptHistory],
    };
    this.invariants.set(invariantId, updatedInvariant);

    return {
      accepted: true,
      invariantId,
      empiricalDeltaRatio: deltaRatio,
      requiredThresholdRatio: threshold,
      reason: acceptReason,
      reopenedAt: now,
      nextSteps: [
        `Execute time-boxed empirical crucible spike for "${challenge.proposedApproach}"`,
        "Run strict benchmark and correctness verification against existing bedrock invariant",
        "Perform Pre-Declared Pareto Arbitration to determine if incumbent is superseded",
      ],
    };
  }

  /**
   * Retrieves a settled invariant by its ID.
   */
  public getInvariant(invariantId: string): SettledInvariant | undefined {
    return this.invariants.get(invariantId);
  }

  /**
   * Retrieves all settled invariants for a specific topic.
   */
  public getInvariantsByTopic(topic: string): readonly SettledInvariant[] {
    const results: SettledInvariant[] = [];
    for (const inv of this.invariants.values()) {
      if (inv.topic.toLowerCase() === topic.toLowerCase()) {
        results.push(inv);
      }
    }
    return results;
  }

  /**
   * Retrieves the currently active invariant for a specific topic.
   */
  public getActiveInvariantForTopic(topic: string): SettledInvariant | undefined {
    for (const inv of this.invariants.values()) {
      if (
        inv.topic.toLowerCase() === topic.toLowerCase() &&
        inv.status === SETTLED_INVARIANT_STATUSES.ACTIVE
      ) {
        return inv;
      }
    }
    return undefined;
  }

  /**
   * Returns whether an invariant with the given ID exists.
   */
  public hasInvariant(invariantId: string): boolean {
    return this.invariants.has(invariantId);
  }

  /**
   * Returns whether an active invariant exists for a given topic.
   */
  public hasActiveInvariantForTopic(topic: string): boolean {
    return this.getActiveInvariantForTopic(topic) !== undefined;
  }

  /**
   * Retrieves all settled invariants in the repository.
   */
  public getAllInvariants(): readonly SettledInvariant[] {
    return Array.from(this.invariants.values());
  }

  /**
   * Supersedes an old invariant with a newly proven invariant.
   */
  public supersedeInvariant(
    oldInvariantId: string,
    newInvariantId: string,
    reason: string,
  ): boolean {
    const oldInv = this.invariants.get(oldInvariantId);
    if (!oldInv) {
      return false;
    }

    const now = new Date().toISOString();
    const supersedeHistory: SettledInvariantHistoryEntry = {
      timestamp: now,
      action: "SUPERSEDED",
      reason: `Superseded by "${newInvariantId}": ${reason}`,
      details: { supersededBy: newInvariantId },
    };

    const updated: SettledInvariant = {
      ...oldInv,
      status: SETTLED_INVARIANT_STATUSES.SUPERSEDED,
      history: [...oldInv.history, supersedeHistory],
    };

    this.invariants.set(oldInvariantId, updated);
    return true;
  }

  /**
   * Records an identified anti-pattern to prevent recurring bad approaches.
   */
  public recordAntiPattern(antiPattern: AntiPatternRecord): void {
    this.antiPatterns.set(antiPattern.id, antiPattern);
  }

  /**
   * Retrieves anti-patterns, optionally filtered by topic.
   */
  public getAntiPatterns(topic?: string): readonly AntiPatternRecord[] {
    if (!topic) {
      return Array.from(this.antiPatterns.values());
    }
    const filtered: AntiPatternRecord[] = [];
    for (const ap of this.antiPatterns.values()) {
      if (ap.topic.toLowerCase() === topic.toLowerCase()) {
        filtered.push(ap);
      }
    }
    return filtered;
  }

  /**
   * Exports repository state for persistence or serialization.
   */
  public exportState(): SettledInvariantStore {
    return {
      version: 1,
      invariants: Array.from(this.invariants.values()),
      antiPatterns: Array.from(this.antiPatterns.values()),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Loads repository state from a serialized store.
   */
  public loadState(store: SettledInvariantStore): void {
    this.invariants.clear();
    this.antiPatterns.clear();

    for (const inv of store.invariants) {
      this.invariants.set(inv.invariantId, inv);
    }
    for (const ap of store.antiPatterns) {
      this.antiPatterns.set(ap.id, ap);
    }
  }

  /**
   * Clears all invariants and anti-patterns (useful for testing).
   */
  public clear(): void {
    this.invariants.clear();
    this.antiPatterns.clear();
  }
}

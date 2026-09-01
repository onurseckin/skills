import {
  arbitrateMultipleApproaches,
  type ParetoApproachCandidate,
  type ParetoArbitrationOptions,
  type ParetoArbitrationResult,
} from "../planning/index.ts";
import { SettledInvariantRepository } from "./bedrock-commitment.ts";
import {
  DEFAULT_SPIKE_TIMEBOX_MS,
  PROTOTYPE_SPIKE_STATUSES,
  type AntiPatternRecord,
  type FalsifiableHypothesis,
  type PrototypeSpikeConfig,
  type PrototypeSpikeResult,
  type PrototypeSpikeStatus,
  type SettledInvariant,
} from "./types.ts";

export interface FinalizeSpikeOptions {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly commitAsInvariant?: boolean | undefined;
  readonly reopenThreshold?: number | undefined;
}

export interface SpikeFilterOptions {
  readonly status?: PrototypeSpikeStatus | undefined;
  readonly topic?: string | undefined;
}

/**
 * Empirical Crucible Protocol Engine
 *
 * Coordinates time-boxed prototype spikes, hypothesis validation,
 * empirical data recording, Pareto arbitration, and bedrock invariant commitment.
 */
export class EmpiricalCrucibleEngine {
  private readonly repository: SettledInvariantRepository;
  private readonly spikes = new Map<string, PrototypeSpikeResult>();

  public constructor(repository?: SettledInvariantRepository) {
    this.repository = repository ?? new SettledInvariantRepository();
  }

  /**
   * Returns the underlying Settled Bedrock Invariant repository.
   */
  public getRepository(): SettledInvariantRepository {
    return this.repository;
  }

  /**
   * Initiates a time-boxed prototype spike with a falsifiable hypothesis and sandbox scope.
   */
  public createSpike(config: PrototypeSpikeConfig): PrototypeSpikeResult {
    const now = new Date().toISOString();
    const sandboxScope = Array.isArray(config.sandboxScope)
      ? [...config.sandboxScope]
      : [config.sandboxScope];

    const timeBoxDurationMs =
      config.timeBoxDurationMs ??
      (config.timeBoxMinutes !== undefined
        ? config.timeBoxMinutes * 60 * 1000
        : DEFAULT_SPIKE_TIMEBOX_MS);

    const initialCandidates = config.candidateApproaches ? [...config.candidateApproaches] : [];

    const spike: PrototypeSpikeResult = {
      spikeId: config.spikeId,
      title: config.title,
      topic: config.topic,
      status: PROTOTYPE_SPIKE_STATUSES.IN_SPIKE,
      hypothesis: { ...config.hypothesis },
      sandboxScope,
      timeBoxDurationMs,
      startedAt: config.createdAt ?? now,
      candidateResults: initialCandidates,
      ...(config.metadata !== undefined ? { empiricalData: { ...config.metadata } } : {}),
    };

    this.spikes.set(config.spikeId, spike);
    return spike;
  }

  /**
   * Appends or updates candidate approaches and empirical findings for an active spike.
   */
  public recordSpikeData(
    spikeId: string,
    data: {
      readonly candidateResults?: readonly ParetoApproachCandidate[] | undefined;
      readonly empiricalData?: Readonly<Record<string, unknown>> | undefined;
      readonly artifacts?: readonly string[] | undefined;
      readonly antiPatterns?: readonly AntiPatternRecord[] | undefined;
    },
  ): PrototypeSpikeResult {
    const existing = this.spikes.get(spikeId);
    if (!existing) {
      throw new Error(`Prototype spike "${spikeId}" not found.`);
    }

    if (
      existing.status === PROTOTYPE_SPIKE_STATUSES.SETTLED ||
      existing.status === PROTOTYPE_SPIKE_STATUSES.CANCELLED
    ) {
      throw new Error(
        `Cannot record data to spike "${spikeId}" in terminal status "${existing.status}".`,
      );
    }

    const mergedCandidates = [...existing.candidateResults, ...(data.candidateResults ?? [])];

    // Deduplicate candidate approaches by name
    const uniqueCandidatesMap = new Map<string, ParetoApproachCandidate>();
    for (const c of mergedCandidates) {
      uniqueCandidatesMap.set(c.name, c);
    }
    const uniqueCandidates = Array.from(uniqueCandidatesMap.values());

    const updated: PrototypeSpikeResult = {
      ...existing,
      candidateResults: uniqueCandidates,
      empiricalData: {
        ...(existing.empiricalData ?? {}),
        ...(data.empiricalData ?? {}),
      },
      ...(data.artifacts !== undefined
        ? { artifacts: [...(existing.artifacts ?? []), ...data.artifacts] }
        : existing.artifacts !== undefined
          ? { artifacts: existing.artifacts }
          : {}),
      ...(data.antiPatterns !== undefined
        ? {
            antiPatternsIdentified: [
              ...(existing.antiPatternsIdentified ?? []),
              ...data.antiPatterns,
            ],
          }
        : existing.antiPatternsIdentified !== undefined
          ? { antiPatternsIdentified: existing.antiPatternsIdentified }
          : {}),
    };

    this.spikes.set(spikeId, updated);
    return updated;
  }

  /**
   * Executes Pre-Declared Pareto Arbitration over candidate approaches for the spike
   * and verifies if the falsifiable hypothesis is validated or falsified.
   */
  public evaluateSpike(
    spikeId: string,
    candidateApproaches?: readonly ParetoApproachCandidate[],
    options?: ParetoArbitrationOptions,
  ): PrototypeSpikeResult {
    const existing = this.spikes.get(spikeId);
    if (!existing) {
      throw new Error(`Prototype spike "${spikeId}" not found.`);
    }

    if (
      existing.status === PROTOTYPE_SPIKE_STATUSES.SETTLED ||
      existing.status === PROTOTYPE_SPIKE_STATUSES.CANCELLED
    ) {
      throw new Error(
        `Cannot evaluate spike "${spikeId}" in terminal status "${existing.status}".`,
      );
    }

    const candidatesToEvaluate =
      candidateApproaches && candidateApproaches.length > 0
        ? candidateApproaches
        : existing.candidateResults;

    if (candidatesToEvaluate.length === 0) {
      throw new Error(
        `Cannot evaluate spike "${spikeId}": no candidate approaches provided or recorded.`,
      );
    }

    // Execute Pareto Arbitration
    const arbitrationResult: ParetoArbitrationResult = arbitrateMultipleApproaches(
      candidatesToEvaluate,
      undefined,
      options,
    );

    const winningCandidate = arbitrationResult.winningCandidate;

    // Validate hypothesis
    const { validated, summary } = this.evaluateHypothesis(
      existing.hypothesis,
      winningCandidate,
      arbitrationResult,
    );

    // Identify anti-patterns from disqualified candidates
    const autoAntiPatterns: AntiPatternRecord[] = [];
    const now = new Date().toISOString();

    for (const disq of arbitrationResult.disqualifiedCandidates) {
      autoAntiPatterns.push({
        id: `anti-${spikeId}-${disq.candidateName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: `Disqualified Approach: ${disq.candidateName}`,
        topic: existing.topic,
        description: `Approach disqualified during Empirical Crucible spike "${spikeId}" on topic "${existing.topic}".`,
        rejectedApproach: disq.candidateName,
        rejectionReason: disq.reason,
        discoveredInSpikeId: spikeId,
        discoveredAt: now,
      });
    }

    const allAntiPatterns = [...(existing.antiPatternsIdentified ?? []), ...autoAntiPatterns];

    const evaluatedSpike: PrototypeSpikeResult = {
      ...existing,
      status: PROTOTYPE_SPIKE_STATUSES.EVALUATED,
      completedAt: now,
      candidateResults: candidatesToEvaluate,
      ...(winningCandidate !== undefined ? { winningCandidate } : {}),
      arbitrationResult,
      hypothesisValidated: validated,
      hypothesisValidationSummary: summary,
      ...(allAntiPatterns.length > 0 ? { antiPatternsIdentified: allAntiPatterns } : {}),
    };

    this.spikes.set(spikeId, evaluatedSpike);
    return evaluatedSpike;
  }

  /**
   * Finalizes an evaluated spike and commits the winning resolution as a Settled Bedrock Invariant.
   */
  public finalizeSpike(
    spikeId: string,
    options?: FinalizeSpikeOptions,
  ): SettledInvariant | undefined {
    const spike = this.spikes.get(spikeId);
    if (!spike) {
      throw new Error(`Prototype spike "${spikeId}" not found.`);
    }

    if (spike.status !== PROTOTYPE_SPIKE_STATUSES.EVALUATED) {
      throw new Error(
        `Cannot finalize spike "${spikeId}": spike must be evaluated before finalization (current status: "${spike.status}").`,
      );
    }

    if (
      !spike.arbitrationResult ||
      !spike.winningCandidate ||
      spike.arbitrationResult.winner === "NONE"
    ) {
      throw new Error(
        `Cannot finalize spike "${spikeId}": arbitration did not yield a valid winning candidate.`,
      );
    }

    let settledInvariant: SettledInvariant | undefined = undefined;

    if (options?.commitAsInvariant !== false) {
      // Record any anti-patterns identified in the spike into repository
      for (const antiPattern of spike.antiPatternsIdentified ?? []) {
        this.repository.recordAntiPattern(antiPattern);
      }

      // Commit invariant
      settledInvariant = this.repository.commitInvariant({
        topic: spike.topic,
        title: options?.title ?? spike.title,
        ...(options?.description !== undefined
          ? { description: options.description }
          : { description: spike.hypothesis.statement }),
        winningApproach: spike.winningCandidate.name,
        paretoPriorityLevel: spike.arbitrationResult.chosenPriorityLevel,
        arbitrationSummary: spike.arbitrationResult.reason,
        spikeId: spike.spikeId,
        candidateApproachesEvaluated: spike.candidateResults.map((c) => c.name),
        ...(options?.reopenThreshold !== undefined
          ? { reopenThreshold: options.reopenThreshold }
          : {}),
        ...(spike.empiricalData !== undefined ? { empiricalEvidence: spike.empiricalData } : {}),
        ...(spike.antiPatternsIdentified !== undefined
          ? { antiPatterns: spike.antiPatternsIdentified.map((a) => a.rejectedApproach) }
          : {}),
      });
    }

    const settledSpike: PrototypeSpikeResult = {
      ...spike,
      status: PROTOTYPE_SPIKE_STATUSES.SETTLED,
      ...(settledInvariant !== undefined
        ? { settledInvariantId: settledInvariant.invariantId }
        : {}),
    };

    this.spikes.set(spikeId, settledSpike);
    return settledInvariant;
  }

  /**
   * Cancels an ongoing spike with an explanation.
   */
  public cancelSpike(spikeId: string, reason: string): PrototypeSpikeResult {
    const existing = this.spikes.get(spikeId);
    if (!existing) {
      throw new Error(`Prototype spike "${spikeId}" not found.`);
    }

    const cancelled: PrototypeSpikeResult = {
      ...existing,
      status: PROTOTYPE_SPIKE_STATUSES.CANCELLED,
      completedAt: new Date().toISOString(),
      cancellationReason: reason,
    };

    this.spikes.set(spikeId, cancelled);
    return cancelled;
  }

  /**
   * Retrieves a spike by ID.
   */
  public getSpike(spikeId: string): PrototypeSpikeResult | undefined {
    return this.spikes.get(spikeId);
  }

  /**
   * Lists all prototype spikes, optionally filtered by status or topic.
   */
  public listSpikes(filter?: SpikeFilterOptions): readonly PrototypeSpikeResult[] {
    const all = Array.from(this.spikes.values());
    if (!filter) {
      return all;
    }

    return all.filter((s) => {
      if (filter.status && s.status !== filter.status) {
        return false;
      }
      if (filter.topic && s.topic.toLowerCase() !== filter.topic.toLowerCase()) {
        return false;
      }
      return true;
    });
  }

  /**
   * Retrieves all currently active (IN_SPIKE) spikes.
   */
  public getActiveSpikes(): readonly PrototypeSpikeResult[] {
    return this.listSpikes({ status: PROTOTYPE_SPIKE_STATUSES.IN_SPIKE });
  }

  /**
   * Evaluates if a winning candidate satisfies the falsifiable hypothesis.
   */
  private evaluateHypothesis(
    hypothesis: FalsifiableHypothesis,
    winningCandidate: ParetoApproachCandidate | undefined,
    arbitrationResult: ParetoArbitrationResult,
  ): { readonly validated: boolean; readonly summary: string } {
    if (!winningCandidate || arbitrationResult.winner === "NONE") {
      return {
        validated: false,
        summary: `Hypothesis falsified: No winning candidate survived Priority 1 Pareto arbitration. (${hypothesis.falsificationCriteria})`,
      };
    }

    const perfGain =
      winningCandidate.perfGainPercent ??
      winningCandidate.throughputGainPercent ??
      winningCandidate.latencyReductionPercent ??
      0;

    const threshold = hypothesis.thresholdDeltaPercent;

    if (hypothesis.expectedDirection === "increase") {
      if (perfGain >= threshold) {
        return {
          validated: true,
          summary: `Hypothesis validated: "${winningCandidate.name}" achieved ${perfGain}% delta, exceeding target threshold of >= ${threshold}%. Statement: "${hypothesis.statement}".`,
        };
      } else {
        return {
          validated: false,
          summary: `Hypothesis falsified: "${winningCandidate.name}" achieved ${perfGain}% delta, failing required threshold of >= ${threshold}%. (${hypothesis.falsificationCriteria})`,
        };
      }
    }

    if (hypothesis.expectedDirection === "decrease") {
      const reduction =
        winningCandidate.latencyReductionPercent ??
        winningCandidate.memoryReductionPercent ??
        perfGain;
      if (reduction >= threshold) {
        return {
          validated: true,
          summary: `Hypothesis validated: "${winningCandidate.name}" achieved ${reduction}% reduction, exceeding target threshold of >= ${threshold}%. Statement: "${hypothesis.statement}".`,
        };
      } else {
        return {
          validated: false,
          summary: `Hypothesis falsified: "${winningCandidate.name}" achieved ${reduction}% reduction, failing required threshold of >= ${threshold}%. (${hypothesis.falsificationCriteria})`,
        };
      }
    }

    // no_regression mode: ensure functional correctness score 1.0 and zero errors
    const passesNoRegression =
      !winningCandidate.hasErrors &&
      !winningCandidate.uxDegradation &&
      (winningCandidate.functionalCorrectnessScore === undefined ||
        winningCandidate.functionalCorrectnessScore >= 1.0);

    if (passesNoRegression) {
      return {
        validated: true,
        summary: `Hypothesis validated: "${winningCandidate.name}" maintained zero functional regression or UX degradation. Statement: "${hypothesis.statement}".`,
      };
    }

    return {
      validated: false,
      summary: `Hypothesis falsified: "${winningCandidate.name}" introduced functional regression or UX degradation. (${hypothesis.falsificationCriteria})`,
    };
  }
}

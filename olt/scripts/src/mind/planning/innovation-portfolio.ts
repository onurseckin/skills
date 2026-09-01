/**
 * @file innovation-portfolio.ts
 * Mind Planning - 70/20/10 Innovation Portfolio Governance & 3-Milestone Hypothesis Gates
 *
 * Implements:
 * - 70/20/10 Innovation Portfolio Governance across 3 tracks:
 *   * Track A: Core Stability & Polish (70% target)
 *   * Track B: Architectural Evolution (20% target)
 *   * Track C: Exploratory Horizon Bets (10% target)
 * - Portfolio Balancer & Capacity Auditor with Timidity Trap & Speculative Over-allocation detection
 * - 3-Milestone Hypothesis Gates for Exploratory Bets:
 *   * Milestone 1: Feasibility Prototype (minimal POC validation)
 *   * Milestone 2: Stress Validation (load/stress testing, edge cases, performance boundaries)
 *   * Milestone 3: System Integration (clean end-to-end integration without regression)
 * - Stage-Gated Funding & Execution with automatic Anti-Pattern Ledger recording upon failure
 * - Graduation Protocol for successful bets into Core Stability or Architectural Evolution
 */

// ============================================================================
// 1. Portfolio Tracks & Constants
// ============================================================================

export const PORTFOLIO_TRACKS = {
  CORE_STABILITY_AND_POLISH: "CORE_STABILITY_AND_POLISH",
  ARCHITECTURAL_EVOLUTION: "ARCHITECTURAL_EVOLUTION",
  EXPLORATORY_HORIZON_BETS: "EXPLORATORY_HORIZON_BETS",
} as const;

export type PortfolioTrack = (typeof PORTFOLIO_TRACKS)[keyof typeof PORTFOLIO_TRACKS];

export const PORTFOLIO_TARGET_PERCENTAGES: Readonly<Record<PortfolioTrack, number>> = {
  [PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH]: 70,
  [PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION]: 20,
  [PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]: 10,
};

export const TRACK_DESCRIPTIONS: Readonly<Record<PortfolioTrack, string>> = {
  [PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH]:
    "Defect remediation, edge-case coverage, UX polish, doc accuracy.",
  [PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION]:
    "Subsystem refactoring, scaling optimizations, modular decoupling.",
  [PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]:
    "Transformative capabilities, radical simplifications, breakthrough paradigms.",
};

export type PortfolioBalanceStatus =
  | "BALANCED"
  | "TIMIDITY_TRAP"
  | "SPECULATIVE_OVERALLOCATION"
  | "CORE_DEFICIT";

export const TIMIDITY_TRAP_MIN_WORKSTREAMS = 3;
export const SPECULATIVE_OVERALLOCATION_THRESHOLD_PERCENT = 15;
export const CORE_DEFICIT_THRESHOLD_PERCENT = 55;

export type RebalanceUrgency = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface PortfolioWorkstream {
  readonly id: string;
  readonly title: string;
  readonly track: PortfolioTrack;
  readonly allocationWeight?: number | undefined;
  readonly status?: "ACTIVE" | "PAUSED" | "COMPLETED" | "TERMINATED" | undefined;
  readonly description?: string | undefined;
  readonly owner?: string | undefined;
  readonly betId?: string | undefined;
  readonly createdAt?: string | undefined;
}

export interface RebalanceAction {
  readonly fromTrack: PortfolioTrack;
  readonly toTrack: PortfolioTrack;
  readonly recommendedShiftPercent: number;
  readonly rationale: string;
  readonly urgency: RebalanceUrgency;
}

export interface PortfolioBalanceReport {
  readonly totalWorkstreams: number;
  readonly totalAllocation: number;
  readonly distributionCounts: Readonly<Record<PortfolioTrack, number>>;
  readonly distributionPercentages: Readonly<Record<PortfolioTrack, number>>;
  readonly targetDeviations: Readonly<Record<PortfolioTrack, number>>;
  readonly status: PortfolioBalanceStatus;
  readonly isBalanced: boolean;
  readonly rebalanceActions: readonly RebalanceAction[];
  readonly auditedAt: string;
}

// ============================================================================
// 2. 3-Milestone Hypothesis Gates Types
// ============================================================================

export type MilestoneNumber = 1 | 2 | 3;

export const MILESTONE_NAMES = {
  FEASIBILITY_PROTOTYPE: "FEASIBILITY_PROTOTYPE",
  STRESS_VALIDATION: "STRESS_VALIDATION",
  SYSTEM_INTEGRATION: "SYSTEM_INTEGRATION",
} as const;

export type MilestoneName = (typeof MILESTONE_NAMES)[keyof typeof MILESTONE_NAMES];

export const MILESTONE_DEFINITIONS: Readonly<
  Record<MilestoneNumber, { readonly name: MilestoneName; readonly description: string }>
> = {
  1: {
    name: "FEASIBILITY_PROTOTYPE",
    description: "Minimal proof of concept validation.",
  },
  2: {
    name: "STRESS_VALIDATION",
    description: "Load/stress testing, edge-case resilience, performance boundary verification.",
  },
  3: {
    name: "SYSTEM_INTEGRATION",
    description: "Clean end-to-end integration without regression.",
  },
};

export type BetStatus = "PROPOSED" | "ACTIVE" | "GRADUATED" | "TERMINATED";
export type MilestoneGateStatus = "PENDING" | "IN_PROGRESS" | "PASSED" | "FAILED" | "SKIPPED";

export interface BetBudget {
  readonly totalAllocated: number;
  readonly totalSpent: number;
  readonly milestoneBudgets?: Readonly<Partial<Record<MilestoneNumber, number>>> | undefined;
  readonly currency?: string | undefined;
}

export interface MilestoneGate {
  readonly milestone: MilestoneNumber;
  readonly name: MilestoneName;
  readonly description: string;
  readonly status: MilestoneGateStatus;
  readonly allocatedBudget?: number | undefined;
  readonly spentBudget?: number | undefined;
  readonly acceptanceCriteria: readonly string[];
  readonly validationEvidence?: string | undefined;
  readonly failureReason?: string | undefined;
  readonly evaluatedAt?: string | undefined;
}

export interface GraduationCertificate {
  readonly certificateId: string;
  readonly betId: string;
  readonly title: string;
  readonly falsifiableHypothesis: string;
  readonly graduatedAt: string;
  readonly targetRolloutTrack: "CORE_STABILITY_AND_POLISH" | "ARCHITECTURAL_EVOLUTION";
  readonly milestoneSummary: readonly {
    readonly milestone: MilestoneNumber;
    readonly name: MilestoneName;
    readonly evidence: string;
  }[];
  readonly productionRolloutPlan: string;
  readonly signature: string;
}

export interface ExploratoryBet {
  readonly id: string;
  readonly title: string;
  readonly falsifiableHypothesis: string;
  readonly valueProposition: string;
  readonly budget: BetBudget;
  readonly currentMilestone: MilestoneNumber;
  readonly status: BetStatus;
  readonly antiPatternEntryId?: string | undefined;
  readonly graduationCertificate?: GraduationCertificate | undefined;
  readonly milestones: readonly MilestoneGate[];
  readonly targetGraduationTrack?:
    | "CORE_STABILITY_AND_POLISH"
    | "ARCHITECTURAL_EVOLUTION"
    | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly topic?: string | undefined;
  readonly owner?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateBetInput {
  readonly id?: string | undefined;
  readonly title: string;
  readonly falsifiableHypothesis: string;
  readonly valueProposition: string;
  readonly budget?: Partial<BetBudget> | number | undefined;
  readonly targetGraduationTrack?:
    | "CORE_STABILITY_AND_POLISH"
    | "ARCHITECTURAL_EVOLUTION"
    | undefined;
  readonly milestone1Criteria?: readonly string[] | undefined;
  readonly milestone2Criteria?: readonly string[] | undefined;
  readonly milestone3Criteria?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly topic?: string | undefined;
  readonly owner?: string | undefined;
}

export interface MilestoneValidationInput {
  readonly passed: boolean;
  readonly evidence: string;
  readonly spentBudget?: number | undefined;
  readonly metrics?: Readonly<Record<string, number | string | boolean>> | undefined;
  readonly failureReason?: string | undefined;
  readonly failureSymptoms?: readonly string[] | undefined;
  readonly lessonsLearned?: string | undefined;
  readonly targetGraduationTrack?:
    | "CORE_STABILITY_AND_POLISH"
    | "ARCHITECTURAL_EVOLUTION"
    | undefined;
  readonly productionRolloutPlan?: string | undefined;
}

export interface MilestoneEvaluationResult {
  readonly betId: string;
  readonly milestone: MilestoneNumber;
  readonly milestoneName: MilestoneName;
  readonly passed: boolean;
  readonly previousStatus: BetStatus;
  readonly newStatus: BetStatus;
  readonly nextMilestone?: MilestoneNumber | undefined;
  readonly graduationCertificate?: GraduationCertificate | undefined;
  readonly antiPatternEntry?: AntiPatternEntry | undefined;
  readonly rebalanceRecommendation?: RebalanceAction | undefined;
  readonly rationale: string;
  readonly evaluatedAt: string;
}

// ============================================================================
// 3. Anti-Pattern Ledger
// ============================================================================

export interface AntiPatternEntry {
  readonly id: string;
  readonly betId: string;
  readonly betTitle: string;
  readonly falsifiedHypothesis: string;
  readonly failedMilestone: MilestoneNumber;
  readonly failedMilestoneName: MilestoneName;
  readonly failureReason: string;
  readonly symptoms: readonly string[];
  readonly lessonsLearned: string;
  readonly tags: readonly string[];
  readonly topic: string;
  readonly recordedAt: string;
  readonly preventedRepetitionsCount: number;
}

export interface CreateAntiPatternInput {
  readonly id?: string | undefined;
  readonly betId: string;
  readonly betTitle: string;
  readonly falsifiedHypothesis: string;
  readonly failedMilestone: MilestoneNumber;
  readonly failedMilestoneName: MilestoneName;
  readonly failureReason: string;
  readonly symptoms?: readonly string[] | undefined;
  readonly lessonsLearned?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly topic?: string | undefined;
}

export interface HypothesisConflictCheck {
  readonly hasConflict: boolean;
  readonly matchingEntries: readonly AntiPatternEntry[];
  readonly conflictWarning?: string | undefined;
}

export class AntiPatternLedger {
  private readonly entries: Map<string, AntiPatternEntry> = new Map();
  private readonly betIdIndex: Map<string, string> = new Map();

  public recordAntiPattern(input: CreateAntiPatternInput): AntiPatternEntry {
    const id = input.id ?? `anti-${input.betId}-${Date.now()}`;
    const entry: AntiPatternEntry = {
      id,
      betId: input.betId,
      betTitle: input.betTitle,
      falsifiedHypothesis: input.falsifiedHypothesis,
      failedMilestone: input.failedMilestone,
      failedMilestoneName: input.failedMilestoneName,
      failureReason: input.failureReason,
      symptoms: input.symptoms ?? [],
      lessonsLearned:
        input.lessonsLearned ??
        `Hypothesis "${input.falsifiedHypothesis}" failed empirical verification at ${input.failedMilestoneName}.`,
      tags: input.tags ?? [],
      topic: input.topic ?? input.betTitle,
      recordedAt: new Date().toISOString(),
      preventedRepetitionsCount: 0,
    };

    this.entries.set(id, entry);
    this.betIdIndex.set(input.betId, id);
    return entry;
  }

  public getEntry(id: string): AntiPatternEntry | undefined {
    return this.entries.get(id);
  }

  public getEntryByBetId(betId: string): AntiPatternEntry | undefined {
    const entryId = this.betIdIndex.get(betId);
    if (!entryId) return undefined;
    return this.entries.get(entryId);
  }

  public searchByTopic(topic: string): readonly AntiPatternEntry[] {
    const normalized = topic.toLowerCase().trim();
    if (!normalized) return [];
    return Array.from(this.entries.values()).filter((e) =>
      e.topic.toLowerCase().includes(normalized),
    );
  }

  public searchByTags(tags: readonly string[]): readonly AntiPatternEntry[] {
    if (tags.length === 0) return [];
    const normalizedTags = new Set(tags.map((t) => t.toLowerCase().trim()));
    return Array.from(this.entries.values()).filter((e) =>
      e.tags.some((tag) => normalizedTags.has(tag.toLowerCase().trim())),
    );
  }

  public searchByQuery(query: string): readonly AntiPatternEntry[] {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return [];
    return Array.from(this.entries.values()).filter(
      (e) =>
        e.betTitle.toLowerCase().includes(normalized) ||
        e.falsifiedHypothesis.toLowerCase().includes(normalized) ||
        e.failureReason.toLowerCase().includes(normalized) ||
        e.lessonsLearned.toLowerCase().includes(normalized) ||
        e.topic.toLowerCase().includes(normalized) ||
        e.tags.some((tag) => tag.toLowerCase().includes(normalized)),
    );
  }

  public checkHypothesisConflict(
    hypothesis: string,
    tags?: readonly string[] | undefined,
    topic?: string | undefined,
  ): HypothesisConflictCheck {
    const matchingEntries: AntiPatternEntry[] = [];
    const normalizedHypothesis = hypothesis.toLowerCase().trim();

    const getKeywords = (text: string): string[] =>
      text
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length >= 3);

    const wordsA = new Set(getKeywords(normalizedHypothesis));

    for (const entry of this.entries.values()) {
      const entryHypothesis = entry.falsifiedHypothesis.toLowerCase().trim();

      const wordsB = getKeywords(entryHypothesis);
      const sharedWords = wordsB.filter((w) => wordsA.has(w));
      const minWordCount = Math.min(wordsA.size, wordsB.length);
      const overlapRatio = minWordCount > 0 ? sharedWords.length / minWordCount : 0;

      if (
        entryHypothesis === normalizedHypothesis ||
        (normalizedHypothesis.length > 15 &&
          (entryHypothesis.includes(normalizedHypothesis) ||
            normalizedHypothesis.includes(entryHypothesis))) ||
        (sharedWords.length >= 4 && overlapRatio >= 0.5)
      ) {
        matchingEntries.push(entry);
        continue;
      }

      // Check for tag + topic match
      if (topic && entry.topic.toLowerCase() === topic.toLowerCase()) {
        if (tags && tags.length > 0) {
          const entryTags = new Set(entry.tags.map((t) => t.toLowerCase()));
          const sharedTags = tags.filter((t) => entryTags.has(t.toLowerCase()));
          if (sharedTags.length >= 2) {
            matchingEntries.push(entry);
          }
        }
      }
    }

    if (matchingEntries.length > 0) {
      const updatedMatches: AntiPatternEntry[] = [];
      for (const match of matchingEntries) {
        this.incrementPreventedRepetition(match.id);
        const updated = this.getEntry(match.id);
        if (updated) {
          updatedMatches.push(updated);
        } else {
          updatedMatches.push(match);
        }
      }

      return {
        hasConflict: true,
        matchingEntries: updatedMatches,
        conflictWarning: `Hypothesis conflicts with ${updatedMatches.length} recorded anti-pattern(s): [${updatedMatches.map((e) => `"${e.betTitle}" (Failed at ${e.failedMilestoneName})`).join(", ")}].`,
      };
    }

    return {
      hasConflict: false,
      matchingEntries: [],
    };
  }

  public incrementPreventedRepetition(entryId: string): boolean {
    const existing = this.entries.get(entryId);
    if (!existing) return false;
    const updated: AntiPatternEntry = {
      ...existing,
      preventedRepetitionsCount: existing.preventedRepetitionsCount + 1,
    };
    this.entries.set(entryId, updated);
    return true;
  }

  public getAllEntries(): readonly AntiPatternEntry[] {
    return Array.from(this.entries.values());
  }

  public clear(): void {
    this.entries.clear();
    this.betIdIndex.clear();
  }

  public exportJson(): string {
    return JSON.stringify(Array.from(this.entries.values()), null, 2);
  }

  public importJson(json: string): void {
    const parsed = JSON.parse(json) as readonly AntiPatternEntry[];
    for (const entry of parsed) {
      this.entries.set(entry.id, entry);
      this.betIdIndex.set(entry.betId, entry.id);
    }
  }
}

// ============================================================================
// 4. Innovation Portfolio Manager & Balancer
// ============================================================================

export interface InnovationPortfolioOptions {
  readonly initialWorkstreams?: readonly PortfolioWorkstream[] | undefined;
  readonly initialBets?: readonly ExploratoryBet[] | undefined;
  readonly antiPatternLedger?: AntiPatternLedger | undefined;
}

export class InnovationPortfolioManager {
  private readonly workstreams: Map<string, PortfolioWorkstream> = new Map();
  private readonly bets: Map<string, ExploratoryBet> = new Map();
  private readonly certificates: Map<string, GraduationCertificate> = new Map();
  private readonly antiPatternLedger: AntiPatternLedger;

  constructor(options: InnovationPortfolioOptions = {}) {
    this.antiPatternLedger = options.antiPatternLedger ?? new AntiPatternLedger();

    if (options.initialWorkstreams) {
      for (const ws of options.initialWorkstreams) {
        this.workstreams.set(ws.id, ws);
      }
    }

    if (options.initialBets) {
      for (const bet of options.initialBets) {
        this.bets.set(bet.id, bet);
      }
    }
  }

  public getAntiPatternLedger(): AntiPatternLedger {
    return this.antiPatternLedger;
  }

  public registerWorkstream(workstream: PortfolioWorkstream): void {
    this.workstreams.set(workstream.id, {
      ...workstream,
      allocationWeight: workstream.allocationWeight ?? 1,
      status: workstream.status ?? "ACTIVE",
      createdAt: workstream.createdAt ?? new Date().toISOString(),
    });
  }

  public removeWorkstream(workstreamId: string): boolean {
    return this.workstreams.delete(workstreamId);
  }

  public getWorkstreams(): readonly PortfolioWorkstream[] {
    return Array.from(this.workstreams.values());
  }

  /**
   * Audits active workstream distribution across 70/20/10 tracks:
   * - Track A: Core Stability & Polish (Target: 70%)
   * - Track B: Architectural Evolution (Target: 20%)
   * - Track C: Exploratory Horizon Bets (Target: 10%)
   *
   * Detects:
   * - Timidity Trap (0% exploratory bets when total workstreams >= 3)
   * - Speculative Over-allocation (>15% exploratory bets)
   * - Core Deficit (<55% core stability allocation)
   */
  public auditPortfolioBalance(
    workstreamInputs?: readonly PortfolioWorkstream[] | undefined,
  ): PortfolioBalanceReport {
    const list = workstreamInputs ?? Array.from(this.workstreams.values());
    const active = list.filter((w) => {
      const st = w.status ?? "ACTIVE";
      return st === "ACTIVE";
    });

    const totalWorkstreams = active.length;

    const distributionCounts: Record<PortfolioTrack, number> = {
      [PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH]: 0,
      [PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION]: 0,
      [PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]: 0,
    };

    const allocationSums: Record<PortfolioTrack, number> = {
      [PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH]: 0,
      [PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION]: 0,
      [PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]: 0,
    };

    let totalAllocation = 0;

    for (const ws of active) {
      const weight = ws.allocationWeight ?? 1;
      const track = ws.track;
      if (distributionCounts[track] !== undefined) {
        distributionCounts[track] += 1;
        allocationSums[track] += weight;
        totalAllocation += weight;
      }
    }

    if (totalAllocation === 0 || totalWorkstreams === 0) {
      return {
        totalWorkstreams: 0,
        totalAllocation: 0,
        distributionCounts,
        distributionPercentages: {
          [PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH]: 0,
          [PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION]: 0,
          [PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]: 0,
        },
        targetDeviations: {
          [PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH]: -70,
          [PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION]: -20,
          [PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]: -10,
        },
        status: "BALANCED",
        isBalanced: true,
        rebalanceActions: [],
        auditedAt: new Date().toISOString(),
      };
    }

    const distributionPercentages: Record<PortfolioTrack, number> = {
      [PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH]:
        Math.round(
          (allocationSums[PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH] / totalAllocation) * 1000,
        ) / 10,
      [PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION]:
        Math.round(
          (allocationSums[PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION] / totalAllocation) * 1000,
        ) / 10,
      [PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]:
        Math.round(
          (allocationSums[PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS] / totalAllocation) * 1000,
        ) / 10,
    };

    const targetDeviations: Record<PortfolioTrack, number> = {
      [PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH]:
        Math.round(
          (distributionPercentages[PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH] - 70) * 10,
        ) / 10,
      [PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION]:
        Math.round((distributionPercentages[PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION] - 20) * 10) /
        10,
      [PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]:
        Math.round((distributionPercentages[PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS] - 10) * 10) /
        10,
    };

    const exploratoryPct = distributionPercentages[PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS];
    const corePct = distributionPercentages[PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH];
    const rebalanceActions: RebalanceAction[] = [];

    let status: PortfolioBalanceStatus = "BALANCED";

    // 1. Detect Timidity Trap: 0% exploratory bets when total active workstreams >= 3
    if (totalWorkstreams >= TIMIDITY_TRAP_MIN_WORKSTREAMS && exploratoryPct === 0) {
      status = "TIMIDITY_TRAP";
      rebalanceActions.push({
        fromTrack: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
        toTrack: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS,
        recommendedShiftPercent: 10,
        rationale: `Timidity Trap detected: 0% exploratory capacity across ${totalWorkstreams} active workstreams. Seed stage-gated exploratory bets to reach the 10% innovation target.`,
        urgency: "HIGH",
      });
    }
    // 2. Detect Speculative Over-allocation: > 15% exploratory bets
    else if (exploratoryPct > SPECULATIVE_OVERALLOCATION_THRESHOLD_PERCENT) {
      status = "SPECULATIVE_OVERALLOCATION";
      const excess = Math.round((exploratoryPct - 10) * 10) / 10;
      rebalanceActions.push({
        fromTrack: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS,
        toTrack: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
        recommendedShiftPercent: excess,
        rationale: `Speculative Over-allocation detected: exploratory horizon bets (${exploratoryPct}%) exceed the 15% threshold. Curtail unverified horizon bets and reallocate ${excess}% to Core Stability & Polish.`,
        urgency: "CRITICAL",
      });
    }
    // 3. Detect Core Deficit: < 55% core stability
    else if (corePct < CORE_DEFICIT_THRESHOLD_PERCENT) {
      status = "CORE_DEFICIT";
      const deficit = Math.round((70 - corePct) * 10) / 10;
      const sourceTrack =
        distributionPercentages[PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION] > 20
          ? PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION
          : PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS;

      rebalanceActions.push({
        fromTrack: sourceTrack,
        toTrack: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
        recommendedShiftPercent: deficit,
        rationale: `Core Deficit detected: Core Stability & Polish (${corePct}%) is below minimum safe threshold (${CORE_DEFICIT_THRESHOLD_PERCENT}%). Reallocate ${deficit}% to protect bedrock invariants.`,
        urgency: "HIGH",
      });
    }

    const isBalanced = status === "BALANCED";

    return {
      totalWorkstreams,
      totalAllocation,
      distributionCounts,
      distributionPercentages,
      targetDeviations,
      status,
      isBalanced,
      rebalanceActions,
      auditedAt: new Date().toISOString(),
    };
  }

  public proposeRebalancePlan(report: PortfolioBalanceReport): readonly RebalanceAction[] {
    return report.rebalanceActions;
  }

  // ============================================================================
  // 5. Exploratory Bets Lifecycle & Hypothesis Gates
  // ============================================================================

  public registerBet(input: CreateBetInput): ExploratoryBet {
    const id = input.id ?? `bet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Check conflict against anti-pattern ledger
    this.antiPatternLedger.checkHypothesisConflict(
      input.falsifiableHypothesis,
      input.tags,
      input.topic,
    );

    let budgetAllocated = 1000;
    let budgetSpent = 0;
    let milestoneBudgets: Partial<Record<MilestoneNumber, number>> = {
      1: 300,
      2: 400,
      3: 300,
    };

    if (typeof input.budget === "number") {
      budgetAllocated = input.budget;
      milestoneBudgets = {
        1: Math.round(budgetAllocated * 0.3),
        2: Math.round(budgetAllocated * 0.4),
        3: Math.round(budgetAllocated * 0.3),
      };
    } else if (input.budget) {
      budgetAllocated = input.budget.totalAllocated ?? budgetAllocated;
      budgetSpent = input.budget.totalSpent ?? budgetSpent;
      if (input.budget.milestoneBudgets) {
        milestoneBudgets = { ...input.budget.milestoneBudgets };
      }
    }

    const budget: BetBudget = {
      totalAllocated: budgetAllocated,
      totalSpent: budgetSpent,
      milestoneBudgets,
      currency: typeof input.budget === "object" ? (input.budget.currency ?? "TOKENS") : "TOKENS",
    };

    const milestones: MilestoneGate[] = [
      {
        milestone: 1,
        name: MILESTONE_NAMES.FEASIBILITY_PROTOTYPE,
        description: MILESTONE_DEFINITIONS[1].description,
        status: "IN_PROGRESS",
        allocatedBudget: milestoneBudgets[1],
        spentBudget: 0,
        acceptanceCriteria: input.milestone1Criteria ?? [
          "Minimal proof of concept validated empirically.",
          "Core hypothesis feasibility demonstrated.",
        ],
      },
      {
        milestone: 2,
        name: MILESTONE_NAMES.STRESS_VALIDATION,
        description: MILESTONE_DEFINITIONS[2].description,
        status: "PENDING",
        allocatedBudget: milestoneBudgets[2],
        spentBudget: 0,
        acceptanceCriteria: input.milestone2Criteria ?? [
          "Load and stress testing verified without cascading failure.",
          "Edge-case resilience confirmed under boundary conditions.",
          "Performance boundary established.",
        ],
      },
      {
        milestone: 3,
        name: MILESTONE_NAMES.SYSTEM_INTEGRATION,
        description: MILESTONE_DEFINITIONS[3].description,
        status: "PENDING",
        allocatedBudget: milestoneBudgets[3],
        spentBudget: 0,
        acceptanceCriteria: input.milestone3Criteria ?? [
          "Clean end-to-end integration without regression.",
          "Zero breaking regressions in core stability or public interfaces.",
          "Automated test coverage satisfies standard quality threshold.",
        ],
      },
    ];

    const bet: ExploratoryBet = {
      id,
      title: input.title,
      falsifiableHypothesis: input.falsifiableHypothesis,
      valueProposition: input.valueProposition,
      budget,
      currentMilestone: 1,
      status: "ACTIVE",
      milestones,
      targetGraduationTrack: input.targetGraduationTrack ?? "ARCHITECTURAL_EVOLUTION",
      tags: input.tags ?? [],
      topic: input.topic ?? input.title,
      owner: input.owner,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.bets.set(id, bet);

    // Also register as active workstream in exploratory track
    this.registerWorkstream({
      id: `ws-${bet.id}`,
      title: `[Bet] ${bet.title}`,
      track: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS,
      allocationWeight: 1,
      status: "ACTIVE",
      betId: bet.id,
      description: bet.falsifiableHypothesis,
    });

    return bet;
  }

  public getBet(betId: string): ExploratoryBet | undefined {
    return this.bets.get(betId);
  }

  public getAllBets(): readonly ExploratoryBet[] {
    return Array.from(this.bets.values());
  }

  public getActiveBets(): readonly ExploratoryBet[] {
    return Array.from(this.bets.values()).filter((b) => b.status === "ACTIVE");
  }

  public getGraduationCertificates(): readonly GraduationCertificate[] {
    return Array.from(this.certificates.values());
  }

  /**
   * Evaluates a milestone gate for an active exploratory bet:
   * - Milestone 1: FEASIBILITY_PROTOTYPE (minimal POC)
   * - Milestone 2: STRESS_VALIDATION (load/stress testing, edge-case resilience)
   * - Milestone 3: SYSTEM_INTEGRATION (clean end-to-end integration without regression)
   *
   * Outcomes:
   * - If passed && milestone === 3: Executes GraduationProtocol, marks bet as GRADUATED,
   *   issues GraduationCertificate, and transitions workstream into Core Stability / Arch Evolution.
   * - If passed && milestone < 3: Advances bet to next milestone (status ACTIVE).
   * - If failed: Immediately terminates bet (status TERMINATED), logs failure into AntiPatternLedger,
   *   updates corresponding workstream to TERMINATED, and generates capacity re-allocation recommendation.
   */
  public evaluateMilestone(
    betId: string,
    milestoneNumber: MilestoneNumber,
    validation: MilestoneValidationInput,
  ): MilestoneEvaluationResult {
    const bet = this.bets.get(betId);
    if (!bet) {
      throw new Error(`Exploratory bet with ID "${betId}" not found.`);
    }

    if (bet.status === "TERMINATED") {
      throw new Error(`Cannot evaluate terminated bet "${betId}".`);
    }

    if (bet.status === "GRADUATED") {
      throw new Error(`Cannot evaluate already graduated bet "${betId}".`);
    }

    if (bet.currentMilestone !== milestoneNumber) {
      throw new Error(
        `Cannot evaluate milestone ${milestoneNumber}; bet "${betId}" is currently on milestone ${bet.currentMilestone}.`,
      );
    }

    const milestoneDef = MILESTONE_DEFINITIONS[milestoneNumber];
    const evaluatedAt = new Date().toISOString();
    const previousStatus = bet.status;

    // Update spending
    const spentDelta = validation.spentBudget ?? 0;
    const totalSpent = bet.budget.totalSpent + spentDelta;
    const updatedMilestoneBudgets = {
      ...bet.budget.milestoneBudgets,
      [milestoneNumber]: (bet.budget.milestoneBudgets?.[milestoneNumber] ?? 0) + spentDelta,
    };

    const updatedBudget: BetBudget = {
      ...bet.budget,
      totalSpent,
      milestoneBudgets: updatedMilestoneBudgets,
    };

    // --------------------------------------------------------------------------
    // Case A: Milestone Passed
    // --------------------------------------------------------------------------
    if (validation.passed) {
      // If Milestone 3 passed -> Graduation!
      if (milestoneNumber === 3) {
        const updatedMilestones: MilestoneGate[] = bet.milestones.map((gate) => {
          if (gate.milestone === 3) {
            return {
              ...gate,
              status: "PASSED",
              validationEvidence: validation.evidence,
              spentBudget: (gate.spentBudget ?? 0) + spentDelta,
              evaluatedAt,
            };
          }
          return gate;
        });

        const targetRolloutTrack =
          validation.targetGraduationTrack ??
          bet.targetGraduationTrack ??
          PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION;

        const certificateId = `grad-cert-${bet.id}-${Date.now()}`;
        const milestoneSummary = updatedMilestones.map((g) => ({
          milestone: g.milestone,
          name: g.name,
          evidence: g.validationEvidence ?? g.description,
        }));

        const graduationCertificate: GraduationCertificate = {
          certificateId,
          betId: bet.id,
          title: bet.title,
          falsifiableHypothesis: bet.falsifiableHypothesis,
          graduatedAt: evaluatedAt,
          targetRolloutTrack,
          milestoneSummary,
          productionRolloutPlan:
            validation.productionRolloutPlan ??
            `Graduated from exploratory horizon into ${targetRolloutTrack}. Production rollout authorized under standard telemetry and continuous verification.`,
          signature: `GRADUATION-VALIDATED-${bet.id}-${Date.now()}`,
        };

        this.certificates.set(certificateId, graduationCertificate);

        const graduatedBet: ExploratoryBet = {
          ...bet,
          budget: updatedBudget,
          status: "GRADUATED",
          milestones: updatedMilestones,
          graduationCertificate,
          updatedAt: evaluatedAt,
        };

        this.bets.set(betId, graduatedBet);

        // Update corresponding workstream track to graduated rollout track
        const wsId = `ws-${bet.id}`;
        const existingWs = this.workstreams.get(wsId);
        if (existingWs) {
          this.workstreams.set(wsId, {
            ...existingWs,
            track: targetRolloutTrack,
            title: `[Graduated] ${bet.title}`,
            status: "ACTIVE",
          });
        }

        return {
          betId: bet.id,
          milestone: milestoneNumber,
          milestoneName: milestoneDef.name,
          passed: true,
          previousStatus,
          newStatus: "GRADUATED",
          graduationCertificate,
          rationale: `Exploratory bet "${bet.title}" has successfully passed all 3 hypothesis gates (Feasibility -> Stress -> System Integration) and is graduated to ${targetRolloutTrack}.`,
          evaluatedAt,
        };
      }

      // If Milestone 1 or 2 passed -> Advance to next milestone
      const nextMilestone = (milestoneNumber + 1) as MilestoneNumber;
      const updatedMilestones: MilestoneGate[] = bet.milestones.map((gate) => {
        if (gate.milestone === milestoneNumber) {
          return {
            ...gate,
            status: "PASSED",
            validationEvidence: validation.evidence,
            spentBudget: (gate.spentBudget ?? 0) + spentDelta,
            evaluatedAt,
          };
        }
        if (gate.milestone === nextMilestone) {
          return {
            ...gate,
            status: "IN_PROGRESS",
          };
        }
        return gate;
      });

      const advancedBet: ExploratoryBet = {
        ...bet,
        budget: updatedBudget,
        currentMilestone: nextMilestone,
        status: "ACTIVE",
        milestones: updatedMilestones,
        updatedAt: evaluatedAt,
      };

      this.bets.set(betId, advancedBet);

      return {
        betId: bet.id,
        milestone: milestoneNumber,
        milestoneName: milestoneDef.name,
        passed: true,
        previousStatus,
        newStatus: "ACTIVE",
        nextMilestone,
        rationale: `Milestone ${milestoneNumber} (${milestoneDef.name}) passed validation. Bet advanced to Milestone ${nextMilestone} (${MILESTONE_DEFINITIONS[nextMilestone].name}).`,
        evaluatedAt,
      };
    }

    // --------------------------------------------------------------------------
    // Case B: Milestone Failed -> Immediate Termination & Anti-Pattern Ledger
    // --------------------------------------------------------------------------
    const failureReason = validation.failureReason ?? "Empirical validation criteria not met.";
    const updatedMilestones: MilestoneGate[] = bet.milestones.map((gate) => {
      if (gate.milestone === milestoneNumber) {
        return {
          ...gate,
          status: "FAILED",
          failureReason,
          validationEvidence: validation.evidence,
          spentBudget: (gate.spentBudget ?? 0) + spentDelta,
          evaluatedAt,
        };
      }
      return gate;
    });

    const antiPatternEntry = this.antiPatternLedger.recordAntiPattern({
      betId: bet.id,
      betTitle: bet.title,
      falsifiedHypothesis: bet.falsifiableHypothesis,
      failedMilestone: milestoneNumber,
      failedMilestoneName: milestoneDef.name,
      failureReason,
      symptoms: validation.failureSymptoms ?? [failureReason],
      lessonsLearned:
        validation.lessonsLearned ??
        `Exploratory bet "${bet.title}" failed at Milestone ${milestoneNumber} (${milestoneDef.name}). Terminated early to prevent speculative capital drain.`,
      tags: bet.tags ?? [],
      topic: bet.topic ?? bet.title,
    });

    const terminatedBet: ExploratoryBet = {
      ...bet,
      budget: updatedBudget,
      status: "TERMINATED",
      antiPatternEntryId: antiPatternEntry.id,
      milestones: updatedMilestones,
      updatedAt: evaluatedAt,
    };

    this.bets.set(betId, terminatedBet);

    // Update workstream to TERMINATED to immediately release exploratory capacity
    const wsId = `ws-${bet.id}`;
    const existingWs = this.workstreams.get(wsId);
    if (existingWs) {
      this.workstreams.set(wsId, {
        ...existingWs,
        status: "TERMINATED",
      });
    }

    const rebalanceRecommendation: RebalanceAction = {
      fromTrack: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS,
      toTrack: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
      recommendedShiftPercent: 10,
      rationale: `Bet "${bet.title}" terminated at Milestone ${milestoneNumber} (${milestoneDef.name}). Reallocate freed capacity back to Core Stability & Polish.`,
      urgency: "HIGH",
    };

    return {
      betId: bet.id,
      milestone: milestoneNumber,
      milestoneName: milestoneDef.name,
      passed: false,
      previousStatus,
      newStatus: "TERMINATED",
      antiPatternEntry,
      rebalanceRecommendation,
      rationale: `Milestone ${milestoneNumber} (${milestoneDef.name}) failed empirical validation. Bet immediately terminated and recorded in Anti-Pattern Ledger (Entry: ${antiPatternEntry.id}).`,
      evaluatedAt,
    };
  }
}

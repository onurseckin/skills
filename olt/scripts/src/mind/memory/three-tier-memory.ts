/**
 * 3-Tier Hierarchical Semantic Memory Engine
 *
 * Tier 1: Core Bedrock Invariants (Permanent System Axioms, Settled Pareto Decisions, permanent anti-patterns,
 *         immutable, 0 decay, 0 compaction, always loaded in full).
 * Tier 2: Active Strategic Working Memory (Operational Horizon Window, active epics, active dialectical resolutions,
 *         open dependencies, rolling milestone completions, continuous refinement & pruning).
 * Tier 3: Archived Episodic Epics with Supersession Indexing (Compacted semantic abstracts,
 *         Epistemic Status: Active / Superseded / Deprecated, Temporal Lineage Pointers).
 */

import {
  type EpistemicStatus,
  type SupersessionIndexState,
  SupersessionIndex,
} from "./supersession-index.ts";

// ============================================================================
// Tier 1: Core Bedrock Invariants
// ============================================================================

export type BedrockInvariantCategory =
  | "AXIOM"
  | "SETTLED_PARETO"
  | "PERMANENT_ANTI_PATTERN"
  | "CORE_PRINCIPLE"
  | "ARCHITECTURAL_INVARIANT";

export interface BedrockInvariant {
  readonly id: string;
  readonly title: string;
  readonly category: BedrockInvariantCategory | string;
  readonly statement: string;
  readonly rationale: string;
  readonly settledDate: string;
  readonly supersedesHistoricalIds?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface AddBedrockInvariantOptions {
  readonly id: string;
  readonly title: string;
  readonly category?: BedrockInvariantCategory | string | undefined;
  readonly statement: string;
  readonly rationale: string;
  readonly settledDate?: string | undefined;
  readonly supersedesHistoricalIds?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

// ============================================================================
// Tier 2: Active Strategic Working Memory
// ============================================================================

export type WorkingMemoryCategory =
  | "ACTIVE_EPIC"
  | "DIALECTICAL_RESOLUTION"
  | "OPEN_DEPENDENCY"
  | "MILESTONE"
  | "STRATEGIC_OBJECTIVE"
  | "PARETO_CANDIDATE";

export type WorkingMemoryStatus =
  | "ACTIVE"
  | "IN_PROGRESS"
  | "RESOLVED"
  | "COMPLETED"
  | "BLOCKED"
  | "PROMOTED"
  | "ARCHIVED";

export interface WorkingMemoryEntry {
  readonly id: string;
  readonly title: string;
  readonly category: WorkingMemoryCategory | string;
  readonly description: string;
  readonly status: WorkingMemoryStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly horizonDays?: number | undefined;
  readonly expiresAt?: string | undefined;
  readonly milestonesCompleted?: number | undefined;
  readonly totalMilestones?: number | undefined;
  readonly priority?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | undefined;
  readonly openDependencies?: readonly string[] | undefined;
  readonly resolutionSummary?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface AddWorkingMemoryEntryOptions {
  readonly id: string;
  readonly title: string;
  readonly category?: WorkingMemoryCategory | string | undefined;
  readonly description: string;
  readonly status?: WorkingMemoryStatus | undefined;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
  readonly horizonDays?: number | undefined;
  readonly expiresAt?: string | undefined;
  readonly milestonesCompleted?: number | undefined;
  readonly totalMilestones?: number | undefined;
  readonly priority?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | undefined;
  readonly openDependencies?: readonly string[] | undefined;
  readonly resolutionSummary?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface UpdateWorkingMemoryEntryOptions {
  readonly title?: string | undefined;
  readonly category?: WorkingMemoryCategory | string | undefined;
  readonly description?: string | undefined;
  readonly status?: WorkingMemoryStatus | undefined;
  readonly updatedAt?: string | undefined;
  readonly horizonDays?: number | undefined;
  readonly expiresAt?: string | undefined;
  readonly milestonesCompleted?: number | undefined;
  readonly totalMilestones?: number | undefined;
  readonly priority?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | undefined;
  readonly openDependencies?: readonly string[] | undefined;
  readonly resolutionSummary?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface WorkingMemoryFilter {
  readonly category?: WorkingMemoryCategory | string | readonly string[] | undefined;
  readonly status?: WorkingMemoryStatus | readonly WorkingMemoryStatus[] | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly minPriority?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | undefined;
}

// ============================================================================
// Tier 3: Archived Episodic Epics
// ============================================================================

export type EpicArchivalOutcome =
  | "SUCCESS"
  | "PARETO_OPTIMIZED"
  | "SUPERSEDED"
  | "ABANDONED"
  | "COMPLETED";

export interface ArchivedEpicEntry {
  readonly id: string;
  readonly originalWorkingId?: string | undefined;
  readonly title: string;
  readonly category: string;
  readonly summaryAbstract: string;
  readonly keyDecisions: readonly string[];
  readonly artifactsProduced?: readonly string[] | undefined;
  readonly outcome: EpicArchivalOutcome | string;
  readonly archivedAt: string;
  readonly epistemicStatus: EpistemicStatus;
  readonly supersededBy?: string | undefined;
  readonly successorInvariantId?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface AddArchivedEpicOptions {
  readonly id: string;
  readonly originalWorkingId?: string | undefined;
  readonly title: string;
  readonly category?: string | undefined;
  readonly summaryAbstract: string;
  readonly keyDecisions?: readonly string[] | undefined;
  readonly artifactsProduced?: readonly string[] | undefined;
  readonly outcome?: EpicArchivalOutcome | string | undefined;
  readonly archivedAt?: string | undefined;
  readonly epistemicStatus?: EpistemicStatus | undefined;
  readonly supersededBy?: string | undefined;
  readonly successorInvariantId?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface CompactAndArchiveEpicOptions {
  readonly workingEntryId: string;
  readonly summaryAbstract?: string | undefined;
  readonly keyDecisions?: readonly string[] | undefined;
  readonly artifactsProduced?: readonly string[] | undefined;
  readonly outcome?: EpicArchivalOutcome | string | undefined;
  readonly successorInvariantId?: string | undefined;
  readonly supersededBy?: string | undefined;
  readonly removeWorkingEntry?: boolean | undefined;
}

export interface ArchivedEpicFilter {
  readonly category?: string | readonly string[] | undefined;
  readonly outcome?: EpicArchivalOutcome | string | readonly string[] | undefined;
  readonly epistemicStatus?: EpistemicStatus | readonly EpistemicStatus[] | undefined;
  readonly tags?: readonly string[] | undefined;
}

// ============================================================================
// Promotion & Pruning Options / Results
// ============================================================================

export interface PromoteParetoOptions {
  readonly workingEntryId: string;
  readonly invariantId?: string | undefined;
  readonly title?: string | undefined;
  readonly category?: BedrockInvariantCategory | string | undefined;
  readonly statement?: string | undefined;
  readonly rationale?: string | undefined;
  readonly supersedesHistoricalIds?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly archiveWorkingEntry?: boolean | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface PruneWorkingMemoryOptions {
  readonly maxAgeDays?: number | undefined;
  readonly autoArchiveCompleted?: boolean | undefined;
  readonly nowIso?: string | undefined;
  readonly dryRun?: boolean | undefined;
}

export interface PruneResult {
  readonly evaluatedCount: number;
  readonly prunedIds: readonly string[];
  readonly archivedEntries: readonly ArchivedEpicEntry[];
  readonly remainingCount: number;
}

export interface ThreeTierMemorySnapshot {
  readonly version: number;
  readonly snapshotDate: string;
  readonly tier1Invariants: readonly BedrockInvariant[];
  readonly tier2WorkingMemory: readonly WorkingMemoryEntry[];
  readonly tier3ArchivedEpics: readonly ArchivedEpicEntry[];
  readonly supersessionIndex: SupersessionIndexState;
}

// ============================================================================
// Three-Tier Memory Engine
// ============================================================================

export class ThreeTierMemoryEngine {
  private readonly tier1Invariants = new Map<string, BedrockInvariant>();
  private readonly tier2Working = new Map<string, WorkingMemoryEntry>();
  private readonly tier3Archived = new Map<string, ArchivedEpicEntry>();
  private readonly supersessionIndex: SupersessionIndex;

  public constructor(options?: {
    readonly initialInvariants?: readonly BedrockInvariant[];
    readonly initialWorking?: readonly WorkingMemoryEntry[];
    readonly initialArchived?: readonly ArchivedEpicEntry[];
    readonly supersessionIndex?: SupersessionIndex;
  }) {
    this.supersessionIndex = options?.supersessionIndex ?? new SupersessionIndex();

    if (options?.initialInvariants) {
      for (const inv of options.initialInvariants) {
        this.addBedrockInvariant(inv);
      }
    }

    if (options?.initialWorking) {
      for (const entry of options.initialWorking) {
        this.addWorkingEntry(entry);
      }
    }

    if (options?.initialArchived) {
      for (const entry of options.initialArchived) {
        this.addArchivedEntry(entry);
      }
    }
  }

  public getSupersessionIndex(): SupersessionIndex {
    return this.supersessionIndex;
  }

  // --------------------------------------------------------------------------
  // Tier 1 Methods (Bedrock Invariants - IMMUTABLE)
  // --------------------------------------------------------------------------

  /**
   * Adds an immutable Bedrock Invariant to Tier 1.
   * Throws if an invariant with the same ID already exists to guarantee immutability.
   */
  public addBedrockInvariant(
    options: AddBedrockInvariantOptions | BedrockInvariant,
  ): BedrockInvariant {
    const id = options.id.trim();
    if (!id) {
      throw new Error("Bedrock Invariant ID cannot be empty.");
    }

    if (this.tier1Invariants.has(id)) {
      throw new Error(
        `Bedrock Invariant is immutable: cannot overwrite or modify invariant with id '${id}'.`,
      );
    }

    const invariant: BedrockInvariant = {
      id,
      title: options.title.trim() || id,
      category: options.category ?? "AXIOM",
      statement: options.statement.trim(),
      rationale: options.rationale.trim(),
      settledDate: options.settledDate ?? new Date().toISOString(),
      supersedesHistoricalIds: options.supersedesHistoricalIds
        ? [...options.supersedesHistoricalIds]
        : undefined,
      tags: options.tags ? [...options.tags] : undefined,
      metadata: options.metadata,
    };

    this.tier1Invariants.set(id, invariant);

    // Register in supersession index as ACTIVE
    this.supersessionIndex.registerEntry({
      id: invariant.id,
      title: invariant.title,
      status: "ACTIVE",
      supersedes: invariant.supersedesHistoricalIds,
      timestamp: invariant.settledDate,
      metadata: {
        tier: "TIER_1",
        category: invariant.category,
      },
    });

    // If historical IDs are superseded, ensure supersession index links them
    if (invariant.supersedesHistoricalIds && invariant.supersedesHistoricalIds.length > 0) {
      for (const histId of invariant.supersedesHistoricalIds) {
        this.supersessionIndex.markSuperseded(
          histId,
          invariant.id,
          `Superseded by Bedrock Invariant ${invariant.id}`,
          invariant.id,
        );
      }
    }

    return invariant;
  }

  /**
   * Retrieves a Bedrock Invariant by ID.
   */
  public getBedrockInvariant(id: string): BedrockInvariant | undefined {
    return this.tier1Invariants.get(id.trim());
  }

  /**
   * Checks if a Bedrock Invariant exists.
   */
  public hasBedrockInvariant(id: string): boolean {
    return this.tier1Invariants.has(id.trim());
  }

  /**
   * Returns all Tier 1 Bedrock Invariants. Always loaded in full.
   */
  public getBedrockInvariants(): readonly BedrockInvariant[] {
    return Array.from(this.tier1Invariants.values());
  }

  /**
   * Count of Tier 1 invariants.
   */
  public getBedrockInvariantCount(): number {
    return this.tier1Invariants.size;
  }

  // --------------------------------------------------------------------------
  // Tier 2 Methods (Active Strategic Working Memory)
  // --------------------------------------------------------------------------

  /**
   * Adds an entry to Tier 2 Active Strategic Working Memory.
   */
  public addWorkingEntry(
    options: AddWorkingMemoryEntryOptions | WorkingMemoryEntry,
  ): WorkingMemoryEntry {
    const id = options.id.trim();
    if (!id) {
      throw new Error("Working memory entry ID cannot be empty.");
    }

    const nowIso = new Date().toISOString();
    const entry: WorkingMemoryEntry = {
      id,
      title: options.title.trim() || id,
      category: options.category ?? "ACTIVE_EPIC",
      description: options.description.trim(),
      status: options.status ?? "ACTIVE",
      createdAt: options.createdAt ?? nowIso,
      updatedAt: options.updatedAt ?? nowIso,
      horizonDays: options.horizonDays,
      expiresAt: options.expiresAt,
      milestonesCompleted: options.milestonesCompleted,
      totalMilestones: options.totalMilestones,
      priority: options.priority ?? "MEDIUM",
      openDependencies: options.openDependencies ? [...options.openDependencies] : undefined,
      resolutionSummary: options.resolutionSummary,
      tags: options.tags ? [...options.tags] : undefined,
      metadata: options.metadata,
    };

    this.tier2Working.set(id, entry);

    // Register in supersession index as ACTIVE if not already tracked
    if (!this.supersessionIndex.hasEntry(id)) {
      this.supersessionIndex.registerEntry({
        id: entry.id,
        title: entry.title,
        status: "ACTIVE",
        timestamp: entry.createdAt,
        metadata: {
          tier: "TIER_2",
          category: entry.category,
        },
      });
    }

    return entry;
  }

  /**
   * Updates an existing Tier 2 working memory entry.
   */
  public updateWorkingEntry(
    id: string,
    updates: UpdateWorkingMemoryEntryOptions,
  ): WorkingMemoryEntry {
    const trimmedId = id.trim();
    const existing = this.tier2Working.get(trimmedId);
    if (!existing) {
      throw new Error(`Working memory entry not found: '${trimmedId}'.`);
    }

    const nowIso = new Date().toISOString();
    const updated: WorkingMemoryEntry = {
      id: existing.id,
      title: updates.title !== undefined ? updates.title.trim() : existing.title,
      category: updates.category ?? existing.category,
      description:
        updates.description !== undefined ? updates.description.trim() : existing.description,
      status: updates.status ?? existing.status,
      createdAt: existing.createdAt,
      updatedAt: updates.updatedAt ?? nowIso,
      horizonDays: updates.horizonDays !== undefined ? updates.horizonDays : existing.horizonDays,
      expiresAt: updates.expiresAt !== undefined ? updates.expiresAt : existing.expiresAt,
      milestonesCompleted:
        updates.milestonesCompleted !== undefined
          ? updates.milestonesCompleted
          : existing.milestonesCompleted,
      totalMilestones:
        updates.totalMilestones !== undefined ? updates.totalMilestones : existing.totalMilestones,
      priority: updates.priority ?? existing.priority,
      openDependencies:
        updates.openDependencies !== undefined
          ? [...updates.openDependencies]
          : existing.openDependencies,
      resolutionSummary:
        updates.resolutionSummary !== undefined
          ? updates.resolutionSummary
          : existing.resolutionSummary,
      tags: updates.tags !== undefined ? [...updates.tags] : existing.tags,
      metadata: updates.metadata !== undefined ? updates.metadata : existing.metadata,
    };

    this.tier2Working.set(trimmedId, updated);
    return updated;
  }

  /**
   * Retrieves a Tier 2 working memory entry by ID.
   */
  public getWorkingEntry(id: string): WorkingMemoryEntry | undefined {
    return this.tier2Working.get(id.trim());
  }

  /**
   * Deletes a Tier 2 working memory entry.
   */
  public deleteWorkingEntry(id: string): boolean {
    return this.tier2Working.delete(id.trim());
  }

  /**
   * Retrieves filtered Tier 2 working memory entries.
   */
  public getWorkingEntries(filter?: WorkingMemoryFilter): readonly WorkingMemoryEntry[] {
    let entries = Array.from(this.tier2Working.values());

    if (!filter) {
      return entries;
    }

    if (filter.category) {
      const allowedCategories = Array.isArray(filter.category)
        ? filter.category
        : [filter.category];
      entries = entries.filter((e) => allowedCategories.includes(e.category));
    }

    if (filter.status) {
      const allowedStatuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      entries = entries.filter((e) => allowedStatuses.includes(e.status));
    }

    if (filter.tags && filter.tags.length > 0) {
      const requiredTags = new Set(filter.tags.map((t) => t.toLowerCase()));
      entries = entries.filter((e) => {
        if (!e.tags || e.tags.length === 0) return false;
        const entryTags = new Set(e.tags.map((t) => t.toLowerCase()));
        return Array.from(requiredTags).some((t) => entryTags.has(t));
      });
    }

    if (filter.minPriority) {
      const priorityOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
      const minVal = priorityOrder[filter.minPriority] ?? 1;
      entries = entries.filter((e) => {
        const p = e.priority ? priorityOrder[e.priority] : 2;
        return p >= minVal;
      });
    }

    return entries;
  }

  /**
   * Returns count of Tier 2 entries.
   */
  public getWorkingMemoryCount(): number {
    return this.tier2Working.size;
  }

  // --------------------------------------------------------------------------
  // Tier 3 Methods (Archived Episodic Epics)
  // --------------------------------------------------------------------------

  /**
   * Adds an archived epic to Tier 3.
   */
  public addArchivedEntry(options: AddArchivedEpicOptions | ArchivedEpicEntry): ArchivedEpicEntry {
    const id = options.id.trim();
    if (!id) {
      throw new Error("Archived epic ID cannot be empty.");
    }

    const epistemicStatus: EpistemicStatus = options.epistemicStatus ?? "ACTIVE";
    const archivedAt = options.archivedAt ?? new Date().toISOString();

    const archived: ArchivedEpicEntry = {
      id,
      originalWorkingId: options.originalWorkingId,
      title: options.title.trim() || id,
      category: options.category ?? "ARCHIVED_EPIC",
      summaryAbstract: options.summaryAbstract.trim(),
      keyDecisions: options.keyDecisions ? [...options.keyDecisions] : [],
      artifactsProduced: options.artifactsProduced ? [...options.artifactsProduced] : undefined,
      outcome: options.outcome ?? "COMPLETED",
      archivedAt,
      epistemicStatus,
      supersededBy: options.supersededBy,
      successorInvariantId: options.successorInvariantId,
      tags: options.tags ? [...options.tags] : undefined,
      metadata: options.metadata,
    };

    this.tier3Archived.set(id, archived);

    // Register or update in supersession index
    this.supersessionIndex.registerEntry({
      id: archived.id,
      title: archived.title,
      status: epistemicStatus,
      supersededBy: archived.supersededBy,
      successorInvariantId: archived.successorInvariantId,
      timestamp: archived.archivedAt,
      metadata: {
        tier: "TIER_3",
        category: archived.category,
        outcome: archived.outcome,
      },
    });

    return archived;
  }

  /**
   * Retrieves a Tier 3 archived epic by ID.
   */
  public getArchivedEntry(id: string): ArchivedEpicEntry | undefined {
    return this.tier3Archived.get(id.trim());
  }

  /**
   * Retrieves filtered Tier 3 archived epics.
   */
  public getArchivedEntries(filter?: ArchivedEpicFilter): readonly ArchivedEpicEntry[] {
    let entries = Array.from(this.tier3Archived.values());

    if (!filter) {
      return entries;
    }

    if (filter.category) {
      const allowedCategories = Array.isArray(filter.category)
        ? filter.category
        : [filter.category];
      entries = entries.filter((e) => allowedCategories.includes(e.category));
    }

    if (filter.outcome) {
      const allowedOutcomes = Array.isArray(filter.outcome) ? filter.outcome : [filter.outcome];
      entries = entries.filter((e) => allowedOutcomes.includes(e.outcome));
    }

    if (filter.epistemicStatus) {
      const allowedStatuses = Array.isArray(filter.epistemicStatus)
        ? filter.epistemicStatus
        : [filter.epistemicStatus];
      entries = entries.filter((e) => allowedStatuses.includes(e.epistemicStatus));
    }

    if (filter.tags && filter.tags.length > 0) {
      const requiredTags = new Set(filter.tags.map((t) => t.toLowerCase()));
      entries = entries.filter((e) => {
        if (!e.tags || e.tags.length === 0) return false;
        const entryTags = new Set(e.tags.map((t) => t.toLowerCase()));
        return Array.from(requiredTags).some((t) => entryTags.has(t));
      });
    }

    return entries;
  }

  /**
   * Count of Tier 3 archived epics.
   */
  public getArchivedEpicCount(): number {
    return this.tier3Archived.size;
  }

  /**
   * Compacts an active/completed Tier 2 working epic into a Tier 3 archived abstract.
   */
  public compactAndArchiveEpic(options: CompactAndArchiveEpicOptions): ArchivedEpicEntry {
    const workingId = options.workingEntryId.trim();
    const working = this.tier2Working.get(workingId);

    const title = working?.title ?? workingId;
    const summary =
      options.summaryAbstract?.trim() ||
      working?.resolutionSummary?.trim() ||
      working?.description.trim() ||
      `Archived epic summary for ${title}`;

    const decisions =
      options.keyDecisions ?? (working?.resolutionSummary ? [working.resolutionSummary] : []);
    const outcome = options.outcome ?? (working?.status === "RESOLVED" ? "SUCCESS" : "COMPLETED");

    const archivedId = `archive-${workingId}`;
    const epistemicStatus: EpistemicStatus =
      options.supersededBy || options.successorInvariantId ? "SUPERSEDED" : "ACTIVE";

    const archived = this.addArchivedEntry({
      id: archivedId,
      originalWorkingId: workingId,
      title,
      category: working?.category ?? "ARCHIVED_EPIC",
      summaryAbstract: summary,
      keyDecisions: decisions,
      artifactsProduced: options.artifactsProduced,
      outcome,
      epistemicStatus,
      supersededBy: options.supersededBy,
      successorInvariantId: options.successorInvariantId,
      tags: working?.tags,
      metadata: {
        ...working?.metadata,
        compactedFrom: workingId,
      },
    });

    // Link working entry in supersession index
    if (workingId !== archivedId) {
      this.supersessionIndex.markSuperseded(
        workingId,
        archivedId,
        `Compacted into archived epic ${archivedId}`,
        options.successorInvariantId,
      );
    }

    if (options.removeWorkingEntry !== false) {
      this.tier2Working.delete(workingId);
    } else if (working) {
      this.tier2Working.set(workingId, {
        ...working,
        status: "ARCHIVED",
        updatedAt: new Date().toISOString(),
      });
    }

    return archived;
  }

  // --------------------------------------------------------------------------
  // Pareto Resolution Promotion (Tier 2 -> Tier 1)
  // --------------------------------------------------------------------------

  /**
   * Promotes a settled Pareto decision or dialectical resolution from Tier 2 Working Memory
   * directly into a permanent Tier 1 Bedrock Invariant.
   * Updates supersession pointers for historical entries and archives the working entry.
   */
  public promoteParetoResolutionToInvariant(options: PromoteParetoOptions): BedrockInvariant {
    const workingId = options.workingEntryId.trim();
    const working = this.tier2Working.get(workingId);

    const invariantId = options.invariantId?.trim() || `invariant-${workingId}`;
    const title = options.title?.trim() || working?.title || invariantId;
    const category = options.category ?? "SETTLED_PARETO";
    const statement =
      options.statement?.trim() ||
      working?.resolutionSummary?.trim() ||
      working?.description.trim() ||
      title;
    const rationale =
      options.rationale?.trim() ||
      `Promoted from resolved working epic ${workingId} (${working?.title ?? ""})`;

    const historicalIds = options.supersedesHistoricalIds
      ? [...options.supersedesHistoricalIds]
      : [];
    if (workingId && !historicalIds.includes(workingId)) {
      historicalIds.push(workingId);
    }

    // 1. Create or retrieve immutable Bedrock Invariant in Tier 1
    let invariant = this.tier1Invariants.get(invariantId);
    if (!invariant) {
      invariant = this.addBedrockInvariant({
        id: invariantId,
        title,
        category,
        statement,
        rationale,
        supersedesHistoricalIds: historicalIds,
        tags: options.tags ?? working?.tags,
        metadata: {
          ...options.metadata,
          promotedFromWorkingId: workingId,
        },
      });
    } else if (historicalIds.length > 0) {
      for (const histId of historicalIds) {
        this.supersessionIndex.markSuperseded(
          histId,
          invariant.id,
          `Superseded by Bedrock Invariant ${invariant.id}`,
          invariant.id,
        );
      }
    }

    // 2. Compact and archive working memory entry if requested (default: true)
    if (options.archiveWorkingEntry !== false && working) {
      this.compactAndArchiveEpic({
        workingEntryId: workingId,
        summaryAbstract: `[Settled Pareto Promotion] ${statement}`,
        keyDecisions: working.resolutionSummary ? [working.resolutionSummary] : [statement],
        outcome: "PARETO_OPTIMIZED",
        successorInvariantId: invariant.id,
        supersededBy: invariant.id,
        removeWorkingEntry: true,
      });
    } else if (working) {
      this.tier2Working.set(workingId, {
        ...working,
        status: "PROMOTED",
        updatedAt: new Date().toISOString(),
      });
    }

    return invariant;
  }

  // --------------------------------------------------------------------------
  // Pruning & Maintenance
  // --------------------------------------------------------------------------

  /**
   * Prunes aged or completed Tier 2 working memory entries, compacting them to Tier 3.
   */
  public pruneWorkingMemory(options?: PruneWorkingMemoryOptions): PruneResult {
    const maxAgeDays = options?.maxAgeDays ?? 30;
    const autoArchive = options?.autoArchiveCompleted ?? true;
    const now = options?.nowIso ? new Date(options.nowIso) : new Date();
    const dryRun = options?.dryRun ?? false;

    const prunedIds: string[] = [];
    const archivedEntries: ArchivedEpicEntry[] = [];
    const evaluatedEntries = Array.from(this.tier2Working.values());

    for (const entry of evaluatedEntries) {
      let shouldPrune = false;
      let shouldArchive = false;

      // Check explicit status
      if (
        entry.status === "COMPLETED" ||
        entry.status === "RESOLVED" ||
        entry.status === "ARCHIVED" ||
        entry.status === "PROMOTED"
      ) {
        shouldPrune = true;
        shouldArchive = autoArchive;
      }

      // Check expiration date
      if (entry.expiresAt) {
        const exp = new Date(entry.expiresAt);
        if (!isNaN(exp.getTime()) && exp.getTime() <= now.getTime()) {
          shouldPrune = true;
          shouldArchive = autoArchive;
        }
      }

      // Check horizon / age
      if (!shouldPrune && maxAgeDays > 0) {
        const updated = new Date(entry.updatedAt);
        if (!isNaN(updated.getTime())) {
          const ageDays = (now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24);
          if (ageDays > maxAgeDays) {
            shouldPrune = true;
            shouldArchive = autoArchive;
          }
        }
      }

      if (shouldPrune) {
        prunedIds.push(entry.id);
        if (shouldArchive) {
          if (!dryRun) {
            const archived = this.compactAndArchiveEpic({
              workingEntryId: entry.id,
              removeWorkingEntry: true,
            });
            archivedEntries.push(archived);
          } else {
            archivedEntries.push({
              id: `archive-${entry.id}`,
              originalWorkingId: entry.id,
              title: entry.title,
              category: entry.category,
              summaryAbstract: entry.description,
              keyDecisions: entry.resolutionSummary ? [entry.resolutionSummary] : [],
              outcome: entry.status === "RESOLVED" ? "SUCCESS" : "COMPLETED",
              archivedAt: now.toISOString(),
              epistemicStatus: "ACTIVE",
            });
          }
        } else if (!dryRun) {
          this.tier2Working.delete(entry.id);
        }
      }
    }

    const remainingCount = dryRun
      ? this.tier2Working.size - prunedIds.length
      : this.tier2Working.size;

    return {
      evaluatedCount: evaluatedEntries.length,
      prunedIds,
      archivedEntries,
      remainingCount,
    };
  }

  // --------------------------------------------------------------------------
  // Serialization & Deserialization
  // --------------------------------------------------------------------------

  /**
   * Exports full 3-tier memory engine snapshot.
   */
  public exportSnapshot(): ThreeTierMemorySnapshot {
    return {
      version: 1,
      snapshotDate: new Date().toISOString(),
      tier1Invariants: Array.from(this.tier1Invariants.values()),
      tier2WorkingMemory: Array.from(this.tier2Working.values()),
      tier3ArchivedEpics: Array.from(this.tier3Archived.values()),
      supersessionIndex: this.supersessionIndex.exportState(),
    };
  }

  /**
   * Imports snapshot into memory engine.
   */
  public importSnapshot(snapshot: ThreeTierMemorySnapshot): void {
    if (!snapshot) {
      throw new Error("Invalid ThreeTierMemorySnapshot.");
    }

    if (snapshot.supersessionIndex) {
      this.supersessionIndex.importState(snapshot.supersessionIndex);
    }

    if (Array.isArray(snapshot.tier1Invariants)) {
      for (const inv of snapshot.tier1Invariants) {
        if (!this.tier1Invariants.has(inv.id)) {
          this.tier1Invariants.set(inv.id, inv);
        }
      }
    }

    if (Array.isArray(snapshot.tier2WorkingMemory)) {
      for (const entry of snapshot.tier2WorkingMemory) {
        this.tier2Working.set(entry.id, entry);
      }
    }

    if (Array.isArray(snapshot.tier3ArchivedEpics)) {
      for (const entry of snapshot.tier3ArchivedEpics) {
        this.tier3Archived.set(entry.id, entry);
      }
    }
  }

  /**
   * Serializes snapshot to JSON.
   */
  public toJSON(indent = 2): string {
    return JSON.stringify(this.exportSnapshot(), null, indent);
  }

  /**
   * Deserializes memory engine from JSON string.
   */
  public static fromJSON(jsonStr: string): ThreeTierMemoryEngine {
    const snapshot = JSON.parse(jsonStr) as ThreeTierMemorySnapshot;
    return ThreeTierMemoryEngine.fromSnapshot(snapshot);
  }

  /**
   * Instantiates memory engine from a snapshot object.
   */
  public static fromSnapshot(snapshot: ThreeTierMemorySnapshot): ThreeTierMemoryEngine {
    const supersessionIndex = snapshot.supersessionIndex
      ? SupersessionIndex.fromState(snapshot.supersessionIndex)
      : new SupersessionIndex();

    const engine = new ThreeTierMemoryEngine({
      supersessionIndex,
    });

    engine.importSnapshot(snapshot);
    return engine;
  }
}

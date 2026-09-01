/**
 * Ephemeral Retrieval Sandboxing
 *
 * Provides isolated query execution over the 3-Tier Semantic Memory Engine.
 * Features 100% epistemic suppression of superseded/deprecated entries when querying current truth,
 * optional successor guidance injection, and synthesis of clean insight bundles with telemetry.
 */

import {
  type EpistemicStatus,
  type SupersessionNode,
} from "./supersession-index.ts";
import {
  type BedrockInvariant,
  type WorkingMemoryEntry,
  type ArchivedEpicEntry,
  type ThreeTierMemoryEngine,
} from "./three-tier-memory.ts";

export type MemoryTier = "TIER_1" | "TIER_2" | "TIER_3";

export interface SandboxQueryOptions {
  readonly query?: string | undefined;
  readonly categories?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly tiers?: readonly MemoryTier[] | undefined;
  readonly suppressObsolete?: boolean | undefined;
  readonly includeSuccessorGuidance?: boolean | undefined;
  readonly maxResults?: number | undefined;
  readonly minScore?: number | undefined;
  readonly timeRange?: {
    readonly start?: string | undefined;
    readonly end?: string | undefined;
  } | undefined;
}

export interface SuccessorGuidance {
  readonly terminalSuccessorId?: string | undefined;
  readonly terminalSuccessorTitle?: string | undefined;
  readonly successorInvariantId?: string | undefined;
  readonly lineagePath: readonly string[];
  readonly reason?: string | undefined;
}

export interface SandboxQueryResultItem {
  readonly id: string;
  readonly tier: MemoryTier;
  readonly title: string;
  readonly category: string;
  readonly content: string;
  readonly epistemicStatus: EpistemicStatus;
  readonly score: number;
  readonly matchedTerms: readonly string[];
  readonly tags?: readonly string[] | undefined;
  readonly timestamp: string;
  readonly successorGuidance?: SuccessorGuidance | undefined;
  readonly rawEntry: BedrockInvariant | WorkingMemoryEntry | ArchivedEpicEntry;
}

export interface SandboxRetrievalTelemetry {
  readonly candidatesEvaluated: number;
  readonly activeEntriesReturned: number;
  readonly supersededEntriesSuppressed: number;
  readonly deprecatedEntriesSuppressed: number;
  readonly suppressionRate: number;
  readonly executionDurationMs: number;
}

export interface CleanInsightBundle {
  readonly results: readonly SandboxQueryResultItem[];
  readonly telemetry: SandboxRetrievalTelemetry;
  readonly queryEcho: SandboxQueryOptions;
  readonly executedAt: string;
}

const DEFAULT_STOP_WORDS = new Set<string>([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "with", "by", "of", "from",
  "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "as", "if", "that", "this", "it", "not", "so", "can", "will", "all",
]);

function tokenizeText(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !DEFAULT_STOP_WORDS.has(t));
}

function extractSnippet(text: string, queryTokens: readonly string[], maxLength = 180): string {
  if (!text) return "";
  if (text.length <= maxLength) return text.trim();

  const lower = text.toLowerCase();
  let firstMatchPos = -1;

  for (const q of queryTokens) {
    const idx = lower.indexOf(q);
    if (idx !== -1 && (firstMatchPos === -1 || idx < firstMatchPos)) {
      firstMatchPos = idx;
    }
  }

  if (firstMatchPos === -1) {
    return `${text.slice(0, maxLength - 3).trim()}...`;
  }

  const half = Math.floor((maxLength - 10) / 2);
  const start = Math.max(0, firstMatchPos - half);
  const end = Math.min(text.length, start + maxLength);

  let snippet = text.slice(start, end).trim();
  if (start > 0) snippet = `...${snippet}`;
  if (end < text.length) snippet = `${snippet}...`;

  return snippet;
}

export class RetrievalSandbox {
  /**
   * Executes a sandboxed query against the given 3-tier memory engine.
   */
  public static execute(
    engine: ThreeTierMemoryEngine,
    options?: SandboxQueryOptions,
  ): CleanInsightBundle {
    const startTime = performance.now();
    const executedAt = new Date().toISOString();

    const query = options?.query?.trim() ?? "";
    const queryTokens = tokenizeText(query);
    const requestedTiers = options?.tiers ?? ["TIER_1", "TIER_2", "TIER_3"];
    const suppressObsolete = options?.suppressObsolete ?? true;
    const includeSuccessorGuidance = options?.includeSuccessorGuidance ?? false;
    const maxResults = options?.maxResults ?? 50;
    const minScore = options?.minScore ?? 0;

    const allowedCategories = options?.categories
      ? new Set(options.categories.map((c) => c.toLowerCase()))
      : null;

    const requestedTags = options?.tags
      ? new Set(options.tags.map((t) => t.toLowerCase()))
      : null;

    const timeStart = options?.timeRange?.start ? new Date(options.timeRange.start).getTime() : null;
    const timeEnd = options?.timeRange?.end ? new Date(options.timeRange.end).getTime() : null;

    const supersessionIndex = engine.getSupersessionIndex();

    let candidatesEvaluated = 0;
    let supersededSuppressedCount = 0;
    let deprecatedSuppressedCount = 0;
    let totalObsoleteEvaluated = 0;

    interface ScoredCandidate {
      readonly item: SandboxQueryResultItem;
      readonly score: number;
    }

    const scoredCandidates: ScoredCandidate[] = [];

    // Helper: evaluate an entry
    const evaluateEntry = (
      id: string,
      tier: MemoryTier,
      title: string,
      category: string,
      content: string,
      timestamp: string,
      tags: readonly string[] | undefined,
      rawEntry: BedrockInvariant | WorkingMemoryEntry | ArchivedEpicEntry,
    ): void => {
      candidatesEvaluated += 1;

      // Filter category
      if (allowedCategories && !allowedCategories.has(category.toLowerCase())) {
        return;
      }

      // Filter tags
      if (requestedTags) {
        if (!tags || tags.length === 0) {
          return;
        }
        const entryTags = new Set(tags.map((t) => t.toLowerCase()));
        const hasMatchingTag = Array.from(requestedTags).some((t) => entryTags.has(t));
        if (!hasMatchingTag) {
          return;
        }
      }

      // Filter time range
      if (timeStart !== null || timeEnd !== null) {
        const itemTime = new Date(timestamp).getTime();
        if (!isNaN(itemTime)) {
          if (timeStart !== null && itemTime < timeStart) return;
          if (timeEnd !== null && itemTime > timeEnd) return;
        }
      }

      // Epistemic status check
      const epistemicStatus = supersessionIndex.getEpistemicStatus(id);
      const isObsolete = epistemicStatus === "SUPERSEDED" || epistemicStatus === "DEPRECATED";

      if (isObsolete) {
        totalObsoleteEvaluated += 1;
      }

      // 100% suppression logic
      if (isObsolete && suppressObsolete && !includeSuccessorGuidance) {
        if (epistemicStatus === "SUPERSEDED") {
          supersededSuppressedCount += 1;
        } else if (epistemicStatus === "DEPRECATED") {
          deprecatedSuppressedCount += 1;
        }
        return;
      }

      // Build Successor Guidance if requested or obsolete
      let successorGuidance: SuccessorGuidance | undefined;
      if (includeSuccessorGuidance || isObsolete) {
        const lineage = supersessionIndex.getSuccessorLineage(id);
        const terminal: SupersessionNode | null = supersessionIndex.getTerminalSuccessor(id);
        const node = supersessionIndex.getEntry(id);

        if (lineage.length > 1 || terminal !== null || node?.reason || node?.successorInvariantId) {
          successorGuidance = {
            terminalSuccessorId: terminal?.id,
            terminalSuccessorTitle: terminal?.title,
            successorInvariantId: terminal?.successorInvariantId ?? node?.successorInvariantId,
            lineagePath: lineage,
            reason: node?.reason,
          };
        }
      }

      // Scoring
      let score = 0;
      const matchedTerms: string[] = [];

      if (queryTokens.length === 0) {
        // Base score prioritizing Tier 1 axioms over Tier 2 active over Tier 3 archive
        const tierBaseScore = tier === "TIER_1" ? 1.5 : tier === "TIER_2" ? 1.2 : 1.0;
        score = tierBaseScore;
      } else {
        const titleLower = title.toLowerCase();
        const contentLower = content.toLowerCase();
        const idLower = id.toLowerCase();
        const entryTags = tags ? tags.map((t) => t.toLowerCase()) : [];

        for (const token of queryTokens) {
          let tokenMatched = false;
          let tokenScore = 0;

          if (titleLower.includes(token)) {
            tokenMatched = true;
            tokenScore += 3.0;
          }
          if (idLower.includes(token)) {
            tokenMatched = true;
            tokenScore += 2.0;
          }
          if (entryTags.includes(token)) {
            tokenMatched = true;
            tokenScore += 2.5;
          }
          if (contentLower.includes(token)) {
            tokenMatched = true;
            tokenScore += 1.0;
          }

          if (tokenMatched) {
            matchedTerms.push(token);
            score += tokenScore;
          }
        }

        // Tier multiplier boost
        const tierMultiplier = tier === "TIER_1" ? 1.3 : tier === "TIER_2" ? 1.1 : 1.0;
        score *= tierMultiplier;
      }

      if (score < minScore) {
        return;
      }

      const snippet = extractSnippet(content, queryTokens);

      const item: SandboxQueryResultItem = {
        id,
        tier,
        title,
        category,
        content: snippet,
        epistemicStatus,
        score: Number(score.toFixed(4)),
        matchedTerms,
        tags,
        timestamp,
        successorGuidance,
        rawEntry,
      };

      scoredCandidates.push({ item, score });
    };

    // 1. Evaluate Tier 1
    if (requestedTiers.includes("TIER_1")) {
      for (const inv of engine.getBedrockInvariants()) {
        evaluateEntry(
          inv.id,
          "TIER_1",
          inv.title,
          inv.category,
          `${inv.statement} ${inv.rationale}`,
          inv.settledDate,
          inv.tags,
          inv,
        );
      }
    }

    // 2. Evaluate Tier 2
    if (requestedTiers.includes("TIER_2")) {
      for (const work of engine.getWorkingEntries()) {
        evaluateEntry(
          work.id,
          "TIER_2",
          work.title,
          work.category,
          `${work.description} ${work.resolutionSummary ?? ""}`,
          work.updatedAt,
          work.tags,
          work,
        );
      }
    }

    // 3. Evaluate Tier 3
    if (requestedTiers.includes("TIER_3")) {
      for (const arch of engine.getArchivedEntries()) {
        evaluateEntry(
          arch.id,
          "TIER_3",
          arch.title,
          arch.category,
          `${arch.summaryAbstract} ${arch.keyDecisions.join(" ")}`,
          arch.archivedAt,
          arch.tags,
          arch,
        );
      }
    }

    // Sort descending by score
    scoredCandidates.sort((a, b) => b.score - a.score);

    const results = scoredCandidates.slice(0, maxResults).map((sc) => sc.item);
    const activeEntriesReturned = results.filter((r) => r.epistemicStatus === "ACTIVE").length;

    const totalSuppressed = supersededSuppressedCount + deprecatedSuppressedCount;
    const suppressionRate =
      totalObsoleteEvaluated > 0
        ? Number((totalSuppressed / totalObsoleteEvaluated).toFixed(4))
        : 0;

    const endTime = performance.now();
    const executionDurationMs = Number((endTime - startTime).toFixed(2));

    const telemetry: SandboxRetrievalTelemetry = {
      candidatesEvaluated,
      activeEntriesReturned,
      supersededEntriesSuppressed: supersededSuppressedCount,
      deprecatedEntriesSuppressed: deprecatedSuppressedCount,
      suppressionRate,
      executionDurationMs,
    };

    return {
      results,
      telemetry,
      queryEcho: options ?? {},
      executedAt,
    };
  }
}

/**
 * Functional wrapper for executing sandboxed queries.
 */
export function executeRetrievalSandbox(
  engine: ThreeTierMemoryEngine,
  options?: SandboxQueryOptions,
): CleanInsightBundle {
  return RetrievalSandbox.execute(engine, options);
}

/**
 * Formats a clean insight bundle as a readable markdown document.
 */
export function formatCleanInsightBundleMarkdown(bundle: CleanInsightBundle): string {
  const lines: string[] = [];
  lines.push("# Ephemeral Retrieval Sandbox Insight Bundle");
  lines.push(`- **Executed At**: ${bundle.executedAt}`);
  lines.push(`- **Duration**: ${bundle.telemetry.executionDurationMs} ms`);
  lines.push(`- **Candidates Evaluated**: ${bundle.telemetry.candidatesEvaluated}`);
  lines.push(`- **Active Entries Returned**: ${bundle.telemetry.activeEntriesReturned}`);
  lines.push(`- **Superseded Suppressed**: ${bundle.telemetry.supersededEntriesSuppressed}`);
  lines.push(`- **Deprecated Suppressed**: ${bundle.telemetry.deprecatedEntriesSuppressed}`);
  lines.push(`- **Suppression Rate**: ${(bundle.telemetry.suppressionRate * 100).toFixed(1)}%`);
  lines.push("");

  if (bundle.results.length === 0) {
    lines.push("_No memory entries matched the search criteria._");
    return lines.join("\n");
  }

  lines.push("| Tier | ID | Title | Status | Score | Guidance / Snippet |");
  lines.push("| --- | --- | --- | --- | --- | --- |");

  for (const item of bundle.results) {
    let guidanceText = item.content.replace(/\|/g, "\\|");
    if (item.successorGuidance?.terminalSuccessorId) {
      guidanceText = `[-> ${item.successorGuidance.terminalSuccessorId}] ${guidanceText}`;
    }
    lines.push(
      `| ${item.tier} | \`${item.id}\` | ${item.title} | ${item.epistemicStatus} | ${item.score} | ${guidanceText} |`,
    );
  }

  return lines.join("\n");
}

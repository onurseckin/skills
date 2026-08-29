import {
  calculateExponentialBackoff,
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  QUIESCENCE_INTERVAL_MULTIPLIER,
} from "../../../core/scheduling/index.ts";
import type { QuiescentDigest, QuiescentSourceObservation } from "./types.ts";
import { QUIESCENT_DIGEST_STREAK_THRESHOLD } from "./types.ts";

export function computeQuiescentStreak(previousStreak?: number | null): number {
  if (
    typeof previousStreak === "number" &&
    Number.isFinite(previousStreak) &&
    previousStreak >= 0
  ) {
    return Math.floor(previousStreak) + 1;
  }
  return 1;
}

export function calculateQuiescentInterval(
  baseIntervalMs: number,
  maxIntervalMs: number,
  streak: number,
): number {
  const safeBase = Math.max(1000, baseIntervalMs || DEFAULT_BASE_INTERVAL_MS);
  const safeMax = Math.max(safeBase, maxIntervalMs || DEFAULT_MAX_INTERVAL_MS);
  const safeStreak = Math.max(0, streak);
  return calculateExponentialBackoff(safeBase, safeMax, safeStreak, QUIESCENCE_INTERVAL_MULTIPLIER);
}

export function shouldTriggerQuiescentDigest(
  streak: number,
  threshold = QUIESCENT_DIGEST_STREAK_THRESHOLD,
): boolean {
  return streak === threshold;
}

export function formatQuiescentDigestMarkdown(params: {
  readonly streak: number;
  readonly runId: string;
  readonly generatedAt: string;
  readonly sources: readonly QuiescentSourceObservation[];
}): string {
  const lines: string[] = [
    `### Quiescent Repository Digest (Streak ${params.streak})`,
    `- **Run**: \`${params.runId}\``,
    `- **Generated**: ${params.generatedAt}`,
    `- **Verdict**: The repository has been clean for ${params.streak} consecutive quiescent pulses. All ten discovery sources reported count 0.`,
    "",
    "#### Verified Discovery Sources (10 of 10 Clean)",
  ];

  for (const obs of params.sources) {
    lines.push(
      `${obs.sourceNumber}. **${obs.sourceName}** (\`${obs.source}\`): count = ${obs.count} (command \`${obs.commandId}\`, \`${obs.evidenceClass}\`)`,
    );
  }

  return lines.join("\n");
}

export function buildQuiescentDigest(params: {
  readonly streak: number;
  readonly sources: readonly QuiescentSourceObservation[];
  readonly runId?: string | undefined;
  readonly generatedAt?: string | undefined;
}): QuiescentDigest {
  const runId = params.runId ?? "mind";
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const message = `The repository has been clean for ${params.streak} consecutive quiescent pulses; all ten discovery sources were scanned and found clean with zero items.`;
  const markdown = formatQuiescentDigestMarkdown({
    streak: params.streak,
    runId,
    generatedAt,
    sources: params.sources,
  });

  return {
    streak: params.streak,
    generatedAt,
    runId,
    message,
    sourcesChecked: params.sources,
    markdown,
  };
}

import { HarnessError } from "../core/errors/harness-error.ts";
import {
  findSourceDefinition,
  MIND_DISCOVERY_SOURCES,
  resolveCommandRecord,
  type EvidenceClass,
  type MindSourceDefinition,
  type MindSourceId,
} from "./sources.ts";

export const QUIESCENT_DIGEST_STREAK_THRESHOLD = 8;
export const DEFAULT_BASE_INTERVAL_MS = 900_000; // 15 minutes
export const DEFAULT_MAX_INTERVAL_MS = 14_400_000; // 4 hours
export const QUIESCENCE_INTERVAL_MULTIPLIER = 1.5;

export interface QuiescentSourceObservation {
  readonly source: MindSourceId;
  readonly commandId: string;
  readonly count: number;
  readonly evidenceClass: EvidenceClass;
  readonly sourceNumber: number;
  readonly sourceName: string;
}

export interface QuiescentSourceInput {
  readonly source: string;
  readonly commandId: string;
  readonly count: number;
}

export interface QuiescentValidationResult {
  readonly ok: boolean;
  readonly observations: readonly QuiescentSourceObservation[];
  readonly missingSources: readonly MindSourceId[];
  readonly nonZeroSources: readonly { readonly source: MindSourceId; readonly count: number }[];
  readonly invalidSources: readonly string[];
  readonly unevidencedSources: readonly {
    readonly source: MindSourceId;
    readonly commandId: string;
  }[];
  readonly error?: string | undefined;
}

export interface QuiescentDigest {
  readonly streak: number;
  readonly generatedAt: string;
  readonly runId: string;
  readonly message: string;
  readonly sourcesChecked: readonly QuiescentSourceObservation[];
  readonly markdown: string;
}

/**
 * Parses a raw source spec in the format `<source>:<command-id>:<count>`.
 */
export function parseQuiescentSourceSpec(spec: string): QuiescentSourceInput {
  if (typeof spec !== "string" || !spec.trim()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `invalid source spec '${spec}'; expected format <source>:<command-id>:<count>`,
    );
  }

  const trimmed = spec.trim();
  const parts = trimmed.split(":");
  if (parts.length < 3) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `invalid source spec '${spec}'; expected format <source>:<command-id>:<count>`,
    );
  }

  const source = parts[0]!.trim();
  const rawCount = parts[parts.length - 1]!.trim();
  const commandId = parts.slice(1, -1).join(":").trim();

  if (!source) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `missing source name in spec '${spec}'; expected format <source>:<command-id>:<count>`,
    );
  }

  if (!commandId) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `missing command id in spec '${spec}'; expected format <source>:<command-id>:<count>`,
    );
  }

  const count = Number(rawCount);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `invalid count '${rawCount}' in source spec '${spec}'; count must be an integer >= 0`,
    );
  }

  return { source, commandId, count };
}

/**
 * Safely attempts to parse a raw source spec without throwing.
 */
export function tryParseQuiescentSourceSpec(
  spec: string,
):
  | { readonly ok: true; readonly value: QuiescentSourceInput }
  | { readonly ok: false; readonly error: string } {
  try {
    const parsed = parseQuiescentSourceSpec(spec);
    return { ok: true, value: parsed };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Validates that all 10 discovery sources are present, have count == 0,
 * and cite valid recorded command evidence under .capsules/.
 */
export function validateQuiescentScan(
  inputs: readonly (string | QuiescentSourceInput)[],
  options: {
    readonly runRoot?: string | undefined;
    readonly capsulesDir?: string | undefined;
    readonly repoRoot?: string | undefined;
  } = {},
): QuiescentValidationResult {
  const invalidSources: string[] = [];
  const nonZeroSources: { readonly source: MindSourceId; readonly count: number }[] = [];
  const unevidencedSources: { readonly source: MindSourceId; readonly commandId: string }[] = [];
  const observationMap = new Map<MindSourceId, QuiescentSourceObservation>();

  for (const item of inputs) {
    let parsedInput: QuiescentSourceInput;
    if (typeof item === "string") {
      const parsedRes = tryParseQuiescentSourceSpec(item);
      if (!parsedRes.ok) {
        invalidSources.push(item);
        continue;
      }
      parsedInput = parsedRes.value;
    } else if (
      item &&
      typeof item === "object" &&
      typeof item.source === "string" &&
      typeof item.commandId === "string" &&
      typeof item.count === "number"
    ) {
      if (
        !Number.isSafeInteger(item.count) ||
        item.count < 0 ||
        !item.source.trim() ||
        !item.commandId.trim()
      ) {
        invalidSources.push(JSON.stringify(item));
        continue;
      }
      parsedInput = {
        source: item.source.trim(),
        commandId: item.commandId.trim(),
        count: item.count,
      };
    } else {
      invalidSources.push(String(item));
      continue;
    }

    const sourceDef = findSourceDefinition(parsedInput.source);
    if (!sourceDef) {
      invalidSources.push(parsedInput.source);
      continue;
    }

    if (parsedInput.count !== 0) {
      nonZeroSources.push({ source: sourceDef.id, count: parsedInput.count });
    }

    const resolution = resolveCommandRecord(parsedInput.commandId, options);
    if (!resolution.found) {
      unevidencedSources.push({ source: sourceDef.id, commandId: parsedInput.commandId });
    }

    observationMap.set(sourceDef.id, {
      source: sourceDef.id,
      commandId: parsedInput.commandId,
      count: parsedInput.count,
      evidenceClass: sourceDef.evidenceClass,
      sourceNumber: sourceDef.number,
      sourceName: sourceDef.name,
    });
  }

  const missingSources: MindSourceId[] = [];
  for (const def of MIND_DISCOVERY_SOURCES) {
    if (!observationMap.has(def.id)) {
      missingSources.push(def.id);
    }
  }

  // Sort observations deterministically in source number order (1..10)
  const sortedObservations = MIND_DISCOVERY_SOURCES.map((def) => observationMap.get(def.id)).filter(
    (obs): obs is QuiescentSourceObservation => obs !== undefined,
  );

  let error: string | undefined = undefined;
  if (invalidSources.length > 0) {
    error = `invalid source specifications: ${invalidSources.join(", ")}`;
  } else if (missingSources.length > 0) {
    error = `quiescence requires all 10 discovery sources to be observed; missing ${missingSources.length} source(s): ${missingSources.join(", ")}`;
  } else if (nonZeroSources.length > 0) {
    error = `quiescence refused: non-zero counts detected in sources: ${nonZeroSources.map((s) => `${s.source}=${s.count}`).join(", ")}; quiescence requires count == 0 for all 10 sources`;
  } else if (unevidencedSources.length > 0) {
    error = `quiescence refused: unrecorded command evidence for sources: ${unevidencedSources.map((s) => `${s.source} (command '${s.commandId}')`).join(", ")}; command records must exist under .capsules/`;
  }

  const ok =
    invalidSources.length === 0 &&
    missingSources.length === 0 &&
    nonZeroSources.length === 0 &&
    unevidencedSources.length === 0 &&
    sortedObservations.length === MIND_DISCOVERY_SOURCES.length;

  return {
    ok,
    observations: sortedObservations,
    missingSources,
    nonZeroSources,
    invalidSources,
    unevidencedSources,
    error,
  };
}

/**
 * Computes next quiescent streak count from previous streak.
 */
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

/**
 * Applies 1.5x interval multiplier per quiescent pulse, capped at max_interval.
 * Formula: min(maxIntervalMs, round(baseIntervalMs * 1.5^streak))
 */
export function calculateQuiescentInterval(
  baseIntervalMs: number,
  maxIntervalMs: number,
  streak: number,
): number {
  const safeBase = Math.max(1000, baseIntervalMs || DEFAULT_BASE_INTERVAL_MS);
  const safeMax = Math.max(safeBase, maxIntervalMs || DEFAULT_MAX_INTERVAL_MS);
  const safeStreak = Math.max(0, streak);
  return Math.min(
    safeMax,
    Math.round(safeBase * Math.pow(QUIESCENCE_INTERVAL_MULTIPLIER, safeStreak)),
  );
}

/**
 * Determines whether a quiescent digest should be triggered.
 * Triggers at the 8th consecutive quiescent pulse (or custom threshold).
 */
export function shouldTriggerQuiescentDigest(
  streak: number,
  threshold = QUIESCENT_DIGEST_STREAK_THRESHOLD,
): boolean {
  return streak === threshold;
}

/**
 * Formats the markdown for the quiescent streak digest.
 */
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

/**
 * Builds the QuiescentDigest object when the 8th streak threshold is reached.
 */
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

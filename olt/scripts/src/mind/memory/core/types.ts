import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { enforceLineLimit } from "../../../cli/formatters/line-limiter.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { parseCharter, resolveCharterPath } from "../../lifecycle/charter/index.ts";

export type MemoryKind = "capsule" | "defect" | "decision" | "charter" | "report";

export const MEMORY_KINDS: readonly MemoryKind[] = [
  "capsule",
  "defect",
  "decision",
  "charter",
  "report",
];

export interface MemoryDocument {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly title: string;
  readonly capsule_id: string | null;
  readonly generation?: number | null | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly source_path: string;
  readonly snippet: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly tokens: readonly string[];
  readonly token_counts: Readonly<Record<string, number>>;
  readonly length: number;
}

export interface MemoryQueryResult {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly title: string;
  readonly capsule_id: string | null;
  readonly generation?: number | null | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly source_path: string;
  readonly score: number;
  readonly snippet: string;
  readonly matched_terms: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface MemoryIndex {
  readonly documents: readonly MemoryDocument[];
  readonly total_documents: number;
  readonly avg_doc_length: number;
  readonly idf: ReadonlyMap<string, number>;
  readonly postings: ReadonlyMap<string, readonly { docIndex: number; tf: number }[]>;
}

export interface MemorySearchOptions {
  readonly query?: string | undefined;
  readonly kind?: MemoryKind | readonly MemoryKind[] | "all" | string | undefined;
  readonly capsule?: string | readonly string[] | undefined;
  readonly generation?: number | readonly number[] | string | undefined;
  readonly tags?: string | readonly string[] | undefined;
  readonly tag?: string | readonly string[] | undefined;
  readonly pattern?: string | RegExp | undefined;
  readonly minScore?: number | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface IndexMemoryOptions {
  readonly repoRoot?: string | undefined;
  readonly capsulesDir?: string | undefined;
  readonly runRoot?: string | undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const COMMON_STOP_WORDS = new Set<string>([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "with",
  "by",
  "of",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "as",
  "which",
  "who",
  "whom",
]);

/**
 * Tokenizes text into normalized alphanumeric keywords while preserving domain identifiers.
 */
export function tokenize(text: string): string[] {
  if (typeof text !== "string" || !text.trim()) {
    return [];
  }

  const rawTokens = text.toLowerCase().split(/[^a-z0-9_-]+/);
  const result: string[] = [];

  for (let i = 0; i < rawTokens.length; i += 1) {
    const raw = rawTokens[i];
    if (raw === undefined) continue;
    const token = raw.replace(/^[-_]+|[-_]+$/g, "");
    if (!token) continue;

    // Sub-tokenize hyphenated and underscored terms (e.g., mind-gen-6 -> mind, gen, 6)
    if (token.includes("-") || token.includes("_")) {
      if (!COMMON_STOP_WORDS.has(token) && token.length >= 2) {
        result.push(token);
      }
      const parts = token.split(/[-_]+/);
      for (let j = 0; j < parts.length; j += 1) {
        const part = parts[j];
        if (part !== undefined && part.length >= 1 && !COMMON_STOP_WORDS.has(part)) {
          result.push(part);
        }
      }
    } else {
      if (!COMMON_STOP_WORDS.has(token) && (token.length >= 2 || /^[0-9a-z]$/.test(token))) {
        result.push(token);
      }
    }
  }

  return result;
}

/**
 * Counts token frequencies for a given list of tokens.
 */
export function countTokens(tokens: readonly string[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t !== undefined) {
      counts[t] = (counts[t] !== undefined ? counts[t] : 0) + 1;
    }
  }
  return counts;
}

/**
 * Extracts generation number from a capsule directory name (e.g., mind-gen-1 -> 1, run-p87-gen5-... -> 5).
 */
export function extractGenerationFromCapsuleId(
  capsuleId: string | null | undefined,
): number | null {
  if (typeof capsuleId !== "string" || !capsuleId.trim()) return null;
  const match = capsuleId.match(/(?:gen|generation)[-_]?(\d+)/i);
  if (match && match[1]) {
    const num = Number.parseInt(match[1], 10);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

/**
 * Extracts generation number from an item record or falls back to capsule derivation.
 */
export function extractGeneration(
  item: Record<string, unknown>,
  fallbackCapsuleId?: string | null,
): number | null {
  if (typeof item["generation"] === "number" && Number.isFinite(item["generation"])) {
    return item["generation"];
  }
  if (typeof item["generation"] === "string") {
    const num = Number.parseInt(item["generation"], 10);
    if (Number.isFinite(num)) return num;
  }
  if (typeof item["generation_id"] === "number" && Number.isFinite(item["generation_id"])) {
    return item["generation_id"];
  }
  if (typeof item["generation_id"] === "string") {
    const match = item["generation_id"].match(/(?:gen|generation)[-_]?(\d+)/i);
    if (match && match[1]) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  if (typeof item["metadata"] === "object" && item["metadata"] !== null) {
    const metaGen = (item["metadata"] as Record<string, unknown>)["generation"];
    if (typeof metaGen === "number" && Number.isFinite(metaGen)) {
      return metaGen;
    }
  }
  if (typeof item["capsule"] === "string") {
    const fromCap = extractGenerationFromCapsuleId(item["capsule"]);
    if (fromCap !== null) return fromCap;
  }
  if (fallbackCapsuleId) {
    const fromFallback = extractGenerationFromCapsuleId(fallbackCapsuleId);
    if (fromFallback !== null) return fromFallback;
  }
  return null;
}

/**
 * Normalizes tags into an array of lowercase, trimmed, unique tag strings.
 */

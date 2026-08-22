import { createHash } from "node:crypto";
import { categorizeBlunder } from "../mind/blunders.ts";
import type {
  BlunderCategory,
  BlunderKeyOptions,
  BlunderRecordInput,
  ContentHashAlgorithm,
} from "./types.ts";

/**
 * Normalizes an observation or error message into a canonical signature
 * by stripping volatile runtime tokens (ISO timestamps, hex hashes, memory addresses, PIDs, line numbers, capsule paths).
 */
export function normalizeObservationSignature(observation: string): string {
  if (typeof observation !== "string") {
    return "";
  }
  return observation
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/gi, "<TIME>")
    .replace(/0x[0-9a-fA-F]{6,16}\b/g, "<ADDR>")
    .replace(/\b[0-9a-f]{16,64}\b/gi, "<HASH>")
    .replace(/\b(pid|ppid)[=:\s]+\d+\b/gi, "$1=<PID>")
    .replace(/\b(line|row|col|column)[=:\s]+\d+\b/gi, "$1=<NUM>")
    .replace(/blunder-\d+-[a-z0-9]+/gi, "blunder-<ID>")
    .replace(/(?:\/[a-zA-Z0-9._-]+)*\/\.capsules\/[a-zA-Z0-9._-]+/g, "<CAPSULE_PATH>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Computes a deterministic 32-bit FNV-1a hash formatted as an 8-character hex string.
 */
export function createFnv1aHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Computes a SHA-256 hash using Node's crypto module.
 */
export function createSha256Hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Computes a deterministic content hash for a blunder record.
 */
export function createBlunderContentHash(
  input: BlunderRecordInput,
  algorithm: ContentHashAlgorithm = "sha256",
): string {
  const category =
    typeof input.category === "string" && input.category.trim()
      ? input.category.trim().toLowerCase()
      : categorizeBlunder(input as unknown as Record<string, unknown>);

  const type =
    typeof input.type === "string" && input.type.trim()
      ? input.type.trim().toLowerCase()
      : "unspecified";

  const rawObservation =
    typeof input.observation === "string" && input.observation.trim()
      ? input.observation.trim()
      : typeof input.message === "string" && input.message.trim()
        ? input.message.trim()
        : "";

  const sig = normalizeObservationSignature(rawObservation);
  const rawAgentId = input.agent_id ?? (input.role ? `role:${input.role}` : "unbound");
  const payload = `${category}|${type}|${rawAgentId}|${sig}`;

  if (algorithm === "fnv1a") {
    return createFnv1aHash(payload);
  }
  return createSha256Hash(payload);
}

/**
 * Computes a deterministic discriminator / deduplication key for a blunder record.
 */
export function computeBlunderDiscriminator(
  blunder: BlunderRecordInput,
  options: BlunderKeyOptions = {},
): string {
  if (options.customDiscriminator) {
    return options.customDiscriminator(blunder);
  }

  if (typeof blunder.dedup_key === "string" && blunder.dedup_key.trim().length > 0) {
    return blunder.dedup_key.trim();
  }

  const category: BlunderCategory | "any" =
    options.includeCategory === false
      ? "any"
      : typeof blunder.category === "string" && blunder.category.trim()
        ? (blunder.category.trim().toLowerCase() as BlunderCategory)
        : categorizeBlunder(blunder as unknown as Record<string, unknown>);

  const type =
    options.includeType === false
      ? "any"
      : typeof blunder.type === "string" && blunder.type.trim()
        ? blunder.type.trim().toLowerCase()
        : "unspecified";

  const rawAgentId = blunder.agent_id ?? (blunder.role ? `role:${blunder.role}` : null);
  const agentId =
    options.includeAgentId === false
      ? "all"
      : typeof rawAgentId === "string" && rawAgentId.trim()
        ? rawAgentId.trim().toLowerCase()
        : "unbound";

  const rawObservation =
    typeof blunder.observation === "string" && blunder.observation.trim()
      ? blunder.observation.trim()
      : typeof blunder.message === "string" && blunder.message.trim()
        ? blunder.message.trim()
        : "";

  const obsSig =
    options.normalizeObservation === false
      ? rawObservation.trim().toLowerCase()
      : normalizeObservationSignature(rawObservation);

  if (options.useContentHash) {
    const hash = createBlunderContentHash(
      blunder,
      options.hashAlgorithm ? options.hashAlgorithm : "sha256",
    );
    return `${category}::${type}::${agentId}::${hash}`;
  }

  return `${category}::${type}::${agentId}::${obsSig}`;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "he",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "that",
  "the",
  "to",
  "was",
  "were",
  "will",
  "with",
]);

/**
 * Extracts non-trivial tokens/keywords from a blunder observation for semantic comparison.
 */
export function extractBlunderKeywords(text: string): readonly string[] {
  if (typeof text !== "string") return [];
  const cleaned = text.toLowerCase().replace(/[^a-z0-9_\-\s]/g, " ");
  const tokens = cleaned
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  return Array.from(new Set(tokens));
}

/**
 * Calculates token-based Jaccard similarity score (0.0 to 1.0) between two blunder signatures.
 */
export function calculateBlunderSimilarity(sigA: string, sigB: string): number {
  const tokensA = new Set(extractBlunderKeywords(sigA));
  const tokensB = new Set(extractBlunderKeywords(sigB));

  if (tokensA.size === 0 && tokensB.size === 0) {
    return 1.0;
  }
  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0.0;
  }

  let intersectionCount = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) {
      intersectionCount += 1;
    }
  }

  const unionSize = tokensA.size + tokensB.size - intersectionCount;
  return unionSize > 0 ? intersectionCount / unionSize : 0;
}

import { createHash } from "node:crypto";
import { categorizeDefect } from "../mind/defects.ts";
import type {
  DefectCategory,
  DefectKeyOptions,
  DefectRecordInput,
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
    .replace(/defect-\d+-[a-z0-9]+/gi, "defect-<ID>")
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
 * Computes a deterministic content hash for a defect record.
 */
export function createDefectContentHash(
  input: DefectRecordInput,
  algorithm: ContentHashAlgorithm = "sha256",
): string {
  const category =
    typeof input.category === "string" && input.category.trim()
      ? input.category.trim().toLowerCase()
      : categorizeDefect(input as unknown as Record<string, unknown>);

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
 * Computes a deterministic discriminator / deduplication key for a defect record.
 */
export function computeDefectDiscriminator(
  defect: DefectRecordInput,
  options: DefectKeyOptions = {},
): string {
  if (options.customDiscriminator) {
    return options.customDiscriminator(defect);
  }

  if (typeof defect.dedup_key === "string" && defect.dedup_key.trim().length > 0) {
    return defect.dedup_key.trim();
  }

  const category: DefectCategory | "any" =
    options.includeCategory === false
      ? "any"
      : typeof defect.category === "string" && defect.category.trim()
        ? (defect.category.trim().toLowerCase() as DefectCategory)
        : categorizeDefect(defect as unknown as Record<string, unknown>);

  const type =
    options.includeType === false
      ? "any"
      : typeof defect.type === "string" && defect.type.trim()
        ? defect.type.trim().toLowerCase()
        : "unspecified";

  const rawAgentId = defect.agent_id ?? (defect.role ? `role:${defect.role}` : null);
  const agentId =
    options.includeAgentId === false
      ? "all"
      : typeof rawAgentId === "string" && rawAgentId.trim()
        ? rawAgentId.trim().toLowerCase()
        : "unbound";

  const rawObservation =
    typeof defect.observation === "string" && defect.observation.trim()
      ? defect.observation.trim()
      : typeof defect.message === "string" && defect.message.trim()
        ? defect.message.trim()
        : "";

  const obsSig =
    options.normalizeObservation === false
      ? rawObservation.trim().toLowerCase()
      : normalizeObservationSignature(rawObservation);

  if (options.useContentHash) {
    const hash = createDefectContentHash(
      defect,
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
 * Extracts non-trivial tokens/keywords from a defect observation for semantic comparison.
 */
export function extractDefectKeywords(text: string): readonly string[] {
  if (typeof text !== "string") return [];
  const cleaned = text.toLowerCase().replace(/[^a-z0-9_\-\s]/g, " ");
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  return Array.from(new Set(tokens));
}

/**
 * Calculates token-based Jaccard similarity score (0.0 to 1.0) between two defect signatures.
 */
export function calculateDefectSimilarity(sigA: string, sigB: string): number {
  const tokensA = new Set(extractDefectKeywords(sigA));
  const tokensB = new Set(extractDefectKeywords(sigB));

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

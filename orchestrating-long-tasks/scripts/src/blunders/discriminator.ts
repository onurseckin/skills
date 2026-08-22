import { categorizeBlunder } from "../mind/blunders.ts";
import type { BlunderKeyOptions, BlunderRecordInput } from "./types.ts";

/**
 * Normalizes an observation or error message into a canonical signature
 * by stripping volatile runtime tokens (ISO timestamps, hex hashes, memory addresses, PIDs).
 */
export function normalizeObservationSignature(observation: string): string {
  if (typeof observation !== "string") {
    return "";
  }
  return observation
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/gi, "<TIME>")
    .replace(/\b[0-9a-f]{16,64}\b/gi, "<HASH>")
    .replace(/\b(pid|ppid)[=:\s]+\d+\b/gi, "$1=<PID>")
    .replace(/\b(line|row|col|column)[=:\s]+\d+\b/gi, "$1=<NUM>")
    .replace(/blunder-\d+-[a-z0-9]+/gi, "blunder-<ID>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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

  const category =
    options.includeCategory === false
      ? "any"
      : typeof blunder.category === "string" && blunder.category.trim()
        ? blunder.category.trim().toLowerCase()
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

  return `${category}::${type}::${agentId}::${obsSig}`;
}

import { createHash } from "node:crypto";
import type { DefectCategory, DefectKeyOptions, DefectRecordInput } from "./types.ts";

export function normalizeObservationSignature(observation?: string): string {
  if (!observation || typeof observation !== "string") return "";
  let normalized = observation.toLowerCase().trim();
  normalized = normalized.replace(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z?/gi, "<time>");
  normalized = normalized.replace(/\b[0-9a-fA-F]{16,64}\b/g, "<hash>");
  normalized = normalized.replace(/0x[0-9a-fA-F]+/g, "<addr>");
  normalized = normalized.replace(/pid\s*[:=]?\s*\d+/gi, "pid=<pid>");
  normalized = normalized.replace(/line\s*[:=]?\s*\d+/gi, "line=<num>");
  normalized = normalized.replace(/(?:\/[^/\s]+)*\/\.capsules\/[^\s/]+/g, "<capsule_path>");
  normalized = normalized.replace(/defect-\d+-[a-zA-Z0-9]+/g, "defect-<id>");
  normalized = normalized.replace(/\s+/g, " ");
  return normalized;
}

export function createFnv1aHash(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createSha256Hash(str: string): string {
  return createHash("sha256").update(str).digest("hex");
}

export function createDefectContentHash(
  defect: DefectRecordInput,
  algorithm: "fnv1a" | "sha256" = "sha256",
): string {
  const cat = defect.category || (defect.role ? `role:${defect.role}` : "");
  const typ = defect.type || defect.message || "";
  const obs = normalizeObservationSignature(defect.observation || defect.message || "");
  const content = `${cat}::${typ}::${obs}`;
  return algorithm === "fnv1a" ? createFnv1aHash(content) : createSha256Hash(content);
}

export function computeDefectDiscriminator(
  defect: DefectRecordInput,
  options: DefectKeyOptions = {},
): string {
  if (defect.dedup_key && !options.customDiscriminator) {
    return defect.dedup_key;
  }
  if (options.customDiscriminator) {
    return options.customDiscriminator(defect);
  }

  const category = options.includeCategory === false
    ? "any"
    : (defect.category || "code_defect").toLowerCase().trim();
  const type = options.includeType === false ? "any" : (defect.type || "unknown_defect").toLowerCase().trim();
  
  let agentId = "all";
  if (options.includeAgentId !== false) {
    if (defect.agent_id) {
      agentId = defect.agent_id.toLowerCase().trim();
    } else if (defect.role) {
      agentId = `role:${defect.role}`.toLowerCase().trim();
    }
  }

  if (options.useContentHash) {
    const hash = createDefectContentHash(defect, options.hashAlgorithm || "fnv1a");
    return `${category}::${type}::${agentId}::${hash}`;
  }

  const signature = options.normalizeObservation === false
    ? (defect.observation || defect.message || type)
    : normalizeObservationSignature(defect.observation || defect.message || type);
  return `${category}::${type}::${agentId}::${signature}`;
}

export function extractDefectKeywords(text: string): readonly string[] {
  if (!text || typeof text !== "string") return [];
  const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) ?? [];
  const stopwords = new Set(["the", "and", "for", "with", "this", "that", "from", "was", "were", "are"]);
  return words.filter((w) => !stopwords.has(w));
}

export function calculateDefectSimilarity(textA: string, textB: string): number {
  const setA = new Set(extractDefectKeywords(textA));
  const setB = new Set(extractDefectKeywords(textB));
  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0.0;
}

export {
  computeDefectDiscriminator,
  createDefectContentHash,
  createFnv1aHash,
  createSha256Hash,
  normalizeObservationSignature,
} from "../../../logging/defects/index.ts";

export function extractDefectKeywords(text: string): readonly string[] {
  if (typeof text !== "string") return [];
  if (text.length === 0) return [];
  const matchResult = text.toLowerCase().match(/\b[a-z]{3,}\b/g);
  const words = matchResult !== null ? matchResult : [];
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "from",
    "was",
    "were",
    "are",
  ]);
  return words.filter((w) => !stopwords.has(w));
}

export function calculateDefectSimilarity(textA: string, textB: string): number {
  const setA = new Set(extractDefectKeywords(textA));
  const setB = new Set(extractDefectKeywords(textB));
  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0) return 0.0;
  if (setB.size === 0) return 0.0;

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0.0;
}

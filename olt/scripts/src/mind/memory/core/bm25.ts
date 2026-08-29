import { join } from "node:path";
import type {
  MemoryKind,
  MemoryDocument,
  MemoryIndex,
  MemoryQueryResult,
  MemorySearchOptions,
} from "./types.ts";
import { tokenize, countTokens } from "./types.ts";
import { compileSearchPattern } from "./storage.ts";
export function extractSnippet(
  content: string,
  queryTokens: readonly string[],
  maxLength = 160,
): string {
  if (!content) return "";
  if (content.length <= maxLength) return content.trim();

  const lowerContent = content.toLowerCase();
  let firstMatchPos = -1;

  for (let i = 0; i < queryTokens.length; i += 1) {
    const q = queryTokens[i];
    if (q !== undefined && q.length >= 2) {
      const idx = lowerContent.indexOf(q.toLowerCase());
      if (idx !== -1 && (firstMatchPos === -1 || idx < firstMatchPos)) {
        firstMatchPos = idx;
      }
    }
  }

  if (firstMatchPos === -1) {
    return `${content.slice(0, maxLength - 3).trim()}...`;
  }

  const halfWindow = Math.floor((maxLength - 10) / 2);
  const start = Math.max(0, firstMatchPos - halfWindow);
  const end = Math.min(content.length, start + maxLength);

  let snippet = content.slice(start, end).trim();
  if (start > 0) snippet = `...${snippet}`;
  if (end < content.length) snippet = `${snippet}...`;

  return snippet;
}

/**
 * Scores documents against a search query using BM25 with term matching and tag boosts.
 */
export function scoreDocumentBM25(
  doc: MemoryDocument,
  queryTokens: readonly string[],
  index: MemoryIndex,
  k1 = 1.2,
  b = 0.75,
): { score: number; matchedTerms: string[] } {
  if (queryTokens.length === 0 || doc.length === 0) {
    return { score: 0, matchedTerms: [] };
  }

  const matchedTerms: string[] = [];
  let bm25Score = 0;
  const docLen = doc.length;
  const avgLen = index.avg_doc_length > 0 ? index.avg_doc_length : 1;

  const docTitleLower = doc.title.toLowerCase();
  const docIdLower = doc.id.toLowerCase();
  const docTags = new Set((doc.tags !== undefined ? doc.tags : []).map((t) => t.toLowerCase()));

  for (let i = 0; i < queryTokens.length; i += 1) {
    const term = queryTokens[i];
    if (term === undefined) continue;

    const termCount = doc.token_counts[term];
    const tf = typeof termCount === "number" ? termCount : 0;
    if (tf > 0) {
      matchedTerms.push(term);
      const idfScore = index.idf.get(term);
      const idf = typeof idfScore === "number" ? idfScore : 1.0;
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docLen / avgLen));
      let termScore = idf * (numerator / denominator);

      // Boost if term is present in document title or ID
      if (docTitleLower.includes(term) || docIdLower.includes(term)) {
        termScore *= 1.5;
      }

      // Boost if term matches document tags
      if (docTags.has(term)) {
        termScore *= 1.3;
      }

      bm25Score += termScore;
    }
  }

  return {
    score: Number(bm25Score.toFixed(4)),
    matchedTerms,
  };
}

/**
 * Searches and queries the memory index with multi-attribute filtering (generation, kind, tags, pattern, query).
 */

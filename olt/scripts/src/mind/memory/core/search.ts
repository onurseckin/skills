import { compileSearchPattern, normalizeTags } from "./storage.ts";
import { scoreDocumentBM25 } from "./bm25.ts";
import {
  tokenize,
  type MemoryDocument,
  type MemoryQueryResult,
  type MemoryIndex,
  type MemorySearchOptions,
} from "./types.ts";

export function searchMemory(
  index: MemoryIndex,
  options: MemorySearchOptions,
): readonly MemoryQueryResult[] {
  const query = typeof options.query === "string" ? options.query.trim() : "";
  const queryTokens = tokenize(query);

  if (queryTokens.length === 0 && index.total_documents === 0) {
    return [];
  }

  const minScore =
    typeof options.minScore === "number" && options.minScore >= 0 ? options.minScore : 0.0;
  const limit = typeof options.limit === "number" && options.limit > 0 ? options.limit : 10;
  const offset = typeof options.offset === "number" && options.offset >= 0 ? options.offset : 0;

  // 1. Kind filter
  let allowedKinds: Set<string> | null = null;
  if (options.kind !== undefined && options.kind !== "all" && options.kind !== "") {
    if (Array.isArray(options.kind)) {
      allowedKinds = new Set(options.kind.map((k) => String(k).trim().toLowerCase()));
    } else {
      const splitKinds = String(options.kind)
        .split(/[,;\s]+/)
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      if (splitKinds.length > 0) {
        allowedKinds = new Set(splitKinds);
      }
    }
  }

  // 2. Capsule filter
  let allowedCapsules: Set<string> | null = null;
  if (options.capsule !== undefined && options.capsule !== "all" && options.capsule !== "") {
    if (Array.isArray(options.capsule)) {
      allowedCapsules = new Set(options.capsule.map((c) => String(c).trim().toLowerCase()));
    } else {
      const splitCapsules = String(options.capsule)
        .split(/[,;\s]+/)
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
      if (splitCapsules.length > 0) {
        allowedCapsules = new Set(splitCapsules);
      }
    }
  }

  // 3. Generation filter
  let allowedGenerations: Set<number> | null = null;
  if (
    options.generation !== undefined &&
    options.generation !== "all" &&
    options.generation !== ""
  ) {
    if (Array.isArray(options.generation)) {
      allowedGenerations = new Set(
        options.generation
          .map((g) => (typeof g === "number" ? g : Number.parseInt(String(g), 10)))
          .filter((n) => Number.isFinite(n)),
      );
    } else if (typeof options.generation === "number") {
      allowedGenerations = new Set([options.generation]);
    } else {
      const parts = String(options.generation).split(/[,;\s]+/);
      const parsedGens: number[] = [];
      for (let i = 0; i < parts.length; i += 1) {
        const p = parts[i];
        if (p === undefined) continue;
        const match = p.match(/(?:gen|generation)?[-_]?(\d+)/i);
        if (match && match[1]) {
          const num = Number.parseInt(match[1], 10);
          if (Number.isFinite(num)) parsedGens.push(num);
        }
      }
      if (parsedGens.length > 0) {
        allowedGenerations = new Set(parsedGens);
      }
    }
  }

  // 4. Tags filter
  const rawTagsFilter = options.tags !== undefined ? options.tags : options.tag;
  let requiredTags: string[] | null = null;
  if (rawTagsFilter !== undefined && rawTagsFilter !== "all" && rawTagsFilter !== "") {
    const normalized = normalizeTags(rawTagsFilter);
    if (normalized.length > 0) {
      requiredTags = normalized;
    }
  }

  // 5. Pattern filter (semantic pattern regex)
  const patternRegex = compileSearchPattern(options.pattern);

  const results: MemoryQueryResult[] = [];

  for (let i = 0; i < index.documents.length; i += 1) {
    const doc = index.documents[i];
    if (doc === undefined) continue;

    // Apply kind filter
    if (allowedKinds !== null && !allowedKinds.has(doc.kind)) {
      continue;
    }

    // Apply capsule filter
    if (allowedCapsules !== null) {
      const docCap = doc.capsule_id ? doc.capsule_id.toLowerCase() : "";
      if (!docCap || !allowedCapsules.has(docCap)) {
        continue;
      }
    }

    // Apply generation filter
    if (allowedGenerations !== null) {
      if (
        doc.generation === null ||
        doc.generation === undefined ||
        !allowedGenerations.has(doc.generation)
      ) {
        continue;
      }
    }

    // Apply tags filter
    if (requiredTags !== null) {
      const docTags = new Set((doc.tags !== undefined ? doc.tags : []).map((t) => t.toLowerCase()));
      const docTokensSet = new Set(doc.tokens);
      let allTagsMatch = true;

      for (let j = 0; j < requiredTags.length; j += 1) {
        const reqTag = requiredTags[j];
        if (reqTag === undefined) continue;
        const tagMatched =
          docTags.has(reqTag) ||
          Array.from(docTags).some((t) => t.includes(reqTag) || reqTag.includes(t)) ||
          docTokensSet.has(reqTag);

        if (!tagMatched) {
          allTagsMatch = false;
          break;
        }
      }

      if (!allTagsMatch) {
        continue;
      }
    }

    // Apply pattern regex filter
    let patternMatched = false;
    const patternMatchTerms: string[] = [];
    if (patternRegex !== null) {
      const docTagsText = (doc.tags !== undefined ? doc.tags : []).join(" ");
      const searchableStr = `${doc.id} ${doc.title} ${docTagsText} ${doc.snippet} ${doc.source_path}`;
      const match = patternRegex.exec(searchableStr);
      if (!match) {
        continue;
      }
      patternMatched = true;
      if (match[0]) {
        patternMatchTerms.push(match[0]);
      }
    }

    if (queryTokens.length === 0) {
      // Return unranked/filtered document if query is empty
      let score = 1.0;
      if (patternMatched) score += 2.0;
      if (requiredTags !== null) score += 0.5;

      results.push({
        id: doc.id,
        kind: doc.kind,
        title: doc.title,
        capsule_id: doc.capsule_id,
        generation: doc.generation,
        tags: doc.tags,
        source_path: doc.source_path,
        score,
        snippet: doc.snippet,
        matched_terms: patternMatchTerms,
        metadata: doc.metadata,
      });
      continue;
    }

    const { score: bm25Score, matchedTerms } = scoreDocumentBM25(doc, queryTokens, index);

    if (matchedTerms.length > 0 || patternMatched) {
      let finalScore = bm25Score;
      if (patternMatched) finalScore += 2.5;

      if (finalScore >= minScore) {
        const combinedMatchedTerms = Array.from(new Set([...matchedTerms, ...patternMatchTerms]));
        const dynamicSnippet = extractSnippet(doc.snippet, [
          ...queryTokens,
          ...combinedMatchedTerms,
        ]);
        results.push({
          id: doc.id,
          kind: doc.kind,
          title: doc.title,
          capsule_id: doc.capsule_id,
          generation: doc.generation,
          tags: doc.tags,
          source_path: doc.source_path,
          score: Number(finalScore.toFixed(4)),
          snippet: dynamicSnippet,
          matched_terms: combinedMatchedTerms,
          metadata: doc.metadata,
        });
      }
    }
  }

  // Sort by score descending, then by matched_terms length descending
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.matched_terms.length !== a.matched_terms.length) {
      return b.matched_terms.length - a.matched_terms.length;
    }
    return a.id.localeCompare(b.id);
  });

  return results.slice(offset, offset + limit);
}

/**
 * Semantic query alias for searchMemory.
 */
export const queryMemory = searchMemory;

/**
 * Indexes charter documents from olt/agents/mind.yaml, references, and docs.
 */

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

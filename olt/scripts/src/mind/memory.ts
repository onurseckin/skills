import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { enforceLineLimit } from "../cli/formatters/line-limiter.ts";
import { HarnessError } from "../core/errors/harness-error.ts";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const COMMON_STOP_WORDS = new Set<string>([
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
export function normalizeTags(tags?: readonly string[] | string | undefined): string[] {
  if (!tags) return [];
  const list = Array.isArray(tags) ? tags : String(tags).split(/[,;\s]+/);
  const result: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < list.length; i += 1) {
    const raw = list[i];
    if (typeof raw !== "string") continue;
    const clean = raw.trim().toLowerCase();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      result.push(clean);
    }
  }
  return result;
}

/**
 * Compiles a search pattern into a RegExp safely.
 */
export function compileSearchPattern(pattern: string | RegExp | undefined): RegExp | null {
  if (!pattern) return null;
  if (pattern instanceof RegExp) return pattern;
  if (typeof pattern !== "string" || !pattern.trim()) return null;

  const trimmed = pattern.trim();
  const slashMatch = trimmed.match(/^\/(.*)\/([a-z]*)$/);
  if (slashMatch && slashMatch[1] !== undefined) {
    try {
      const flags =
        typeof slashMatch[2] === "string" && slashMatch[2].length > 0 ? slashMatch[2] : "i";
      return new RegExp(slashMatch[1], flags);
    } catch {
      // Fallback below
    }
  }

  try {
    return new RegExp(trimmed, "i");
  } catch {
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped, "i");
  }
}

/**
 * Creates a MemoryDocument from text contents and metadata.
 */
export function createMemoryDocument(params: {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly title: string;
  readonly capsule_id?: string | null | undefined;
  readonly generation?: number | null | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly source_path: string;
  readonly content: string;
  readonly snippet?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}): MemoryDocument {
  const normTags = normalizeTags(params.tags);
  const tagsText = normTags.join(" ");
  const fullSearchableText = `${params.id} ${params.title} ${tagsText} ${params.content}`;
  const tokens = tokenize(fullSearchableText);
  const tokenCounts = countTokens(tokens);

  const snippet =
    params.snippet !== undefined && params.snippet.trim()
      ? params.snippet.trim()
      : params.content.length > 200
        ? `${params.content.slice(0, 197)}...`
        : params.content.trim();

  let generation: number | null = params.generation !== undefined ? params.generation : null;
  if (generation === null && params.capsule_id) {
    generation = extractGenerationFromCapsuleId(params.capsule_id);
  }
  if (generation === null && params.metadata && typeof params.metadata["generation"] === "number") {
    generation = params.metadata["generation"];
  }

  return {
    id: params.id,
    kind: params.kind,
    title: params.title,
    capsule_id: params.capsule_id !== undefined ? params.capsule_id : null,
    generation,
    tags: normTags,
    source_path: params.source_path,
    snippet,
    metadata: params.metadata !== undefined ? params.metadata : {},
    tokens,
    token_counts: tokenCounts,
    length: tokens.length,
  };
}

/**
 * Builds an inverted index and BM25 statistics over an array of memory documents.
 */
export function buildMemoryIndex(documents: readonly MemoryDocument[]): MemoryIndex {
  const totalDocs = documents.length;
  if (totalDocs === 0) {
    return {
      documents: [],
      total_documents: 0,
      avg_doc_length: 0,
      idf: new Map(),
      postings: new Map(),
    };
  }

  let totalLength = 0;
  const docFreq = new Map<string, number>();
  const postingsMap = new Map<string, Array<{ docIndex: number; tf: number }>>();

  for (let i = 0; i < documents.length; i += 1) {
    const doc = documents[i];
    if (doc === undefined) continue;
    totalLength += doc.length;

    for (const [term, tf] of Object.entries(doc.token_counts)) {
      const prevDf = docFreq.get(term);
      docFreq.set(term, (prevDf !== undefined ? prevDf : 0) + 1);

      let plist = postingsMap.get(term);
      if (plist === undefined) {
        plist = [];
        postingsMap.set(term, plist);
      }
      plist.push({ docIndex: i, tf });
    }
  }

  const avgDocLength = totalLength / totalDocs;
  const idfMap = new Map<string, number>();

  // BM25 IDF formula: ln(1 + (N - n(t) + 0.5) / (n(t) + 0.5)) + 1.0
  for (const [term, df] of docFreq.entries()) {
    const idfVal = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5)) + 1.0;
    idfMap.set(term, idfVal);
  }

  return {
    documents,
    total_documents: totalDocs,
    avg_doc_length: avgDocLength,
    idf: idfMap,
    postings: postingsMap,
  };
}

/**
 * Extracts a dynamic contextual snippet centered around matched query terms.
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
 * Indexes charter documents from docs/CHARTER.md, references, and docs.
 */
export function indexCharterDocuments(repoRoot: string): MemoryDocument[] {
  const documents: MemoryDocument[] = [];
  const visitedPaths = new Set<string>();

  const charterPath = join(repoRoot, "docs", "CHARTER.md");
  if (existsSync(charterPath)) {
    visitedPaths.add(resolve(charterPath));
    try {
      const content = readFileSync(charterPath, "utf-8");
      // Add root charter document
      documents.push(
        createMemoryDocument({
          id: "charter-root",
          kind: "charter",
          title: "Mind Charter (Core Directives & Invariants)",
          source_path: "docs/CHARTER.md",
          generation: null,
          tags: ["charter", "directive", "invariant", "core"],
          content,
          snippet: content.slice(0, 200),
          metadata: { file: "docs/CHARTER.md" },
        }),
      );

      // Extract goals G1, G2, etc.
      const goalMatches = content.matchAll(/- (G\d+):\s*([^\n]+)/g);
      for (const m of goalMatches) {
        const goalId = m[1];
        const goalText = m[2];
        if (goalId !== undefined && goalText !== undefined) {
          documents.push(
            createMemoryDocument({
              id: `charter-goal-${goalId.toLowerCase()}`,
              kind: "charter",
              title: `Charter Goal ${goalId}`,
              source_path: "docs/CHARTER.md",
              generation: null,
              tags: ["charter", "goal", goalId.toLowerCase()],
              content: `${goalId}: ${goalText}`,
              snippet: goalText,
              metadata: { goal_id: goalId },
            }),
          );
        }
      }

      // Extract cognitive pillars
      const pillarMatches = content.matchAll(/- (Pillar \d+):\s*([^\n]+)/g);
      for (const m of pillarMatches) {
        const pillarId = m[1];
        const pillarText = m[2];
        if (pillarId !== undefined && pillarText !== undefined) {
          documents.push(
            createMemoryDocument({
              id: `charter-${pillarId.toLowerCase().replace(/\s+/g, "-")}`,
              kind: "charter",
              title: `Charter ${pillarId}`,
              source_path: "docs/CHARTER.md",
              generation: null,
              tags: ["charter", "pillar", pillarId.toLowerCase().replace(/\s+/g, "-")],
              content: `${pillarId}: ${pillarText}`,
              snippet: pillarText,
              metadata: { pillar: pillarId },
            }),
          );
        }
      }
    } catch {
      // Charter parsing error handled non-fatally
    }
  }

  // Scan references directory for additional knowledge artifacts
  const refDir = join(repoRoot, "olt", "references");
  if (existsSync(refDir)) {
    try {
      const entries = readdirSync(refDir, { withFileTypes: true });
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (
          entry !== undefined &&
          entry.isFile() &&
          (entry.name.endsWith(".md") || entry.name.endsWith(".json"))
        ) {
          const filePath = join(refDir, entry.name);
          const absPath = resolve(filePath);
          if (!visitedPaths.has(absPath)) {
            visitedPaths.add(absPath);
            try {
              const content = readFileSync(filePath, "utf-8");
              documents.push(
                createMemoryDocument({
                  id: `reference-${entry.name.replace(/\.[^/.]+$/, "")}`,
                  kind: "charter",
                  title: `Reference: ${entry.name}`,
                  source_path: filePath,
                  generation: null,
                  tags: ["charter", "reference", entry.name.toLowerCase().replace(/\.[^/.]+$/, "")],
                  content,
                  snippet: content.slice(0, 200),
                  metadata: { file: entry.name },
                }),
              );
            } catch {
              // Ignore single file error
            }
          }
        }
      }
    } catch {
      // Non-fatal references scan error
    }
  }

  return documents;
}

/**
 * Indexes defects from defects.jsonl files across capsules and root directories.
 */
export function indexDefectDocuments(capsulesDir: string, explicitRun?: string): MemoryDocument[] {
  const documents: MemoryDocument[] = [];
  const filesToScan: Array<{ capsule: string; filePath: string }> = [];

  const rootDefects = join(capsulesDir, "defects.jsonl");
  if (existsSync(rootDefects)) {
    filesToScan.push({ capsule: "capsules-root", filePath: rootDefects });
  }

  if (existsSync(capsulesDir)) {
    try {
      const entries = readdirSync(capsulesDir, { withFileTypes: true });
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (entry !== undefined && entry.isDirectory()) {
          const defectPath = join(capsulesDir, entry.name, "defects.jsonl");
          if (existsSync(defectPath)) {
            filesToScan.push({ capsule: entry.name, filePath: defectPath });
          }
        }
      }
    } catch {
      // Non-fatal capsules directory scan error
    }
  }

  if (explicitRun !== undefined) {
    const explicitDefects = join(resolve(explicitRun), "defects.jsonl");
    if (existsSync(explicitDefects)) {
      filesToScan.push({ capsule: basename(resolve(explicitRun)), filePath: explicitDefects });
    }
  }

  for (let i = 0; i < filesToScan.length; i += 1) {
    const item = filesToScan[i];
    if (item === undefined) continue;
    try {
      const content = readFileSync(item.filePath, "utf-8");
      const lines = content.split("\n");
      for (let j = 0; j < lines.length; j += 1) {
        const line = lines[j];
        if (line === undefined || !line.trim()) continue;
        try {
          const parsed = JSON.parse(line.trim()) as Record<string, unknown>;
          if (typeof parsed.id === "string" && typeof parsed.type === "string") {
            const observation = typeof parsed.observation === "string" ? parsed.observation : "";
            const remediation = typeof parsed.remediation === "string" ? parsed.remediation : "";
            const status = typeof parsed.status === "string" ? parsed.status : "open";
            const severity = typeof parsed.severity === "string" ? parsed.severity : "warning";
            const category = typeof parsed.category === "string" ? parsed.category : "code_defect";

            const gen = extractGeneration(
              parsed,
              item.capsule !== "capsules-root" ? item.capsule : null,
            );
            const extraTags = Array.isArray(parsed.tags)
              ? (parsed.tags as string[])
              : Array.isArray(parsed.labels)
                ? (parsed.labels as string[])
                : [];

            const tags = normalizeTags([
              "defect",
              severity,
              status,
              category,
              parsed.type,
              ...(gen !== null ? [`gen-${gen}`] : []),
              ...extraTags,
            ]);

            const searchableContent = `${parsed.id} ${parsed.type} ${category} ${status} ${severity} ${observation} ${remediation}`;
            const snippet = `[${severity.toUpperCase()} | ${status}] ${observation} Remediation: ${remediation}`;

            documents.push(
              createMemoryDocument({
                id: `defect-${parsed.id}`,
                kind: "defect",
                title: `Defect [${parsed.id}]: ${parsed.type}`,
                capsule_id: item.capsule !== "capsules-root" ? item.capsule : null,
                generation: gen,
                tags,
                source_path: item.filePath,
                content: searchableContent,
                snippet,
                metadata: {
                  defect_id: parsed.id,
                  type: parsed.type,
                  severity,
                  status,
                  category,
                  observation,
                  remediation,
                  generation: gen,
                  tags,
                  pid: typeof parsed.pid === "number" ? parsed.pid : undefined,
                  ppid: typeof parsed.ppid === "number" ? parsed.ppid : undefined,
                  agent_id: typeof parsed.agent_id === "string" ? parsed.agent_id : undefined,
                },
              }),
            );
          }
        } catch {
          // Ignore malformed line
        }
      }
    } catch {
      // Ignore file read error
    }
  }

  return documents;
}

/**
 * Indexes capsule state, prompt, trace, and tasks.
 */
export function indexCapsuleDocuments(capsulesDir: string, explicitRun?: string): MemoryDocument[] {
  const documents: MemoryDocument[] = [];
  const capsuleDirs: Array<{ name: string; path: string }> = [];

  if (existsSync(capsulesDir)) {
    try {
      const entries = readdirSync(capsulesDir, { withFileTypes: true });
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (entry !== undefined && entry.isDirectory() && !entry.name.startsWith(".")) {
          capsuleDirs.push({ name: entry.name, path: join(capsulesDir, entry.name) });
        }
      }
    } catch {
      // Non-fatal capsule scan error
    }
  }

  if (explicitRun !== undefined) {
    const explicitAbs = resolve(explicitRun);
    const capName = basename(explicitAbs);
    if (!capsuleDirs.some((c) => c.path === explicitAbs)) {
      capsuleDirs.push({ name: capName, path: explicitAbs });
    }
  }

  for (let i = 0; i < capsuleDirs.length; i += 1) {
    const cap = capsuleDirs[i];
    if (cap === undefined) continue;

    const gen = extractGenerationFromCapsuleId(cap.name);

    // 1. Prompt
    const promptPath = join(cap.path, "prompt.md");
    if (existsSync(promptPath)) {
      try {
        const promptContent = readFileSync(promptPath, "utf-8");
        documents.push(
          createMemoryDocument({
            id: `prompt-${cap.name}`,
            kind: "capsule",
            title: `Capsule Prompt (${cap.name})`,
            capsule_id: cap.name,
            generation: gen,
            tags: normalizeTags([
              "capsule",
              "prompt",
              cap.name,
              ...(gen !== null ? [`gen-${gen}`] : []),
            ]),
            source_path: promptPath,
            content: promptContent,
            snippet: promptContent.slice(0, 200),
            metadata: { capsule: cap.name, generation: gen, file: "prompt.md" },
          }),
        );
      } catch {
        // Ignore read error
      }
    }

    // 2. Trace
    const tracePath = join(cap.path, "trace.md");
    if (existsSync(tracePath)) {
      try {
        const traceContent = readFileSync(tracePath, "utf-8");
        documents.push(
          createMemoryDocument({
            id: `trace-${cap.name}`,
            kind: "capsule",
            title: `Execution Trace (${cap.name})`,
            capsule_id: cap.name,
            generation: gen,
            tags: normalizeTags([
              "capsule",
              "trace",
              cap.name,
              ...(gen !== null ? [`gen-${gen}`] : []),
            ]),
            source_path: tracePath,
            content: traceContent,
            snippet: traceContent.slice(0, 200),
            metadata: { capsule: cap.name, generation: gen, file: "trace.md" },
          }),
        );
      } catch {
        // Ignore read error
      }
    }

    // 3. State.json tasks
    const statePath = join(cap.path, "state.json");
    if (existsSync(statePath)) {
      try {
        const stateRaw = readFileSync(statePath, "utf-8");
        const stateObj = JSON.parse(stateRaw) as Record<string, unknown>;

        if (Array.isArray(stateObj.tasks)) {
          for (let j = 0; j < stateObj.tasks.length; j += 1) {
            const task = stateObj.tasks[j];
            if (isRecord(task)) {
              const taskId = typeof task.id === "string" ? task.id : `task-${j}`;
              const label = typeof task.label === "string" ? task.label : taskId;
              const status = typeof task.status === "string" ? task.status : "unknown";
              const writeScope = Array.isArray(task.write_scope) ? task.write_scope.join(", ") : "";

              const content = `${taskId} ${label} ${status} ${writeScope}`;
              const snippet = `Task [${taskId}] (${status}): ${label}. Write scope: ${writeScope}`;

              documents.push(
                createMemoryDocument({
                  id: `task-${cap.name}-${taskId}`,
                  kind: "capsule",
                  title: `Task ${taskId} (${cap.name})`,
                  capsule_id: cap.name,
                  generation: gen,
                  tags: normalizeTags([
                    "capsule",
                    "task",
                    status.toLowerCase(),
                    taskId.toLowerCase(),
                    cap.name,
                    ...(gen !== null ? [`gen-${gen}`] : []),
                  ]),
                  source_path: statePath,
                  content,
                  snippet,
                  metadata: {
                    task_id: taskId,
                    status,
                    capsule: cap.name,
                    generation: gen,
                    write_scope: task.write_scope,
                  },
                }),
              );
            }
          }
        }
      } catch {
        // Ignore state parse error
      }
    }
  }

  return documents;
}

/**
 * Indexes decisions from candidate proposals, audit reports, and round reviews.
 */
export function indexDecisionDocuments(
  capsulesDir: string,
  explicitRun?: string,
): MemoryDocument[] {
  const documents: MemoryDocument[] = [];
  const capsuleDirs: Array<{ name: string; path: string }> = [];

  if (existsSync(capsulesDir)) {
    try {
      const entries = readdirSync(capsulesDir, { withFileTypes: true });
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (entry !== undefined && entry.isDirectory() && !entry.name.startsWith(".")) {
          capsuleDirs.push({ name: entry.name, path: join(capsulesDir, entry.name) });
        }
      }
    } catch {
      // Non-fatal
    }
  }

  if (explicitRun !== undefined) {
    const explicitAbs = resolve(explicitRun);
    const capName = basename(explicitAbs);
    if (!capsuleDirs.some((c) => c.path === explicitAbs)) {
      capsuleDirs.push({ name: capName, path: explicitAbs });
    }
  }

  for (let i = 0; i < capsuleDirs.length; i += 1) {
    const cap = capsuleDirs[i];
    if (cap === undefined) continue;

    const gen = extractGenerationFromCapsuleId(cap.name);

    const statePath = join(cap.path, "state.json");
    if (existsSync(statePath)) {
      try {
        const stateRaw = readFileSync(statePath, "utf-8");
        const stateObj = JSON.parse(stateRaw) as Record<string, unknown>;

        // Index candidate admission/decline decisions
        if (Array.isArray(stateObj.candidates)) {
          for (let j = 0; j < stateObj.candidates.length; j += 1) {
            const cand = stateObj.candidates[j];
            if (isRecord(cand)) {
              const candId = typeof cand.id === "string" ? cand.id : `cand-${j}`;
              const statement = typeof cand.statement === "string" ? cand.statement : "";
              const rationale = typeof cand.rationale === "string" ? cand.rationale : "";
              const status = typeof cand.status === "string" ? cand.status : "unknown";
              const decidedBy = typeof cand.decided_by === "string" ? cand.decided_by : "";

              const content = `${candId} ${statement} ${rationale} ${status} ${decidedBy}`;
              const snippet = `Candidate [${candId}] (${status}): ${statement} | Rationale: ${rationale}`;

              documents.push(
                createMemoryDocument({
                  id: `decision-candidate-${candId}`,
                  kind: "decision",
                  title: `Candidate Decision: ${candId} (${status})`,
                  capsule_id: cap.name,
                  generation: gen,
                  tags: normalizeTags([
                    "decision",
                    "candidate",
                    status.toLowerCase(),
                    candId.toLowerCase(),
                    cap.name,
                    ...(gen !== null ? [`gen-${gen}`] : []),
                  ]),
                  source_path: statePath,
                  content,
                  snippet,
                  metadata: {
                    candidate_id: candId,
                    status,
                    statement,
                    rationale,
                    decided_by: decidedBy,
                    generation: gen,
                    capsule: cap.name,
                  },
                }),
              );
            }
          }
        }

        // Index audits
        if (Array.isArray(stateObj.audits)) {
          for (let j = 0; j < stateObj.audits.length; j += 1) {
            const audit = stateObj.audits[j];
            if (isRecord(audit)) {
              const auditId = typeof audit.id === "string" ? audit.id : `audit-${j}`;
              const verdict = typeof audit.verdict === "string" ? audit.verdict : "unknown";
              const actor = typeof audit.actor === "string" ? audit.actor : "";

              const content = `audit ${auditId} ${verdict} ${actor}`;
              const snippet = `Audit [${auditId}]: verdict ${verdict} decided by ${actor}`;

              documents.push(
                createMemoryDocument({
                  id: `decision-audit-${auditId}`,
                  kind: "decision",
                  title: `Audit Decision: ${auditId} (${verdict})`,
                  capsule_id: cap.name,
                  generation: gen,
                  tags: normalizeTags([
                    "decision",
                    "audit",
                    verdict.toLowerCase(),
                    auditId.toLowerCase(),
                    cap.name,
                    ...(gen !== null ? [`gen-${gen}`] : []),
                  ]),
                  source_path: statePath,
                  content,
                  snippet,
                  metadata: {
                    audit_id: auditId,
                    verdict,
                    actor,
                    generation: gen,
                    capsule: cap.name,
                  },
                }),
              );
            }
          }
        }
      } catch {
        // Ignore state parse error
      }
    }
  }

  return documents;
}

/**
 * Indexes reports and packets.
 */
export function indexReportDocuments(capsulesDir: string, explicitRun?: string): MemoryDocument[] {
  const documents: MemoryDocument[] = [];
  const capsuleDirs: Array<{ name: string; path: string }> = [];

  if (existsSync(capsulesDir)) {
    try {
      const entries = readdirSync(capsulesDir, { withFileTypes: true });
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (entry !== undefined && entry.isDirectory() && !entry.name.startsWith(".")) {
          capsuleDirs.push({ name: entry.name, path: join(capsulesDir, entry.name) });
        }
      }
    } catch {
      // Non-fatal
    }
  }

  if (explicitRun !== undefined) {
    const explicitAbs = resolve(explicitRun);
    const capName = basename(explicitAbs);
    if (!capsuleDirs.some((c) => c.path === explicitAbs)) {
      capsuleDirs.push({ name: capName, path: explicitAbs });
    }
  }

  for (let i = 0; i < capsuleDirs.length; i += 1) {
    const cap = capsuleDirs[i];
    if (cap === undefined) continue;

    const gen = extractGenerationFromCapsuleId(cap.name);

    // Scan reports directory
    const reportsDir = join(cap.path, "reports");
    if (existsSync(reportsDir)) {
      try {
        const reportEntries = readdirSync(reportsDir, { withFileTypes: true });
        for (let j = 0; j < reportEntries.length; j += 1) {
          const rentry = reportEntries[j];
          if (rentry !== undefined && rentry.isFile()) {
            const reportPath = join(reportsDir, rentry.name);
            try {
              const content = readFileSync(reportPath, "utf-8");
              const reportBase = rentry.name.replace(/\.[^/.]+$/, "");
              documents.push(
                createMemoryDocument({
                  id: `report-${cap.name}-${reportBase}`,
                  kind: "report",
                  title: `Report: ${rentry.name} (${cap.name})`,
                  capsule_id: cap.name,
                  generation: gen,
                  tags: normalizeTags([
                    "report",
                    reportBase.toLowerCase(),
                    cap.name,
                    ...(gen !== null ? [`gen-${gen}`] : []),
                  ]),
                  source_path: reportPath,
                  content,
                  snippet: content.slice(0, 200),
                  metadata: { filename: rentry.name, generation: gen, capsule: cap.name },
                }),
              );
            } catch {
              // Ignore single report error
            }
          }
        }
      } catch {
        // Non-fatal
      }
    }

    // Scan packets directory
    const packetsDir = join(cap.path, "packets");
    if (existsSync(packetsDir)) {
      try {
        const packetEntries = readdirSync(packetsDir, { withFileTypes: true });
        for (let j = 0; j < packetEntries.length; j += 1) {
          const pentry = packetEntries[j];
          if (pentry !== undefined && pentry.isDirectory()) {
            const packetMd = join(packetsDir, pentry.name, "packet.md");
            if (existsSync(packetMd)) {
              try {
                const packetContent = readFileSync(packetMd, "utf-8");
                documents.push(
                  createMemoryDocument({
                    id: `packet-${cap.name}-${pentry.name}`,
                    kind: "report",
                    title: `Role Packet: ${pentry.name} (${cap.name})`,
                    capsule_id: cap.name,
                    generation: gen,
                    tags: normalizeTags([
                      "report",
                      "packet",
                      pentry.name.toLowerCase(),
                      cap.name,
                      ...(gen !== null ? [`gen-${gen}`] : []),
                    ]),
                    source_path: packetMd,
                    content: packetContent,
                    snippet: packetContent.slice(0, 200),
                    metadata: { packet_id: pentry.name, generation: gen, capsule: cap.name },
                  }),
                );
              } catch {
                // Ignore
              }
            }
          }
        }
      } catch {
        // Non-fatal
      }
    }
  }

  return documents;
}

/**
 * Indexes archived objectives and candidate records from ARCHIVED_OBJECTIVES.jsonl.
 */
export function indexArchivedObjectiveDocuments(
  capsulesDir: string,
  explicitRun?: string,
): MemoryDocument[] {
  const documents: MemoryDocument[] = [];
  const filesToScan: Array<{ capsule: string; filePath: string }> = [];

  const rootArchived = join(capsulesDir, "ARCHIVED_OBJECTIVES.jsonl");
  if (existsSync(rootArchived)) {
    filesToScan.push({ capsule: "capsules-root", filePath: rootArchived });
  }

  if (existsSync(capsulesDir)) {
    try {
      const entries = readdirSync(capsulesDir, { withFileTypes: true });
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (entry !== undefined && entry.isDirectory() && !entry.name.startsWith(".")) {
          const capArchivedUpper = join(capsulesDir, entry.name, "ARCHIVED_OBJECTIVES.jsonl");
          if (existsSync(capArchivedUpper)) {
            filesToScan.push({ capsule: entry.name, filePath: capArchivedUpper });
          }
          const capArchivedLower = join(capsulesDir, entry.name, "archived_objectives.jsonl");
          if (existsSync(capArchivedLower) && capArchivedLower !== capArchivedUpper) {
            filesToScan.push({ capsule: entry.name, filePath: capArchivedLower });
          }
        }
      }
    } catch {
      // Non-fatal
    }
  }

  if (explicitRun !== undefined) {
    const explicitUpper = join(resolve(explicitRun), "ARCHIVED_OBJECTIVES.jsonl");
    if (existsSync(explicitUpper)) {
      filesToScan.push({ capsule: basename(resolve(explicitRun)), filePath: explicitUpper });
    }
    const explicitLower = join(resolve(explicitRun), "archived_objectives.jsonl");
    if (existsSync(explicitLower) && explicitLower !== explicitUpper) {
      filesToScan.push({ capsule: basename(resolve(explicitRun)), filePath: explicitLower });
    }
  }

  for (let i = 0; i < filesToScan.length; i += 1) {
    const item = filesToScan[i];
    if (item === undefined) continue;
    try {
      const content = readFileSync(item.filePath, "utf-8");
      const lines = content.split("\n");
      for (let j = 0; j < lines.length; j += 1) {
        const line = lines[j];
        if (line === undefined || !line.trim()) continue;
        try {
          const parsed = JSON.parse(line.trim()) as Record<string, unknown>;
          if (typeof parsed["id"] === "string") {
            const statement = typeof parsed["statement"] === "string" ? parsed["statement"] : "";
            const result = typeof parsed["result"] === "string" ? parsed["result"] : "completed";
            const extractedGen = extractGeneration(
              parsed,
              item.capsule !== "capsules-root" ? item.capsule : null,
            );
            const gen =
              typeof parsed["generation"] === "number"
                ? parsed["generation"]
                : extractedGen !== null
                  ? extractedGen
                  : 1;
            const completedAt =
              typeof parsed["completed_at"] === "string" ? parsed["completed_at"] : "";
            const type = typeof parsed["type"] === "string" ? parsed["type"] : "objective";

            const goals = Array.isArray(parsed["charter_goals"])
              ? (parsed["charter_goals"] as string[])
              : [];
            const tags = normalizeTags([
              "archived",
              type.toLowerCase(),
              result.toLowerCase(),
              `gen-${gen}`,
              ...goals,
            ]);

            const searchableContent = `${parsed["id"]} ${type} ${statement} gen-${gen} ${result} ${completedAt}`;
            const snippet = `[GEN ${gen} | ${result.toUpperCase()}] (${type}) ${statement}`;

            documents.push(
              createMemoryDocument({
                id: `archived-${parsed["id"]}`,
                kind: "decision",
                title: `Archived ${type.toUpperCase()} [${parsed["id"]}] (Gen ${gen})`,
                capsule_id: item.capsule !== "capsules-root" ? item.capsule : null,
                generation: gen,
                tags,
                source_path: item.filePath,
                content: searchableContent,
                snippet,
                metadata: {
                  archived_id: parsed["id"],
                  type,
                  generation: gen,
                  tags,
                  result,
                  completed_at: completedAt,
                  capsule: item.capsule,
                },
              }),
            );
          }
        } catch {
          // Ignore
        }
      }
    } catch {
      // Ignore
    }
  }

  return documents;
}

/**
 * Indexes all memory artifacts (charter, defects, capsules, decisions, reports, archived objectives) into an integrated MemoryIndex.
 */
export function indexAllMemory(options: IndexMemoryOptions = {}): MemoryIndex {
  const repoRoot = options.repoRoot !== undefined ? resolve(options.repoRoot) : process.cwd();
  const capsulesDir =
    options.capsulesDir !== undefined ? resolve(options.capsulesDir) : join(repoRoot, ".capsules");
  const runRoot = options.runRoot !== undefined ? resolve(options.runRoot) : undefined;

  const charterDocs = indexCharterDocuments(repoRoot);
  const defectDocs = indexDefectDocuments(capsulesDir, runRoot);
  const capsuleDocs = indexCapsuleDocuments(capsulesDir, runRoot);
  const decisionDocs = indexDecisionDocuments(capsulesDir, runRoot);
  const reportDocs = indexReportDocuments(capsulesDir, runRoot);
  const archivedDocs = indexArchivedObjectiveDocuments(capsulesDir, runRoot);

  const documentMap = new Map<string, MemoryDocument>();

  const allLists = [charterDocs, defectDocs, capsuleDocs, decisionDocs, reportDocs, archivedDocs];
  for (let i = 0; i < allLists.length; i += 1) {
    const list = allLists[i];
    if (list === undefined) continue;
    for (let j = 0; j < list.length; j += 1) {
      const doc = list[j];
      if (doc !== undefined && !documentMap.has(doc.id)) {
        documentMap.set(doc.id, doc);
      }
    }
  }

  const allDocuments = Array.from(documentMap.values());
  return buildMemoryIndex(allDocuments);
}

function truncateString(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1)}…`;
}

function padRight(str: string, width: number): string {
  if (str.length >= width) return str;
  return `${str}${" ".repeat(width - str.length)}`;
}

/**
 * Renders a crisp Unicode/ASCII boxed table for search results.
 */
export function renderAsciiMemoryTable(results: readonly MemoryQueryResult[]): string {
  if (results.length === 0) {
    return [
      "┌────────────────────────────────────────────────────────────────────────┐",
      "│ No memory records discovered matching query and filter criteria         │",
      "└────────────────────────────────────────────────────────────────────────┘",
    ].join("\n");
  }

  const colIdWidth = 24;
  const colKindWidth = 10;
  const colTitleWidth = 28;
  const colScoreWidth = 8;
  const colSnippetWidth = 32;

  const topBorder = `┌${"─".repeat(colIdWidth + 2)}┬${"─".repeat(colKindWidth + 2)}┬${"─".repeat(colTitleWidth + 2)}┬${"─".repeat(colScoreWidth + 2)}┬${"─".repeat(colSnippetWidth + 2)}┐`;
  const header = `│ ${padRight("Memory ID", colIdWidth)} │ ${padRight("Kind", colKindWidth)} │ ${padRight("Title / Scope", colTitleWidth)} │ ${padRight("Score", colScoreWidth)} │ ${padRight("Snippet", colSnippetWidth)} │`;
  const separator = `├${"─".repeat(colIdWidth + 2)}┼${"─".repeat(colKindWidth + 2)}┼${"─".repeat(colTitleWidth + 2)}┼${"─".repeat(colScoreWidth + 2)}┼${"─".repeat(colSnippetWidth + 2)}┤`;
  const bottomBorder = `└${"─".repeat(colIdWidth + 2)}┴${"─".repeat(colKindWidth + 2)}┴${"─".repeat(colTitleWidth + 2)}┴${"─".repeat(colScoreWidth + 2)}┴${"─".repeat(colSnippetWidth + 2)}┘`;

  const rows = results.map((r) => {
    const idCell = padRight(truncateString(r.id, colIdWidth), colIdWidth);
    const kindCell = padRight(truncateString(r.kind, colKindWidth), colKindWidth);
    const titleCell = padRight(truncateString(r.title, colTitleWidth), colTitleWidth);
    const scoreCell = padRight(r.score.toFixed(3), colScoreWidth);
    const snippetCell = padRight(truncateString(r.snippet, colSnippetWidth), colSnippetWidth);
    return `│ ${idCell} │ ${kindCell} │ ${titleCell} │ ${scoreCell} │ ${snippetCell} │`;
  });

  return [topBorder, header, separator, ...rows, bottomBorder].join("\n");
}

/**
 * Formats a comprehensive Markdown summary brief for memory search operations.
 */
export function formatMemoryQueryBrief(params: {
  readonly query: string;
  readonly results: readonly MemoryQueryResult[];
  readonly totalIndexed: number;
  readonly capsulesDir: string;
  readonly runRoot: string | null;
  readonly kindFilter?: string | undefined;
  readonly generationFilter?: string | number | undefined;
  readonly tagsFilter?: string | undefined;
  readonly patternFilter?: string | undefined;
  readonly isAll?: boolean | undefined;
}): string {
  const queryDisplay = params.query.length > 0 ? params.query : "*all*";
  const lines: string[] = [
    "### Semantic Knowledge & Memory Search Report",
    `- **Search Query**: \`${queryDisplay}\``,
    `- **Total Memory Documents Indexed**: ${params.totalIndexed}`,
    `- **Matching Records Found**: ${params.results.length}`,
    params.kindFilter ? `- **Kind Filter**: \`${params.kindFilter}\`` : "- **Kind Filter**: `all`",
    params.generationFilter !== undefined
      ? `- **Generation Filter**: \`${params.generationFilter}\``
      : null,
    params.tagsFilter ? `- **Tags Filter**: \`${params.tagsFilter}\`` : null,
    params.patternFilter ? `- **Pattern Filter**: \`${params.patternFilter}\`` : null,
    params.runRoot !== null
      ? `- **Target Run Root**: \`${params.runRoot}\``
      : "- **Target Run Root**: *all*",
    "",
    "#### Search Results Matrix",
    renderAsciiMemoryTable(params.results),
  ].filter((line): line is string => line !== null);

  if (params.results.length > 0) {
    lines.push("");
    lines.push("#### Match Forensics & Context");
    for (let i = 0; i < params.results.length; i += 1) {
      const r = params.results[i];
      if (r === undefined) continue;
      const genBadge =
        r.generation !== null && r.generation !== undefined ? ` [Gen ${r.generation}]` : "";
      lines.push(`- **\`${r.id}\`** [\`${r.kind}\`]${genBadge} (Score: \`${r.score.toFixed(3)}\`)`);
      lines.push(`  - **Title**: ${r.title}`);
      lines.push(`  - **Source**: \`${r.source_path}\``);
      if (r.capsule_id) {
        lines.push(`  - **Capsule**: \`${r.capsule_id}\``);
      }
      if (r.tags && r.tags.length > 0) {
        lines.push(`  - **Tags**: \`${r.tags.join("`, `")}\``);
      }
      if (r.matched_terms.length > 0) {
        lines.push(`  - **Matched Terms**: \`${r.matched_terms.join("`, `")}\``);
      }
      lines.push(`  - **Snippet**: ${r.snippet}`);
    }
  }

  const maxLines = params.isAll === true ? 500 : 35;
  return enforceLineLimit(lines.join("\n"), maxLines);
}

import { join } from "node:path";
import type { MemoryKind, MemoryDocument, MemoryIndex } from "./types.ts";
import { tokenize, countTokens, extractGenerationFromCapsuleId } from "./types.ts";
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

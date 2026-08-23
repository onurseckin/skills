import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { enforceLineLimit } from "../cli/formatters/line-limiter.ts";
import { HarnessError } from "../errors/harness-error.ts";

export type MemoryKind = "capsule" | "blunder" | "decision" | "charter" | "report";

export const MEMORY_KINDS: readonly MemoryKind[] = [
  "capsule",
  "blunder",
  "decision",
  "charter",
  "report",
];

export interface MemoryDocument {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly title: string;
  readonly capsule_id: string | null;
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
  readonly query: string;
  readonly kind?: MemoryKind | readonly MemoryKind[] | "all" | string | undefined;
  readonly capsule?: string | readonly string[] | undefined;
  readonly minScore?: number | undefined;
  readonly limit?: number | undefined;
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
 * Creates a MemoryDocument from text contents and metadata.
 */
export function createMemoryDocument(params: {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly title: string;
  readonly capsule_id?: string | null | undefined;
  readonly source_path: string;
  readonly content: string;
  readonly snippet?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}): MemoryDocument {
  const fullSearchableText = `${params.id} ${params.title} ${params.content}`;
  const tokens = tokenize(fullSearchableText);
  const tokenCounts = countTokens(tokens);

  const snippet =
    params.snippet !== undefined && params.snippet.trim()
      ? params.snippet.trim()
      : params.content.length > 200
        ? `${params.content.slice(0, 197)}...`
        : params.content.trim();

  return {
    id: params.id,
    kind: params.kind,
    title: params.title,
    capsule_id: params.capsule_id !== undefined ? params.capsule_id : null,
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
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);

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
      const idx = lowerContent.indexOf(q);
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
 * Scores documents against a search query using BM25 with term matching boosts.
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

  for (let i = 0; i < queryTokens.length; i += 1) {
    const term = queryTokens[i];
    if (term === undefined) continue;

    const tf = doc.token_counts[term] ?? 0;
    if (tf > 0) {
      matchedTerms.push(term);
      const idf = index.idf.get(term) ?? 1.0;
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docLen / avgLen));
      let termScore = idf * (numerator / denominator);

      // Boost if term is present in document title or ID
      if (docTitleLower.includes(term) || docIdLower.includes(term)) {
        termScore *= 1.5;
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
 * Searches the memory index for relevant documents matching query and filters.
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

  // Normalize kind filter
  let allowedKinds: Set<string> | null = null;
  if (options.kind !== undefined && options.kind !== "all" && options.kind !== "") {
    if (Array.isArray(options.kind)) {
      allowedKinds = new Set(options.kind.map((k) => String(k).trim().toLowerCase()));
    } else {
      const splitKinds = String(options.kind)
        .split(",")
        .map((k) => k.trim().toLowerCase());
      allowedKinds = new Set(splitKinds);
    }
  }

  // Normalize capsule filter
  let allowedCapsules: Set<string> | null = null;
  if (options.capsule !== undefined && options.capsule !== "all" && options.capsule !== "") {
    if (Array.isArray(options.capsule)) {
      allowedCapsules = new Set(options.capsule.map((c) => String(c).trim().toLowerCase()));
    } else {
      const splitCapsules = String(options.capsule)
        .split(",")
        .map((c) => c.trim().toLowerCase());
      allowedCapsules = new Set(splitCapsules);
    }
  }

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

    if (queryTokens.length === 0) {
      // Return unranked if query is empty but filter matched
      results.push({
        id: doc.id,
        kind: doc.kind,
        title: doc.title,
        capsule_id: doc.capsule_id,
        source_path: doc.source_path,
        score: 1.0,
        snippet: doc.snippet,
        matched_terms: [],
        metadata: doc.metadata,
      });
      continue;
    }

    const { score, matchedTerms } = scoreDocumentBM25(doc, queryTokens, index);

    if (matchedTerms.length > 0 && score >= minScore) {
      const dynamicSnippet = extractSnippet(doc.snippet, queryTokens);
      results.push({
        id: doc.id,
        kind: doc.kind,
        title: doc.title,
        capsule_id: doc.capsule_id,
        source_path: doc.source_path,
        score,
        snippet: dynamicSnippet,
        matched_terms: matchedTerms,
        metadata: doc.metadata,
      });
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

  return results.slice(0, limit);
}

/**
 * Indexes charter documents from docs/mind/CHARTER.md, references, and docs.
 */
export function indexCharterDocuments(repoRoot: string): MemoryDocument[] {
  const documents: MemoryDocument[] = [];
  const visitedPaths = new Set<string>();

  const charterPath = join(repoRoot, "docs", "mind", "CHARTER.md");
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
          source_path: "docs/mind/CHARTER.md",
          content,
          snippet: content.slice(0, 200),
          metadata: { file: "docs/mind/CHARTER.md" },
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
              source_path: "docs/mind/CHARTER.md",
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
              source_path: "docs/mind/CHARTER.md",
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
  const refDir = join(repoRoot, "orchestrating-long-tasks", "references");
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
 * Indexes blunders from blunders.jsonl files across capsules and root directories.
 */
export function indexBlunderDocuments(capsulesDir: string, explicitRun?: string): MemoryDocument[] {
  const documents: MemoryDocument[] = [];
  const filesToScan: Array<{ capsule: string; filePath: string }> = [];

  const rootBlunders = join(capsulesDir, "blunders.jsonl");
  if (existsSync(rootBlunders)) {
    filesToScan.push({ capsule: "capsules-root", filePath: rootBlunders });
  }

  if (existsSync(capsulesDir)) {
    try {
      const entries = readdirSync(capsulesDir, { withFileTypes: true });
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (entry !== undefined && entry.isDirectory()) {
          const blunderPath = join(capsulesDir, entry.name, "blunders.jsonl");
          if (existsSync(blunderPath)) {
            filesToScan.push({ capsule: entry.name, filePath: blunderPath });
          }
        }
      }
    } catch {
      // Non-fatal capsules directory scan error
    }
  }

  if (explicitRun !== undefined) {
    const explicitBlunders = join(resolve(explicitRun), "blunders.jsonl");
    if (existsSync(explicitBlunders)) {
      filesToScan.push({ capsule: basename(resolve(explicitRun)), filePath: explicitBlunders });
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

            const searchableContent = `${parsed.id} ${parsed.type} ${category} ${status} ${severity} ${observation} ${remediation}`;
            const snippet = `[${severity.toUpperCase()} | ${status}] ${observation} Remediation: ${remediation}`;

            documents.push(
              createMemoryDocument({
                id: `blunder-${parsed.id}`,
                kind: "blunder",
                title: `Blunder [${parsed.id}]: ${parsed.type}`,
                capsule_id: item.capsule !== "capsules-root" ? item.capsule : null,
                source_path: item.filePath,
                content: searchableContent,
                snippet,
                metadata: {
                  blunder_id: parsed.id,
                  type: parsed.type,
                  severity,
                  status,
                  category,
                  observation,
                  remediation,
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
            source_path: promptPath,
            content: promptContent,
            snippet: promptContent.slice(0, 200),
            metadata: { capsule: cap.name, file: "prompt.md" },
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
            source_path: tracePath,
            content: traceContent,
            snippet: traceContent.slice(0, 200),
            metadata: { capsule: cap.name, file: "trace.md" },
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
                  source_path: statePath,
                  content,
                  snippet,
                  metadata: {
                    task_id: taskId,
                    status,
                    capsule: cap.name,
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
                  source_path: statePath,
                  content,
                  snippet,
                  metadata: {
                    candidate_id: candId,
                    status,
                    statement,
                    rationale,
                    decided_by: decidedBy,
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
                  source_path: statePath,
                  content,
                  snippet,
                  metadata: { audit_id: auditId, verdict, actor, capsule: cap.name },
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
              documents.push(
                createMemoryDocument({
                  id: `report-${cap.name}-${rentry.name.replace(/\.[^/.]+$/, "")}`,
                  kind: "report",
                  title: `Report: ${rentry.name} (${cap.name})`,
                  capsule_id: cap.name,
                  source_path: reportPath,
                  content,
                  snippet: content.slice(0, 200),
                  metadata: { filename: rentry.name, capsule: cap.name },
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
                    source_path: packetMd,
                    content: packetContent,
                    snippet: packetContent.slice(0, 200),
                    metadata: { packet_id: pentry.name, capsule: cap.name },
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
            const gen = typeof parsed["generation"] === "number" ? parsed["generation"] : 1;
            const completedAt =
              typeof parsed["completed_at"] === "string" ? parsed["completed_at"] : "";
            const type = typeof parsed["type"] === "string" ? parsed["type"] : "objective";

            const searchableContent = `${parsed["id"]} ${type} ${statement} gen-${gen} ${result} ${completedAt}`;
            const snippet = `[GEN ${gen} | ${result.toUpperCase()}] (${type}) ${statement}`;

            documents.push(
              createMemoryDocument({
                id: `archived-${parsed["id"]}`,
                kind: "decision",
                title: `Archived ${type.toUpperCase()} [${parsed["id"]}] (Gen ${gen})`,
                capsule_id: item.capsule !== "capsules-root" ? item.capsule : null,
                source_path: item.filePath,
                content: searchableContent,
                snippet,
                metadata: {
                  archived_id: parsed["id"],
                  type,
                  generation: gen,
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
 * Indexes all memory artifacts (charter, blunders, capsules, decisions, reports, archived objectives) into an integrated MemoryIndex.
 */
export function indexAllMemory(options: IndexMemoryOptions = {}): MemoryIndex {
  const repoRoot = options.repoRoot !== undefined ? resolve(options.repoRoot) : process.cwd();
  const capsulesDir =
    options.capsulesDir !== undefined ? resolve(options.capsulesDir) : join(repoRoot, ".capsules");
  const runRoot = options.runRoot !== undefined ? resolve(options.runRoot) : undefined;

  const charterDocs = indexCharterDocuments(repoRoot);
  const blunderDocs = indexBlunderDocuments(capsulesDir, runRoot);
  const capsuleDocs = indexCapsuleDocuments(capsulesDir, runRoot);
  const decisionDocs = indexDecisionDocuments(capsulesDir, runRoot);
  const reportDocs = indexReportDocuments(capsulesDir, runRoot);
  const archivedDocs = indexArchivedObjectiveDocuments(capsulesDir, runRoot);

  const documentMap = new Map<string, MemoryDocument>();

  const allLists = [charterDocs, blunderDocs, capsuleDocs, decisionDocs, reportDocs, archivedDocs];
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
  readonly isAll?: boolean | undefined;
}): string {
  const lines: string[] = [
    "### Semantic Knowledge & Memory Search Report",
    `- **Search Query**: \`${params.query}\``,
    `- **Total Memory Documents Indexed**: ${params.totalIndexed}`,
    `- **Matching Records Found**: ${params.results.length}`,
    params.kindFilter ? `- **Kind Filter**: \`${params.kindFilter}\`` : "- **Kind Filter**: `all`",
    params.runRoot !== null
      ? `- **Target Run Root**: \`${params.runRoot}\``
      : "- **Target Run Root**: *all*",
    "",
    "#### Search Results Matrix",
    renderAsciiMemoryTable(params.results),
  ];

  if (params.results.length > 0) {
    lines.push("");
    lines.push("#### Match Forensics & Context");
    for (let i = 0; i < params.results.length; i += 1) {
      const r = params.results[i];
      if (r === undefined) continue;
      lines.push(`- **\`${r.id}\`** [\`${r.kind}\`] (Score: \`${r.score.toFixed(3)}\`)`);
      lines.push(`  - **Title**: ${r.title}`);
      lines.push(`  - **Source**: \`${r.source_path}\``);
      if (r.capsule_id) {
        lines.push(`  - **Capsule**: \`${r.capsule_id}\``);
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

import { extractGeneration } from "./types.ts";
import { normalizeTags } from "./storage.ts";
import { basename } from "node:path";
import { enforceLineLimit } from "../../lifecycle/cadence/index.ts";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveCapsulesDir } from "../../../core/shared/paths.ts";
import type {
  MemoryDocument,
  MemoryIndex,
  MemoryQueryResult,
  IndexMemoryOptions,
} from "./types.ts";
import { createMemoryDocument, buildMemoryIndex } from "./storage.ts";
import { indexCharterDocuments, indexDefectDocuments } from "./indexer.ts";
import { indexCapsuleDocuments } from "./metrics.ts";
import { indexDecisionDocuments, indexReportDocuments } from "./tags.ts";
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
    options.capsulesDir !== undefined ? resolve(options.capsulesDir) : resolveCapsulesDir(repoRoot);
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

export function truncateString(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1)}…`;
}

export function padRight(str: string, width: number): string {
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

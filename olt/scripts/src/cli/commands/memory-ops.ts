import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { HarnessError } from "../../errors/harness-error.ts";
import {
  assertFlags,
  boolFlag,
  integerFlag,
  textFlag,
  type CommandContext,
  type Flags,
} from "../options.ts";
import {
  formatMemoryQueryBrief,
  indexAllMemory,
  searchMemory,
  type MemoryQueryResult,
} from "../../mind/memory.ts";
import { resolveCapsulesDir } from "../../shared/paths.ts";

export interface MemoryQueryCommandResult {
  readonly markdown: string;
  readonly query: string;
  readonly total_indexed: number;
  readonly total_matches: number;
  readonly capsules_dir: string;
  readonly run_root: string | null;
  readonly results: readonly MemoryQueryResult[];
  readonly generation_filter?: string | number | null;
  readonly kind_filter?: string | null;
  readonly tags_filter?: string | null;
  readonly pattern_filter?: string | null;
  readonly [key: string]: unknown;
}

/**
 * CLI command handler for memory:query / knowledge search operations.
 */
export function memoryQueryCommand(
  flags: Flags,
  context?: CommandContext,
): MemoryQueryCommandResult {
  assertFlags(flags, [
    "query",
    "run",
    "capsules-dir",
    "repo",
    "kind",
    "generation",
    "gen",
    "tag",
    "tags",
    "pattern",
    "limit",
    "min-score",
    "format",
    "all",
    "json",
    "now",
  ]);

  let query = textFlag(flags, "query", false);
  if (query === undefined && context?.inlinePrompt !== undefined) {
    query = context.inlinePrompt.trim();
  }

  const run = textFlag(flags, "run", false);
  const capsulesDirFlag = textFlag(flags, "capsules-dir", false);
  const repoFlag = textFlag(flags, "repo", false);
  const kindFlag = textFlag(flags, "kind", false);
  const rawGenFlag = textFlag(flags, "generation", false);
  const generationFlag = rawGenFlag !== undefined ? rawGenFlag : textFlag(flags, "gen", false);
  const rawTagsFlag = textFlag(flags, "tags", false);
  const tagsFlag = rawTagsFlag !== undefined ? rawTagsFlag : textFlag(flags, "tag", false);
  const patternFlag = textFlag(flags, "pattern", false);
  const parsedLimit = integerFlag(flags, "limit", { minimum: 1 });
  const limit = typeof parsedLimit === "number" ? parsedLimit : 10;
  const minScoreRaw = textFlag(flags, "min-score", false);
  const isAll = boolFlag(flags, "all");
  const now = textFlag(flags, "now", false);

  if (now !== undefined && !Number.isFinite(Date.parse(now))) {
    throw new HarnessError("INVALID_ARGUMENT", `invalid --now timestamp: ${now}`);
  }

  if (
    (query === undefined || !query.trim()) &&
    kindFlag === undefined &&
    generationFlag === undefined &&
    tagsFlag === undefined &&
    patternFlag === undefined &&
    run === undefined
  ) {
    throw new HarnessError("INVALID_ARGUMENT", "--query must have a non-blank value");
  }

  const normalizedQuery = query !== undefined ? query.trim() : "";

  let minScore = 0.0;
  if (minScoreRaw !== undefined) {
    const parsedMinScore = Number(minScoreRaw);
    if (!Number.isFinite(parsedMinScore) || parsedMinScore < 0) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `invalid --min-score: ${minScoreRaw}; must be a non-negative number`,
      );
    }
    minScore = parsedMinScore;
  }

  const repoRoot = repoFlag !== undefined ? resolve(repoFlag) : process.cwd();
  if (!existsSync(repoRoot)) {
    throw new HarnessError("INVALID_ARGUMENT", `repository root not found: ${repoFlag}`);
  }

  let resolvedCapsulesDir: string;
  if (capsulesDirFlag !== undefined) {
    resolvedCapsulesDir = resolve(capsulesDirFlag);
    if (!existsSync(resolvedCapsulesDir)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `capsules directory not found: ${capsulesDirFlag}`,
      );
    }
  } else if (run !== undefined) {
    const resolvedRun = resolve(run);
    const parentDir = dirname(resolvedRun);
    if (basename(parentDir) === ".capsules") {
      resolvedCapsulesDir = parentDir;
    } else if (existsSync(join(resolvedRun, ".capsules"))) {
      resolvedCapsulesDir = join(resolvedRun, ".capsules");
    } else {
      resolvedCapsulesDir = parentDir;
    }
  } else {
    resolvedCapsulesDir = resolveCapsulesDir(repoRoot);
  }

  const index = indexAllMemory({
    repoRoot,
    capsulesDir: resolvedCapsulesDir,
    runRoot: run !== undefined ? resolve(run) : undefined,
  });

  const searchResults = searchMemory(index, {
    query: normalizedQuery,
    kind: kindFlag,
    capsule: run !== undefined ? basename(resolve(run)) : undefined,
    generation: generationFlag,
    tags: tagsFlag,
    pattern: patternFlag,
    minScore,
    limit,
  });

  const markdown = formatMemoryQueryBrief({
    query: normalizedQuery,
    results: searchResults,
    totalIndexed: index.total_documents,
    capsulesDir: resolvedCapsulesDir,
    runRoot: run !== undefined ? resolve(run) : null,
    kindFilter: kindFlag,
    generationFilter: generationFlag,
    tagsFilter: tagsFlag,
    patternFilter: patternFlag,
    isAll,
  });

  return {
    markdown,
    query: normalizedQuery,
    total_indexed: index.total_documents,
    total_matches: searchResults.length,
    capsules_dir: resolvedCapsulesDir,
    run_root: run !== undefined ? resolve(run) : null,
    results: searchResults,
    generation_filter: generationFlag !== undefined ? generationFlag : null,
    kind_filter: kindFlag !== undefined ? kindFlag : null,
    tags_filter: tagsFlag !== undefined ? tagsFlag : null,
    pattern_filter: patternFlag !== undefined ? patternFlag : null,
  };
}

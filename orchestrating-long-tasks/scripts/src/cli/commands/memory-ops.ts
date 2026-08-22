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

export interface MemoryQueryCommandResult {
  readonly markdown: string;
  readonly query: string;
  readonly total_indexed: number;
  readonly total_matches: number;
  readonly capsules_dir: string;
  readonly run_root: string | null;
  readonly results: readonly MemoryQueryResult[];
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
  if (query === undefined || !query.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "--query must have a non-blank value");
  }

  const run = textFlag(flags, "run", false);
  const capsulesDirFlag = textFlag(flags, "capsules-dir", false);
  const repoFlag = textFlag(flags, "repo", false);
  const kindFlag = textFlag(flags, "kind", false);
  const limit = integerFlag(flags, "limit", { minimum: 1 }) ?? 10;
  const minScoreRaw = textFlag(flags, "min-score", false);
  const isAll = boolFlag(flags, "all");
  const now = textFlag(flags, "now", false);

  if (now !== undefined && !Number.isFinite(Date.parse(now))) {
    throw new HarnessError("INVALID_ARGUMENT", `invalid --now timestamp: ${now}`);
  }

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
    resolvedCapsulesDir = join(repoRoot, ".capsules");
  }

  const index = indexAllMemory({
    repoRoot,
    capsulesDir: resolvedCapsulesDir,
    runRoot: run !== undefined ? resolve(run) : undefined,
  });

  const searchResults = searchMemory(index, {
    query,
    kind: kindFlag,
    capsule: run !== undefined ? basename(resolve(run)) : undefined,
    minScore,
    limit,
  });

  const markdown = formatMemoryQueryBrief({
    query,
    results: searchResults,
    totalIndexed: index.total_documents,
    capsulesDir: resolvedCapsulesDir,
    runRoot: run !== undefined ? resolve(run) : null,
    kindFilter: kindFlag,
    isAll,
  });

  return {
    markdown,
    query,
    total_indexed: index.total_documents,
    total_matches: searchResults.length,
    capsules_dir: resolvedCapsulesDir,
    run_root: run !== undefined ? resolve(run) : null,
    results: searchResults,
  };
}

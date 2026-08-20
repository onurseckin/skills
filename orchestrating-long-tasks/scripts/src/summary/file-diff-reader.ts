import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isJsonObject } from "../contracts/json.ts";
import { diffAnchor, type DiffAnchor } from "../packets/round-repository-delta.ts";
import { repositoryGit, type RepositoryGitCommand } from "../packets/repository-git-command.ts";
import type { FileRef } from "./graph-types.ts";

/**
 * Per-path ceiling for a single file's diff. Smaller than the whole-repository ceiling in
 * `round-repository-delta.ts` because a single path never legitimately produces megabytes of output;
 * a path that does is a signal something is wrong, not a diff worth carrying whole.
 */
const DIFF_PATH_CEILING_BYTES = 1 * 1024 * 1024;

/**
 * The run's baseline repository inspection, read straight off `state.json` on disk. Reads the file
 * itself rather than taking a loaded `RunState`, because callers here (`changedFiles` for one task)
 * run once per task and the caller already holds only a `runRoot`; the anchor is identical for every
 * task in the same run, so `resolveDiffAnchor` below memoizes it instead of re-parsing per task.
 */
function readStateBaseline(runRoot: string): DiffAnchor | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(runRoot, "state.json"), "utf-8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isJsonObject(parsed)) return undefined;
  const digest = parsed.baseline_repository_inspection_sha256;
  const registry = parsed.repository_inspections;
  if (typeof digest !== "string" || !isJsonObject(registry)) return undefined;
  const inspection = registry[digest];
  if (!isJsonObject(inspection)) return undefined;
  return diffAnchor(inspection);
}

const anchorCache = new Map<string, DiffAnchor | undefined>();

/**
 * Memoized per run root: every task in one export shares the same baseline anchor. Not exported —
 * `enrichFileRefsWithDiffs` below is the module's one public entry point, and its own tests exercise
 * this indirectly through every anchor-resolution outcome (present, absent, dangling digest).
 */
function resolveDiffAnchor(runRoot: string): DiffAnchor | undefined {
  if (!anchorCache.has(runRoot)) anchorCache.set(runRoot, readStateBaseline(runRoot));
  return anchorCache.get(runRoot);
}

interface ParsedDiff {
  diff: string;
  lines: string;
  additions: number;
  deletions: number;
}

/** Hunk headers (`@@ -a,b +c,d @@`) collapsed into the compact range list `FileRef.lines` carries. */
function parseHunkRanges(diffText: string): string {
  const ranges: string[] = [];
  for (const line of diffText.split("\n")) {
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const length = match[2] !== undefined ? Number(match[2]) : 1;
    ranges.push(length <= 1 ? `${start}` : `${start}-${start + length - 1}`);
  }
  return ranges.join(",");
}

function countChanges(diffText: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

/**
 * The real diff for one path against the run's baseline, or `undefined` when Git, the baseline or a
 * change to this specific path is unavailable. Never a fabricated diff, and never zeroed-out counts
 * standing in for "nothing changed": a path this cannot measure stays unenriched.
 */
function readPathDiff(
  repositoryRoot: string,
  headCommit: string,
  path: string,
  command: RepositoryGitCommand,
): ParsedDiff | undefined {
  let bytes: Buffer;
  try {
    ({ bytes } = command(
      repositoryRoot,
      ["diff", "--no-ext-diff", "--no-textconv", headCommit, "--", path],
      DIFF_PATH_CEILING_BYTES,
    ));
  } catch {
    return undefined;
  }
  if (bytes.byteLength === 0) return undefined;
  const text = bytes.toString("utf8");
  const { additions, deletions } = countChanges(text);
  return { diff: text, lines: parseHunkRanges(text), additions, deletions };
}

/**
 * Populates `FileRef.lines`/`.diff`/`.additions`/`.deletions` from a real Git diff against the run's
 * baseline inspection (B15.2). `evidence_class` is left exactly as the caller set it: it describes how
 * the *path* came to be listed (an implementer's claim, a Git status reading), and a fresh diff reading
 * of already-listed content does not change who made that claim. A ref this cannot measure — no
 * baseline commit, no repository on disk, Git unavailable, or no change to that specific path — passes
 * through exactly as given rather than gaining a misleading empty diff.
 */
export function enrichFileRefsWithDiffs(
  files: readonly FileRef[],
  runRoot: string | undefined,
  command: RepositoryGitCommand = repositoryGit,
): FileRef[] {
  if (files.length === 0 || runRoot === undefined) return [...files];
  const anchor = resolveDiffAnchor(runRoot);
  const headCommit = anchor?.head_commit;
  if (headCommit === undefined || headCommit === null) return [...files];
  const repositoryRoot = dirname(dirname(runRoot));
  return files.map((file) => {
    const parsed = readPathDiff(repositoryRoot, headCommit, file.path, command);
    if (parsed === undefined) return file;
    // `evidence_class` describes how the *path* came to be listed (an implementer's claim, or a Git
    // status reading); the diff content added here does not change that provenance, so it is left
    // exactly as the caller set it rather than overwritten to "harness_observed" wholesale.
    return {
      ...file,
      diff: parsed.diff,
      lines: parsed.lines,
      additions: parsed.additions,
      deletions: parsed.deletions,
    };
  });
}

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isJsonObject } from "../../core/contracts/index.ts";
import { diffAnchor, type DiffAnchor } from "../../packets/round-repository-delta.ts";
import { repositoryGit, type RepositoryGitCommand } from "../../packets/repository-git-command.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import type { FileRef } from "../graph/graph-types.ts";

const DIFF_PATH_CEILING_BYTES = 1 * 1024 * 1024;

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

export function enrichFileRefsWithDiffs(
  files: readonly FileRef[],
  runRoot: string | undefined,
  command: RepositoryGitCommand = repositoryGit,
): FileRef[] {
  if (files.length === 0 || runRoot === undefined) return [...files];
  const anchor = resolveDiffAnchor(runRoot);
  const headCommit = anchor?.head_commit;
  if (headCommit === undefined || headCommit === null) return [...files];
  const repositoryRoot = findRepoRoot(runRoot);
  return files.map((file) => {
    const parsed = readPathDiff(repositoryRoot, headCommit, file.path, command);
    if (parsed === undefined) return file;
    return {
      ...file,
      diff: parsed.diff,
      lines: parsed.lines,
      additions: parsed.additions,
      deletions: parsed.deletions,
    };
  });
}

import { readdirSync, type Dirent } from "node:fs";
import { join, posix } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";

const EXCLUDED_DIRS = new Set([
  ".git",
  ".capsules",
  "node_modules",
  ".bun",
  ".cache",
  "coverage",
  "__pycache__",
]);

function segmentToRegex(segment: string): string {
  let out = "";
  for (const ch of segment) {
    if (ch === "*") out += "[^/]*";
    else if (ch === "?") out += "[^/]";
    else if (/[\\^$.|+()[\]{}]/u.test(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return out;
}

export function globToRegExp(glob: string): RegExp {
  const normalized = glob.trim().replace(/\\/gu, "/").replace(/^\.\//u, "");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  const parts: string[] = [];
  segments.forEach((segment, index) => {
    const isLast = index === segments.length - 1;
    if (segment === "**") {
      parts.push(isLast ? "(?:[^/]+/)*[^/]+" : "(?:[^/]+/)*");
    } else {
      parts.push(segmentToRegex(segment) + (isLast ? "" : "/"));
    }
  });
  return new RegExp(`^${parts.join("")}$`, "u");
}

export function enumerateGlobMatches(repoRoot: string, glob: string): string[] {
  const pattern = globToRegExp(glob);
  const matches: string[] = [];
  const walk = (absoluteDir: string, relativeDir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relativePath = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        walk(join(absoluteDir, entry.name), relativePath);
      } else if (entry.isFile() && pattern.test(relativePath)) {
        matches.push(relativePath);
      }
    }
  };
  walk(repoRoot, "");
  return matches.sort();
}

export type AutoPartitionGrouping = "file" | "directory";

export interface AutoPartitionEntry {
  readonly scope: string;
  readonly files: readonly string[];
}

export function partitionByGlob(
  repoRoot: string,
  glob: string,
  grouping: AutoPartitionGrouping,
): readonly AutoPartitionEntry[] {
  const files = enumerateGlobMatches(repoRoot, glob);
  if (files.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `--auto-partition glob '${glob}' matched no files under ${repoRoot}`,
    );
  }
  if (grouping === "file") {
    return files.map((file) => ({ scope: file, files: [file] }));
  }
  const byDirectory = new Map<string, string[]>();
  for (const file of files) {
    const directory = posix.dirname(file);
    const grouped = byDirectory.get(directory) ?? [];
    grouped.push(file);
    byDirectory.set(directory, grouped);
  }
  return [...byDirectory.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([scope, grouped]) => ({ scope, files: grouped.sort() }));
}

export function slugifyScope(scope: string): string {
  const slug = scope.replace(/[^a-zA-Z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (slug.length === 0) {
    throw new HarnessError("INTEGRITY", `scope '${scope}' has no usable characters for a task id`);
  }
  return slug;
}

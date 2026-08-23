import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".capsules",
  ".tmp",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  "target",
]);

const MAX_EXPANDED_FILES = 4000;

function walkFiles(absDir: string, acc: string[]): void {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (acc.length >= MAX_EXPANDED_FILES) return;
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      walkFiles(join(absDir, entry.name), acc);
    } else if (entry.isFile()) {
      acc.push(join(absDir, entry.name));
    }
  }
}

export function expandScopeEntry(repoRoot: string, rawEntry: string): string[] {
  const trimmed = rawEntry.trim();
  if (trimmed === "" || trimmed === "." || trimmed === "/" || trimmed === "**") {
    return [trimmed === "" ? "." : trimmed];
  }
  const abs = resolve(repoRoot, trimmed);
  if (!existsSync(abs)) return [trimmed];
  const stat = statSync(abs);
  if (!stat.isDirectory()) return [trimmed];
  const acc: string[] = [];
  walkFiles(abs, acc);
  if (acc.length === 0) return [trimmed];
  return acc.map((path) => relative(repoRoot, path).split("\\").join("/")).sort();
}

export function expandWriteScope(repoRoot: string, writeScope: readonly string[]): string[] {
  const files = new Set<string>();
  for (const entry of writeScope) {
    for (const file of expandScopeEntry(repoRoot, entry)) files.add(file);
  }
  return [...files].sort();
}

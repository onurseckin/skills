import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { scanSource, type ScannedSource } from "./scanner.ts";

export interface SourceFile {
  /** Absolute path. */
  readonly path: string;
  /** Path relative to the root the sweep started from, always with forward slashes. */
  readonly relative: string;
  readonly text: string;
  readonly scan: ScannedSource;
}

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".capsules",
  ".tmp",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "target",
  ".next",
]);

function walk(directory: string, acc: string[]): void {
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      walk(path, acc);
      continue;
    }
    if (entry.isFile()) acc.push(path);
  }
}

export function listFiles(root: string, extensions: readonly string[]): string[] {
  const absolute = resolve(root);
  if (!statSync(absolute, { throwIfNoEntry: false })?.isDirectory()) return [];
  const found: string[] = [];
  walk(absolute, found);
  return found.filter((path) => extensions.some((ext) => path.endsWith(ext))).sort();
}

export function loadSources(
  root: string,
  extensions: readonly string[] = [".ts"],
  relativeTo = root,
): SourceFile[] {
  return listFiles(root, extensions).map((path) => {
    const text = readFileSync(path, "utf-8");
    return {
      path,
      relative: relative(resolve(relativeTo), path).split("\\").join("/"),
      text,
      scan: scanSource(text),
    };
  });
}

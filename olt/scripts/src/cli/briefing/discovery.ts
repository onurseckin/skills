import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { resolveFilePath } from "./types.ts";

const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".turbo",
  "dist",
  "build",
  "coverage",
  ".cache",
  "scratch",
  ".olt",
  ".gemini",
  ".next",
  ".nuxt",
]);

const IGNORED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".lock",
  ".lockb",
  ".log",
  ".wasm",
  ".zip",
  ".tar",
  ".gz",
  ".pdf",
  ".map",
  ".d.ts",
]);

export function isTargetFilePath(item: string): boolean {
  if (item.endsWith("/")) {
    return false;
  }
  const base = basename(item);
  if (!base.includes(".")) {
    return false;
  }
  const ext = base.split(".").pop();
  if (ext !== undefined && IGNORED_EXTENSIONS.has(`.${ext}`)) {
    return false;
  }
  return true;
}

function walkDirectory(
  currentDir: string,
  baseDir: string,
  maxDepth = 4,
  currentDepth = 0,
): string[] {
  if (currentDepth > maxDepth || !existsSync(currentDir)) {
    return [];
  }

  const results: string[] = [];
  try {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env") {
        continue;
      }
      if (IGNORED_DIR_NAMES.has(entry.name)) {
        continue;
      }

      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = walkDirectory(fullPath, baseDir, maxDepth, currentDepth + 1);
        results.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = entry.name.includes(".") ? `.${entry.name.split(".").pop()}` : "";
        if (!IGNORED_EXTENSIONS.has(ext)) {
          const relPath = relative(baseDir, fullPath);
          results.push(relPath);
        }
      }
    }
  } catch {
    return [];
  }

  return results;
}

/**
 * Deterministically expands write-scope entries (both explicit files and directories)
 * into candidate target files, filtering out gitignored/scratch assets and disambiguating
 * extensionless directory paths.
 */
export function expandWriteScope(
  writeScope: readonly string[],
  baseDir?: string,
): readonly string[] {
  const root = baseDir !== undefined ? baseDir : process.cwd();
  const fileSet = new Set<string>();

  for (const item of writeScope) {
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const baseName = basename(trimmed);
    if (IGNORED_DIR_NAMES.has(trimmed) || IGNORED_DIR_NAMES.has(baseName)) {
      continue;
    }

    const fullPath = resolveFilePath(trimmed, root);
    if (!existsSync(fullPath)) {
      // Disambiguate: non-existent file with code extension vs non-existent directory
      if (isTargetFilePath(trimmed)) {
        fileSet.add(trimmed);
      }
      continue;
    }

    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        const discovered = walkDirectory(fullPath, root);
        for (const file of discovered) {
          fileSet.add(file);
        }
      } else if (stat.isFile()) {
        if (isTargetFilePath(trimmed)) {
          fileSet.add(trimmed);
        }
      }
    } catch {
      if (isTargetFilePath(trimmed)) {
        fileSet.add(trimmed);
      }
    }
  }

  return Array.from(fileSet).sort();
}

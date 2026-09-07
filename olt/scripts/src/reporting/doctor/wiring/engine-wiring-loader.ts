import { readFileSync, readdirSync, type Dirent } from "node:fs";
import { join, relative, sep } from "node:path";
import type { SourceDocument } from "./engine-wiring-contracts.ts";

export const ENGINE_WIRING_SOURCE_ROOTS: readonly string[] = ["olt/scripts", "scripts"];

const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", "coverage"]);

function isScannable(fileName: string): boolean {
  if (!fileName.endsWith(".ts") && !fileName.endsWith(".tsx")) return false;
  if (fileName.endsWith(".test.ts")) return false;
  if (fileName.endsWith(".spec.ts")) return false;
  return !fileName.endsWith(".d.ts");
}

function walk(directory: string, collected: string[]): void {
  let entries: readonly Dirent<string>[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(full, collected);
    } else if (isScannable(entry.name)) {
      collected.push(full);
    }
  }
}

export function loadEngineWiringDocuments(
  repoRoot: string,
  roots: readonly string[] = ENGINE_WIRING_SOURCE_ROOTS,
): readonly SourceDocument[] {
  const files: string[] = [];
  for (const root of roots) walk(join(repoRoot, root), files);
  const documents: SourceDocument[] = [];
  for (const file of files.sort()) {
    try {
      documents.push({
        path: relative(repoRoot, file).split(sep).join("/"),
        text: readFileSync(file, "utf-8"),
      });
    } catch {
      continue;
    }
  }
  return documents;
}

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildModules } from "../../olt/scripts/src/health/modules.ts";
import { loadSources, type SourceFile } from "../../olt/scripts/src/health/sources.ts";
import { scanSource } from "../../olt/scripts/src/health/scanner.ts";

const roots: string[] = [];

export function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `health-${prefix}-`)));
  roots.push(root);
  return root;
}

export function writeTree(root: string, files: Record<string, string>): string {
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  return root;
}

export function cleanupTempRoots(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

/** A single in-memory source file, for checks that read files rather than a module graph. */
export function sourceOf(relative: string, text: string): SourceFile {
  return { path: `/virtual/${relative}`, relative, text, scan: scanSource(text) };
}

export interface LoadedTree {
  readonly root: string;
  readonly files: SourceFile[];
  readonly modules: ReturnType<typeof buildModules>;
}

export function loadTree(prefix: string, files: Record<string, string>): LoadedTree {
  const root = writeTree(tempRoot(prefix), files);
  const sources = loadSources(root, [".ts"], root);
  return { root, files: sources, modules: buildModules(sources) };
}

export function pathsIn(tree: LoadedTree, ...relatives: string[]): string[] {
  return relatives.map((relative) => join(tree.root, relative));
}

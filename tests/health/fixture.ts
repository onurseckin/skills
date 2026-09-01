import { join } from "node:path";
import { buildModules } from "../../olt/scripts/src/health/modules.ts";
import { loadSources, type SourceFile } from "../../olt/scripts/src/health/sources.ts";
import { scanSource } from "../../olt/scripts/src/health/scanner.ts";
import {
  cleanupVirtualHealthFS,
  ensureVirtualHealthFS,
  vfs,
} from "./virtual-fs.ts";

export {
  cleanupVirtualHealthFS,
  setupVirtualHealthFS,
  ensureVirtualHealthFS,
} from "./virtual-fs.ts";

let rootCount = 0;

export function tempRoot(prefix: string): string {
  ensureVirtualHealthFS();
  const root = `/virtual/health-${prefix}-${++rootCount}`;
  vfs.mkdirSync(root, { recursive: true });
  return root;
}

export function writeTree(root: string, files: Record<string, string>): string {
  ensureVirtualHealthFS();
  if (!vfs.existsSync(root)) {
    vfs.mkdirSync(root, { recursive: true });
  }
  for (const [relative, contents] of Object.entries(files)) {
    const p = join(root, relative).replace(/\\/g, "/");
    const lastSlash = p.lastIndexOf("/");
    if (lastSlash > 0) {
      const parent = p.substring(0, lastSlash);
      if (!vfs.existsSync(parent)) vfs.mkdirSync(parent, { recursive: true });
    }
    vfs.writeFileSync(p, contents);
  }
  return root;
}

export function cleanupTempRoots(): void {
  cleanupVirtualHealthFS();
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
  return relatives.map((relative) => join(tree.root, relative).replace(/\\/g, "/"));
}

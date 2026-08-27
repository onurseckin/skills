import type { IndexedBlob } from "../../../../../scripts/modularity/inventory/index.ts";

export function blob(path: string, source: string): IndexedBlob {
  return { path, oid: "a".repeat(40), bytes: new TextEncoder().encode(source) };
}

export function indexedDirectory(
  directory: string,
  files: readonly string[],
): readonly IndexedBlob[] {
  return files.map((file) => blob(`${directory}/${file}`, "export const value = 1;\n"));
}

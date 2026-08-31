import { classifyPath } from "../core/index.ts";
import type { IndexedBlob } from "../inventory/index.ts";
import { resolveImport } from "./resolver.ts";
import { scanImports } from "./tokenizer.ts";

export interface ImportEdge {
  readonly from: string;
  readonly to: string;
  readonly typeOnly: boolean;
  readonly viaFacade: boolean;
}

function isFacadeTarget(to: string): boolean {
  return (
    to === "index.ts" ||
    to === "index.tsx" ||
    to === "index.mts" ||
    to === "index.cts" ||
    to.endsWith("/index.ts") ||
    to.endsWith("/index.tsx") ||
    to.endsWith("/index.mts") ||
    to.endsWith("/index.cts")
  );
}

export function buildImportEdges(blobs: readonly IndexedBlob[]): readonly ImportEdge[] {
  const pathSet = new Set(blobs.map((blob) => blob.path));
  return blobs.flatMap((blob) => {
    if (!classifyPath(blob.path).importScanned) return [];
    return scanImports(blob).flatMap((reference) => {
      if (!reference.specifier.startsWith(".")) return [];
      const to = resolveImport({ ...reference, from: blob.path }, pathSet);
      return {
        from: blob.path,
        to,
        typeOnly: reference.typeOnly,
        viaFacade: isFacadeTarget(to),
      };
    });
  });
}

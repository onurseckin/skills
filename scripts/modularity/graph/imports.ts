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

export function buildImportEdges(blobs: readonly IndexedBlob[]): readonly ImportEdge[] {
  const paths = blobs.map((blob) => blob.path);
  return blobs.flatMap((blob) => {
    if (!classifyPath(blob.path).importScanned) return [];
    return scanImports(blob).flatMap((reference) => {
      if (!reference.specifier.startsWith(".")) return [];
      const to = resolveImport({ ...reference, from: blob.path }, paths);
      const isFacade = to === "index.ts" ? true : to.endsWith("/index.ts");
      return {
        from: blob.path,
        to,
        typeOnly: reference.typeOnly,
        viaFacade: isFacade,
      };
    });
  });
}

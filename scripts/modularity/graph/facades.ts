import { classifyPath, type Violation } from "../core/index.ts";
import type { IndexedBlob } from "../inventory/index.ts";
import type { ImportEdge } from "./imports.ts";
import { countExportStars } from "./tokenizer.ts";

function dirname(path: string): string {
  const separator = path.lastIndexOf("/");
  if (separator < 0) return ".";
  return path.slice(0, separator);
}

function compare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function findMissingFacades(blobs: readonly IndexedBlob[]): readonly Violation[] {
  const directories = new Set(
    blobs
      .filter((blob) => {
        if (blob.path.startsWith("tests/")) return false;
        return classifyPath(blob.path).importScanned;
      })
      .map((blob) => dirname(blob.path))
      .filter((directory) => directory !== "."),
  );
  const paths = new Set(blobs.map((blob) => blob.path));
  return [...directories]
    .filter((directory) => !paths.has(`${directory}/index.ts`))
    .sort()
    .map((path) => ({
      rule: "missing_facade" as const,
      path,
      observed: "missing index.ts",
      detail: "TypeScript directory requires an explicit index.ts facade.",
    }));
}

export function findFacadeViolations(edges: readonly ImportEdge[]): readonly Violation[] {
  const unique = new Map<string, ImportEdge>();
  for (const edge of edges) {
    if (dirname(edge.from) !== dirname(edge.to) && !edge.viaFacade) {
      unique.set(`${edge.from}\0${edge.to}`, edge);
    }
  }
  return [...unique.values()]
    .sort((left, right) => {
      const fromDiff = compare(left.from, right.from);
      if (fromDiff !== 0) return fromDiff;
      return compare(left.to, right.to);
    })
    .map((edge) => ({
      rule: "facade_bypass" as const,
      path: edge.from,
      observed: edge.to,
      detail: "Cross-directory import must target the destination index.ts facade.",
    }));
}

export function findExportStarViolations(blobs: readonly IndexedBlob[]): readonly Violation[] {
  return blobs
    .filter((blob) => countExportStars(blob) > 0)
    .sort((left, right) => compare(left.path, right.path))
    .map((blob) => ({
      rule: "export_star" as const,
      path: blob.path,
      observed: countExportStars(blob),
      detail: "Facade must use explicit named exports instead of export-star.",
    }));
}

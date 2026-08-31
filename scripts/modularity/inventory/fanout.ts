import { classifyPath, type Violation } from "../core/index.ts";
import type { IndexedBlob } from "./git-index.ts";

const FANOUT_LIMIT = 10;

function dirname(path: string): string {
  const separator = path.lastIndexOf("/");
  if (separator < 0) return ".";
  return path.slice(0, separator);
}

export function findFanoutViolations(blobs: readonly IndexedBlob[]): readonly Violation[] {
  const counts = new Map<string, number>();
  for (const blob of blobs) {
    if (!classifyPath(blob.path).fanoutCounted) continue;
    const directory = dirname(blob.path);
    const existing = counts.get(directory);
    const count = existing !== undefined ? existing + 1 : 1;
    counts.set(directory, count);
  }
  return [...counts]
    .filter(([, observed]) => observed > FANOUT_LIMIT)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, observed]) => ({
      rule: "directory_fanout" as const,
      path,
      observed,
      limit: FANOUT_LIMIT,
      detail: "Directory exceeds the 10 direct-file limit.",
    }));
}

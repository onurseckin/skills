import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
  baselineFailure,
  compareEntries,
  entryIdentity,
  parseBaseline,
  PURITY_BASELINE_SCHEMA,
  serializeBaseline,
} from "../purity-baseline/index.ts";
import type { PurityBaseline } from "../purity-baseline/index.ts";

export { compareEntries, entryIdentity, parseBaseline, PURITY_BASELINE_SCHEMA, serializeBaseline };

export function assertInsideRepository(repoRoot: string, baselinePath: string): string {
  const root = resolve(repoRoot);
  const path = resolve(root, baselinePath);
  const pathRelative = relative(root, path);
  if (pathRelative === "") {
    baselineFailure("baseline path is outside the repository");
  }
  if (pathRelative === "..") {
    baselineFailure("baseline path is outside the repository");
  }
  if (pathRelative.startsWith(`..${sep}`)) {
    baselineFailure("baseline path is outside the repository");
  }
  return path;
}

export async function loadPurityBaseline(
  repoRoot: string,
  baselinePath: string,
): Promise<PurityBaseline> {
  const path = assertInsideRepository(repoRoot, baselinePath);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    baselineFailure("missing baseline file");
  }
  return parseBaseline(text);
}

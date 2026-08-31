import { posix } from "node:path";
import type { ImportReference } from "./tokenizer.ts";

export interface RelativeImportReference extends ImportReference {
  readonly from: string;
}

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"] as const;

function failure(from: string, specifier: string): never {
  throw new Error(`Unable to resolve relative import ${specifier} from ${from}`);
}

export function resolveImport(
  reference: RelativeImportReference,
  paths: ReadonlySet<string> | readonly string[],
): string {
  if (!reference.specifier.startsWith(".")) failure(reference.from, reference.specifier);
  const resolved = posix.normalize(posix.join(posix.dirname(reference.from), reference.specifier));
  if (resolved === "..") failure(reference.from, reference.specifier);
  if (resolved.startsWith("../")) failure(reference.from, reference.specifier);
  const known = paths instanceof Set ? paths : new Set(paths);
  const candidates: string[] = [resolved];
  if (resolved.endsWith(".js")) {
    const base = resolved.slice(0, -3);
    candidates.push(`${base}.ts`, `${base}.tsx`);
  } else if (resolved.endsWith(".mjs")) {
    const base = resolved.slice(0, -4);
    candidates.push(`${base}.mts`, `${base}.ts`);
  } else if (resolved.endsWith(".cjs")) {
    const base = resolved.slice(0, -4);
    candidates.push(`${base}.cts`, `${base}.ts`);
  } else if (resolved.endsWith(".jsx")) {
    const base = resolved.slice(0, -4);
    candidates.push(`${base}.tsx`);
  }
  for (const extension of EXTENSIONS) {
    candidates.push(`${resolved}${extension}`);
  }
  for (const extension of EXTENSIONS) {
    candidates.push(`${resolved}/index${extension}`);
  }
  const target = candidates.find((candidate) => known.has(candidate));
  if (target !== undefined) {
    return target;
  }
  return failure(reference.from, reference.specifier);
}

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
  paths: readonly string[],
): string {
  if (!reference.specifier.startsWith(".")) failure(reference.from, reference.specifier);
  const resolved = posix.normalize(posix.join(posix.dirname(reference.from), reference.specifier));
  if (resolved === "..") failure(reference.from, reference.specifier);
  if (resolved.startsWith("../")) failure(reference.from, reference.specifier);
  const known = new Set(paths);
  const candidates = [
    resolved,
    ...EXTENSIONS.map((extension) => `${resolved}${extension}`),
    `${resolved}/index.ts`,
  ];
  const target = candidates.find((candidate) => known.has(candidate));
  if (target !== undefined) {
    return target;
  }
  return failure(reference.from, reference.specifier);
}

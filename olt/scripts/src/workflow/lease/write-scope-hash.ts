import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { safeRepoPath } from "../../core/paths.ts";

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

function digestFile(absPath: string): string {
  const descriptor = openSync(absPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile())
      throw new HarnessError("PATH_SAFETY", `write scope entry is not a regular file: ${absPath}`);
    if (opened.size > MAX_FILE_BYTES)
      throw new HarnessError("INTEGRITY", `write scope file exceeds the hashing limit: ${absPath}`);
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      digest.update(buffer.subarray(0, count));
    }
    return digest.digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

function collect(
  root: string,
  absPath: string,
  budget: { count: number },
  into: Map<string, string>,
): void {
  let stat;
  try {
    stat = lstatSync(absPath);
  } catch {
    return;
  }
  if (stat.isSymbolicLink())
    throw new HarnessError("PATH_SAFETY", `write scope entry is a symlink: ${absPath}`);
  if (stat.isDirectory()) {
    for (const name of readdirSync(absPath).sort()) {
      budget.count += 1;
      if (budget.count > MAX_ENTRIES)
        throw new HarnessError("INTEGRITY", "write scope entry count exceeds the hashing limit");
      collect(root, join(absPath, name), budget, into);
    }
    return;
  }
  if (!stat.isFile()) return;
  into.set(relative(root, absPath).split(sep).join("/"), digestFile(absPath));
}

export function hashWriteScope(repoRoot: string, writeScope: readonly string[]): string {
  const files = new Map<string, string>();
  const budget = { count: 0 };
  for (const scope of [...new Set(writeScope)].sort()) {
    collect(repoRoot, safeRepoPath(repoRoot, scope), budget, files);
  }
  const manifest = [...files.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, sha256]) => `${path}:${sha256}`)
    .join("\n");
  return createHash("sha256").update(manifest).digest("hex");
}

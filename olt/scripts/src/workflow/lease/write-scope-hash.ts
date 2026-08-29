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
import type { Stats } from "node:fs";
import { join, relative, sep } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { safeRepoPath } from "../../core/paths.ts";

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

export type HashWriteScopeDependencies = {
  lstat?: (path: string) => Stats;
  open?: (path: string, flags: number) => number;
  read?: (
    descriptor: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null,
  ) => number;
};

function ownDataString(value: unknown, key: "code" | "message"): string | undefined {
  if ((typeof value !== "object" || value === null) && typeof value !== "function")
    return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor && typeof descriptor.value === "string"
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function safeCause(error: unknown): string {
  const message = ownDataString(error, "message");
  if (message !== undefined) return message;
  if ((typeof error === "object" && error !== null) || typeof error === "function")
    return "unknown error";
  try {
    return String(error);
  } catch {
    return "unknown error";
  }
}

function absentOrIntegrity(absPath: string, error: unknown): undefined {
  if (ownDataString(error, "code") === "ENOENT") return undefined;
  throw new HarnessError(
    "INTEGRITY",
    `write scope entry could not be inspected: ${absPath}: ${safeCause(error)}`,
  );
}

function digestFile(
  absPath: string,
  dependencies: Required<Pick<HashWriteScopeDependencies, "open" | "read">>,
): string | undefined {
  let descriptor: number;
  try {
    descriptor = dependencies.open(absPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    return absentOrIntegrity(absPath, error);
  }

  let result: string | undefined;
  let failure: unknown;
  let failed = false;
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile())
      throw new HarnessError("PATH_SAFETY", `write scope entry is not a regular file: ${absPath}`);
    if (opened.size > MAX_FILE_BYTES)
      throw new HarnessError("INTEGRITY", `write scope file exceeds the hashing limit: ${absPath}`);
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const count = dependencies.read(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      digest.update(buffer.subarray(0, count));
    }
    result = digest.digest("hex");
  } catch (error) {
    failure = error;
    failed = true;
  }

  try {
    closeSync(descriptor);
  } catch (error) {
    if (!failed) {
      failure = error;
      failed = true;
    }
  }

  if (failed) {
    if (failure instanceof HarnessError) throw failure;
    return absentOrIntegrity(absPath, failure);
  }
  return result;
}

function collect(
  root: string,
  absPath: string,
  budget: { count: number },
  into: Map<string, string>,
  lstat: (path: string) => Stats,
  dependencies: Required<Pick<HashWriteScopeDependencies, "open" | "read">>,
): void {
  let stat: Stats;
  try {
    stat = lstat(absPath);
  } catch (error) {
    return absentOrIntegrity(absPath, error);
  }
  if (stat.isSymbolicLink())
    throw new HarnessError("PATH_SAFETY", `write scope entry is a symlink: ${absPath}`);
  if (stat.isDirectory()) {
    let names: string[];
    try {
      names = readdirSync(absPath).sort();
    } catch (error) {
      return absentOrIntegrity(absPath, error);
    }
    for (const name of names) {
      budget.count += 1;
      if (budget.count > MAX_ENTRIES)
        throw new HarnessError("INTEGRITY", "write scope entry count exceeds the hashing limit");
      collect(root, join(absPath, name), budget, into, lstat, dependencies);
    }
    return;
  }
  if (!stat.isFile()) return;
  const digest = digestFile(absPath, dependencies);
  if (digest !== undefined) into.set(relative(root, absPath).split(sep).join("/"), digest);
}

export function hashWriteScope(
  repoRoot: string,
  writeScope: readonly string[],
  dependencies: HashWriteScopeDependencies = {},
): string {
  const files = new Map<string, string>();
  const budget = { count: 0 };
  const lstat = dependencies.lstat ?? lstatSync;
  const digestDependencies = {
    open: dependencies.open ?? openSync,
    read: dependencies.read ?? readSync,
  };
  for (const scope of [...new Set(writeScope)].sort()) {
    collect(repoRoot, safeRepoPath(repoRoot, scope), budget, files, lstat, digestDependencies);
  }
  const manifest = [...files.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, sha256]) => `${path}:${sha256}`)
    .join("\n");
  return createHash("sha256").update(manifest).digest("hex");
}

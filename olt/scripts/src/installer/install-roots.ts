import { lstat, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { HarnessError } from "../core/errors/harness-error.ts";

function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function canonicalCandidate(path: string): Promise<string> {
  let cursor = path;
  const missing: string[] = [];
  while (!(await lstat(cursor).catch(() => null))) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(basename(cursor));
    cursor = parent;
  }
  return join(await realpath(cursor), ...missing);
}

export async function validatedHome(source: string, home: string): Promise<string> {
  const requested = resolve(home);
  const existing = await lstat(requested).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
    throw new HarnessError("PATH_SAFETY", "home must be a real directory, not a symlink");
  }
  const requestedHome = await canonicalCandidate(requested);
  const sourceRoot = await realpath(source);
  if (contains(sourceRoot, requestedHome)) {
    throw new HarnessError("INVALID_ARGUMENT", "skill source and home must not overlap");
  }
  await mkdir(requestedHome, { recursive: true });
  const created = await lstat(requestedHome);
  if (!created.isDirectory() || created.isSymbolicLink()) {
    throw new HarnessError("PATH_SAFETY", "home must be a real directory, not a symlink");
  }
  const homeRoot = await realpath(requestedHome);
  if (contains(sourceRoot, homeRoot)) {
    throw new HarnessError("INVALID_ARGUMENT", "skill source and home must not overlap");
  }
  return homeRoot;
}

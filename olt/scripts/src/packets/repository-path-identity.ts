import { lstatSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { HarnessError } from "../core/errors/harness-error.ts";

interface PathIdentity {
  path: string;
  device: string;
  inode: string;
  mode: string;
}

export interface RepositoryLeafIdentity {
  path: string;
  ancestors: (PathIdentity | { path: string; missing: true })[];
}

function relativeLeaf(repo: string, value: string): { path: string; fromRoot: string } {
  if (!value || isAbsolute(value) || value.split(/[\\/]/u).includes(".."))
    throw new HarnessError("INTEGRITY", `repository listing contains an unsafe path: ${value}`);
  const path = resolve(repo, value);
  const fromRoot = relative(repo, path);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))
    throw new HarnessError("INTEGRITY", `repository listing escapes its root: ${value}`);
  return { path, fromRoot };
}

function ancestorIdentity(
  path: string,
  relativePath: string,
): PathIdentity | { path: string; missing: true } {
  try {
    const value = lstatSync(path, { bigint: true });
    if (value.isSymbolicLink())
      throw new HarnessError("INTEGRITY", `repository path has symbolic ancestor: ${relativePath}`);
    if (!value.isDirectory())
      throw new HarnessError(
        "INTEGRITY",
        `repository path ancestor is not a directory: ${relativePath}`,
      );
    return {
      path,
      device: value.dev.toString(),
      inode: value.ino.toString(),
      mode: value.mode.toString(),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, missing: true };
    throw error;
  }
}

export function captureRepositoryLeaf(repo: string, value: string): RepositoryLeafIdentity {
  const { path, fromRoot } = relativeLeaf(repo, value);
  const ancestors: RepositoryLeafIdentity["ancestors"] = [];
  let current = repo;
  for (const part of fromRoot.split(sep).slice(0, -1)) {
    current = join(current, part);
    ancestors.push(ancestorIdentity(current, value));
  }
  return { path, ancestors };
}

export function verifyRepositoryAncestors(identity: RepositoryLeafIdentity, value: string): void {
  for (const expected of identity.ancestors) {
    const observed = ancestorIdentity(expected.path, value);
    if ("missing" in expected) {
      if (!("missing" in observed))
        throw new HarnessError("INTEGRITY", `repository path ancestor changed: ${value}`);
      continue;
    }
    if (
      "missing" in observed ||
      observed.device !== expected.device ||
      observed.inode !== expected.inode ||
      observed.mode !== expected.mode
    ) {
      throw new HarnessError("INTEGRITY", `repository path ancestor changed: ${value}`);
    }
  }
}

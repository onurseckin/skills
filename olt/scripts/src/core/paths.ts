import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";

function unsafe(message: string): never {
  throw new HarnessError("PATH_SAFETY", message);
}

export function safeRepoPath(repoRoot: string, relativePath: string): string {
  if (!existsSync(repoRoot) || !lstatSync(repoRoot).isDirectory())
    unsafe(`repository root is not a directory: ${repoRoot}`);
  const root = realpathSync(repoRoot);
  if (!relativePath || relativePath === ".") unsafe("path must not be empty");
  if (isAbsolute(relativePath)) unsafe(`absolute paths are not allowed: ${relativePath}`);
  if (relativePath.split(/[\\/]/u).includes(".."))
    unsafe(`parent traversal is not allowed: ${relativePath}`);

  const resolved = resolve(root, relativePath);
  const fromRoot = relative(root, resolved);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    unsafe(`path escapes repository root: ${relativePath}`);
  }
  let current = root;
  for (const part of fromRoot.split(sep)) {
    current = join(current, part);
    let metadata;
    try {
      metadata = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      unsafe(`path component is unreadable: ${relativePath}`);
    }
    if (metadata.isSymbolicLink())
      unsafe(`symbolic path components are not allowed: ${relativePath}`);
  }
  return resolved;
}

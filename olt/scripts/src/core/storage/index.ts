import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";

export function getCanonicalPath(repoRoot: string, relativePath: string): string {
  if (!existsSync(repoRoot)) {
    throw new HarnessError("PATH_SAFETY", `Root not found: ${repoRoot}`);
  }
  const root = realpathSync(repoRoot);
  const resolved = resolve(root, relativePath);
  const fromRoot = relative(root, resolved);

  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new HarnessError("PATH_SAFETY", `Path escapes bounds: ${relativePath}`);
  }

  return resolved;
}

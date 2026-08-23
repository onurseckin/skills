import { closeSync, constants, fsyncSync, lstatSync, openSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fsyncDirectory } from "../core/durable-write.ts";
import { HarnessError } from "../core/errors/harness-error.ts";

export function syncTree(root: string): void {
  const directories: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const path = pending.pop()!;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink())
      throw new HarnessError("PATH_SAFETY", `cannot sync symlinked tree path: ${path}`);
    if (stat.isDirectory()) {
      directories.push(path);
      for (const name of readdirSync(path)) pending.push(join(path, name));
      continue;
    }
    if (!stat.isFile())
      throw new HarnessError("PATH_SAFETY", `cannot sync special tree path: ${path}`);
    const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }
  directories
    .sort((left, right) => right.split("/").length - left.split("/").length)
    .forEach(fsyncDirectory);
  fsyncDirectory(dirname(root));
}

import { createHash } from "node:crypto";
import { closeSync, lstatSync, opendirSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { CommandPathBinding } from "../../core/contracts/commands.ts";
import type { JsonObject } from "../../core/contracts/json.ts";
import { canonicalJsonBytes } from "../../core/json.ts";
import { collectBoundedDirectoryEntries } from "../../core/bounded-directory.ts";
import { safeRepoPath } from "../../core/paths.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import {
  createGateCaptureBudget,
  digestFile,
  metadata,
  openGatePath,
  MAX_GATE_PATH_BINDINGS,
  MAX_TREE_ENTRIES,
  type GateCaptureBudget,
  type GatePathHooks,
} from "./gate-path-file.ts";

export {
  createGateCaptureBudget,
  openGatePath,
  MAX_GATE_PATH_BINDINGS,
  type GateCaptureBudget,
  type GatePathHooks,
};

interface TreeEntry extends JsonObject {
  path: string;
  kind: "directory" | "file";
  mode: number;
  device: string;
  inode: string;
  bytes?: number;
  sha256?: string;
}

interface CaptureBase {
  argv_index: number;
  argument: string;
  operand: string;
  scope: "repository" | "system";
  role: "config" | "executable" | "program" | "target";
  canonical_path: string;
  relative_path?: string;
  executable: boolean;
}

function directoryNames(path: string, remaining: number, hooks: GatePathHooks): string[] {
  const opened =
    hooks.openDirectory?.(path) ??
    (() => {
      const directory = opendirSync(path);
      return {
        readSync: () => directory.readSync()?.name ?? null,
        closeSync: () => directory.closeSync(),
      };
    })();
  return collectBoundedDirectoryEntries(
    opened,
    remaining,
    () => new HarnessError("INVALID_STATE", "gate-bound directory exceeds entry limit"),
    (left, right) => (left < right ? -1 : left > right ? 1 : 0),
  );
}

function treeEntries(
  repositoryRoot: string,
  directory: string,
  hooks: GatePathHooks,
  budget: GateCaptureBudget,
): TreeEntry[] {
  const canonicalRoot = realpathSync(repositoryRoot);
  const entries: TreeEntry[] = [];
  const visit = (current: string): void => {
    const names = directoryNames(current, MAX_TREE_ENTRIES - budget.treeEntries, hooks);
    budget.treeEntries += names.length;
    for (const name of names) {
      const path = join(current, name);
      const lexical = relative(canonicalRoot, path);
      if (lexical === ".." || lexical.startsWith(`..${sep}`))
        throw new HarnessError("PATH_SAFETY", "gate tree entry escapes repository root");
      const link = (hooks.lstatPath ?? lstatSync)(path);
      if (link.isSymbolicLink())
        throw new HarnessError(
          "PATH_SAFETY",
          "gate tree must not contain symbolic links (symlinks)",
        );
      if (!link.isFile() && !link.isDirectory())
        throw new HarnessError("PATH_SAFETY", "gate tree entry is not a regular file or directory");
      safeRepoPath(canonicalRoot, lexical);
      let descriptor: number;
      try {
        descriptor = openGatePath(path, hooks);
      } catch (error) {
        throw new HarnessError(
          "PATH_SAFETY",
          `gate tree contains an unsafe entry: ${String(error)}`,
        );
      }
      try {
        const info = metadata(descriptor);
        const entry: TreeEntry = {
          path: relative(directory, path).split(sep).join("/"),
          kind: info.kind,
          mode: info.mode,
          device: info.device,
          inode: info.inode,
        };
        if (info.kind === "file") {
          Object.assign(entry, digestFile(descriptor, info.size, budget, hooks, true));
        }
        entries.push(entry);
        if (info.kind === "directory") visit(path);
      } finally {
        closeSync(descriptor);
      }
    }
  };
  visit(directory);
  return entries;
}

export function captureOpenedPath(
  descriptor: number,
  repositoryRoot: string,
  base: CaptureBase,
  hooks: GatePathHooks = {},
  budget: GateCaptureBudget = createGateCaptureBudget(),
): CommandPathBinding {
  budget.bindings += 1;
  if (budget.bindings > MAX_GATE_PATH_BINDINGS)
    throw new HarnessError("INVALID_STATE", "gate path capture exceeds binding limit");
  const info = metadata(descriptor);
  const binding: CommandPathBinding = {
    ...base,
    kind: info.kind,
    device: info.device,
    inode: info.inode,
    mode: info.mode,
  };
  if (info.kind === "file")
    return { ...binding, ...digestFile(descriptor, info.size, budget, hooks, false) };
  if (base.scope !== "repository")
    throw new HarnessError("PATH_SAFETY", "system executable cannot be a directory");
  const entries = treeEntries(repositoryRoot, base.canonical_path, hooks, budget);
  return {
    ...binding,
    entries: entries.length,
    tree_bytes: entries.reduce(
      (sum, entry) => (typeof entry.bytes === "number" ? sum + entry.bytes : sum),
      0,
    ),
    tree_sha256: createHash("sha256").update(canonicalJsonBytes(entries)).digest("hex"),
  };
}

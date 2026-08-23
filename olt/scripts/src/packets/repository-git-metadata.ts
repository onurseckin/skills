import { lstatSync, realpathSync } from "node:fs";
import type { Stats } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";
import {
  readRepositoryGitControlFile,
  type RepositoryGitFileHooks,
} from "./repository-git-safe-file.ts";

const POINTER_MAXIMUM = 4096;
const CONTROL_MAXIMUM = 16 * 1024 * 1024;

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function locateMetadata(repoRoot: string, hooks: RepositoryGitFileHooks): string | null {
  const inspect = hooks.lstatPath ?? lstatSync;
  let directory = realpathSync(resolve(repoRoot));
  while (true) {
    const candidate = join(directory, ".git");
    let metadata: Stats;
    try {
      metadata = inspect(candidate);
    } catch (error) {
      if (!missing(error)) throw error;
      const parent = dirname(directory);
      if (parent === directory) return null;
      directory = parent;
      continue;
    }
    if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile()))
      throw new HarnessError("INTEGRITY", "repository Git metadata path is symbolic or invalid");
    if (realpathSync(candidate) !== candidate)
      throw new HarnessError("INTEGRITY", "repository Git metadata path is not canonical");
    return candidate;
  }
}

function directory(path: string, label: string, hooks: RepositoryGitFileHooks): string {
  const value = (hooks.lstatPath ?? lstatSync)(path);
  if (value.isSymbolicLink() || !value.isDirectory() || realpathSync(path) !== path)
    throw new HarnessError("INTEGRITY", `repository ${label} path is symbolic or invalid`);
  return path;
}

function line(bytes: Buffer, label: string): string {
  let value: string;
  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new HarnessError("INTEGRITY", `repository ${label} is not UTF-8: ${String(error)}`);
  }
  if (value.endsWith("\n")) value = value.slice(0, -1);
  if (value.endsWith("\r")) value = value.slice(0, -1);
  if (!value || value.includes("\0") || value.includes("\n") || value.includes("\r"))
    throw new HarnessError("INTEGRITY", `repository ${label} is invalid`);
  return value;
}

function control(
  path: string,
  label: string,
  maximum: number,
  hooks: RepositoryGitFileHooks,
): Buffer | null {
  return readRepositoryGitControlFile(path, label, maximum, hooks)?.bytes ?? null;
}

function optionalDirectory(path: string, label: string, hooks: RepositoryGitFileHooks): void {
  try {
    directory(path, label, hooks);
  } catch (error) {
    if (!missing(error)) throw error;
  }
}

export function hasRepositoryGitMetadata(repoRoot: string): boolean {
  return locateMetadata(repoRoot, {}) !== null;
}

export function preflightRepositoryGitMetadata(
  repoRoot: string,
  hooks: RepositoryGitFileHooks = {},
): boolean {
  const metadataPath = locateMetadata(repoRoot, hooks);
  if (metadataPath === null) return false;
  const metadata = (hooks.lstatPath ?? lstatSync)(metadataPath);
  let gitDir: string;
  if (metadata.isDirectory()) gitDir = directory(metadataPath, "Git directory", hooks);
  else {
    const pointer = control(metadataPath, "worktree/.git", POINTER_MAXIMUM, hooks);
    if (!pointer) throw new HarnessError("INTEGRITY", "repository worktree Git file disappeared");
    const value = line(pointer, "worktree Git file");
    if (!value.startsWith("gitdir: "))
      throw new HarnessError("INTEGRITY", "repository worktree Git file is invalid");
    gitDir = directory(
      resolve(dirname(metadataPath), value.slice("gitdir: ".length)),
      "Git directory",
      hooks,
    );
  }
  const commonPointer = control(
    join(gitDir, "commondir"),
    "git-dir/commondir",
    POINTER_MAXIMUM,
    hooks,
  );
  const commonDir = commonPointer
    ? directory(
        resolve(gitDir, line(commonPointer, "common directory pointer")),
        "Git common directory",
        hooks,
      )
    : gitDir;
  control(join(gitDir, "gitdir"), "git-dir/gitdir", POINTER_MAXIMUM, hooks);
  control(join(gitDir, "config.worktree"), "git-dir/config.worktree", CONTROL_MAXIMUM, hooks);
  control(join(commonDir, "config"), "common-dir/config", CONTROL_MAXIMUM, hooks);
  const info = join(commonDir, "info");
  optionalDirectory(info, "Git info directory", hooks);
  control(join(info, "attributes"), "common-dir/info/attributes", CONTROL_MAXIMUM, hooks);
  control(join(info, "exclude"), "common-dir/info/exclude", CONTROL_MAXIMUM, hooks);
  return true;
}

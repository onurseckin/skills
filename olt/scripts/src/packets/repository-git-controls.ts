import { lstatSync, realpathSync } from "node:fs";
import type { Stats } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { JsonObject } from "../contracts/json.ts";
import { canonicalJsonBytes, sha256Bytes } from "../core/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { commandOutputRetryingEmpty, type RepositoryGitCommand } from "./repository-git-command.ts";
import { rejectLocalGitHelpers } from "./repository-git-helper-policy.ts";
import { readRepositoryGitControlFile } from "./repository-git-safe-file.ts";

interface GitControlNode extends JsonObject {
  name: string;
  node_type: "directory" | "file" | "missing";
  mode: number | null;
  bytes: number;
  sha256: string | null;
}

type FileStat = Stats;

function sameStat(left: FileStat, right: FileStat): boolean {
  const identity = (value: FileStat) =>
    [value.dev, value.ino, value.mode, value.size, value.mtimeMs, value.ctimeMs].join(":");
  return identity(left) === identity(right);
}

function rawPathOutput(
  repo: string,
  argv: string[],
  maximum: number,
  command: RepositoryGitCommand,
): string {
  return commandOutputRetryingEmpty(repo, argv, maximum, command).bytes.toString("utf8").trim();
}

function gitDirectory(
  repo: string,
  argv: string[],
  label: string,
  command: RepositoryGitCommand,
): string {
  const value = rawPathOutput(repo, argv, 4096, command);
  if (!isAbsolute(value) || value.includes("\0") || value.includes("\n"))
    throw new HarnessError("INTEGRITY", `repository ${label} path is invalid`);
  const path = resolve(value);
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || realpathSync(path) !== path)
    throw new HarnessError("INTEGRITY", `repository ${label} has a symbolic path`);
  return path;
}

function controlNode(
  path: string,
  name: string,
  maximum: number,
  allowDirectory = false,
): GitControlNode {
  let pathStat: FileStat;
  try {
    pathStat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { name, node_type: "missing", mode: null, bytes: 0, sha256: null };
    throw error;
  }
  if (pathStat.isSymbolicLink())
    throw new HarnessError("INTEGRITY", `repository Git control is symbolic: ${name}`);
  if (pathStat.isDirectory()) {
    if (!allowDirectory)
      throw new HarnessError("INTEGRITY", `repository Git control is not a file: ${name}`);
    if (!sameStat(pathStat, lstatSync(path)))
      throw new HarnessError("INTEGRITY", `repository Git control changed during scan: ${name}`);
    return {
      name,
      node_type: "directory",
      mode: Number(pathStat.mode) & 0o7777,
      bytes: 0,
      sha256: null,
    };
  }
  if (!pathStat.isFile())
    throw new HarnessError("INTEGRITY", `repository Git control is not a regular file: ${name}`);
  const value = readRepositoryGitControlFile(path, name, maximum);
  if (!value || !sameStat(pathStat, value.metadata))
    throw new HarnessError("INTEGRITY", `repository Git control changed during scan: ${name}`);
  return {
    name,
    node_type: "file",
    mode: Number(value.metadata.mode) & 0o7777,
    bytes: value.bytes.byteLength,
    sha256: sha256Bytes(value.bytes),
  };
}

function rejectIndirection(
  repo: string,
  path: string,
  node: GitControlNode,
  maximum: number,
  command: RepositoryGitCommand,
): void {
  if (node.node_type === "missing") return;
  const result = command(
    repo,
    [
      "config",
      "--file",
      path,
      "--no-includes",
      "--get-regexp",
      "^(include(if)?\\.|core\\.attributesfile$)",
    ],
    maximum,
    [0, 1],
  );
  if (result.status === 0)
    throw new HarnessError("INTEGRITY", "repository Git config indirection is unsupported");
}

export function inspectRepositoryGitControls(
  repo: string,
  command: RepositoryGitCommand,
  maximum: number,
  totalMaximum: number,
): { bytes: number; sha256: string } {
  const gitDir = gitDirectory(repo, ["rev-parse", "--absolute-git-dir"], "Git directory", command);
  const commonDir = gitDirectory(
    repo,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    "Git common directory",
    command,
  );
  const value = rawPathOutput(repo, ["rev-parse", "--git-path", "config.worktree"], 4096, command);
  const worktreeConfig = resolve(repo, value);
  if (
    !value ||
    value.includes("\0") ||
    value.includes("\n") ||
    worktreeConfig !== join(gitDir, "config.worktree")
  )
    throw new HarnessError("INTEGRITY", "repository worktree config path is invalid");
  const info = join(commonDir, "info");
  try {
    const metadata = lstatSync(info);
    if (metadata.isSymbolicLink() || !metadata.isDirectory())
      throw new HarnessError("INTEGRITY", "repository Git info path is symbolic or invalid");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const commonConfig = controlNode(join(commonDir, "config"), "common-dir/config", maximum);
  const worktreeConfigNode = controlNode(worktreeConfig, "git-dir/config.worktree", maximum);
  const nodes = [
    controlNode(join(repo, ".git"), "worktree/.git", maximum, true),
    controlNode(join(gitDir, "commondir"), "git-dir/commondir", maximum),
    controlNode(join(gitDir, "gitdir"), "git-dir/gitdir", maximum),
    worktreeConfigNode,
    commonConfig,
    controlNode(join(info, "attributes"), "common-dir/info/attributes", maximum),
    controlNode(join(info, "exclude"), "common-dir/info/exclude", maximum),
  ];
  rejectIndirection(repo, join(commonDir, "config"), commonConfig, maximum, command);
  rejectIndirection(repo, worktreeConfig, worktreeConfigNode, maximum, command);
  if (commonConfig.node_type !== "missing")
    rejectLocalGitHelpers(repo, join(commonDir, "config"), maximum, command);
  if (worktreeConfigNode.node_type !== "missing")
    rejectLocalGitHelpers(repo, worktreeConfig, maximum, command);
  if (nodes.reduce((sum, node) => sum + node.bytes, 0) > totalMaximum)
    throw new HarnessError("INTEGRITY", "repository Git controls total byte limit exceeded");
  const manifest = canonicalJsonBytes({
    schema: "harness.repository-git-controls",
    version: 1,
    nodes,
  });
  return { bytes: manifest.byteLength, sha256: sha256Bytes(manifest) };
}

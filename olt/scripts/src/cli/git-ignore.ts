import { resolve } from "node:path";
import { HarnessError } from "../core/errors/harness-error.ts";
import {
  repositoryGit,
  repositoryWorktree,
  type RepositoryGitCommand,
} from "../packets/repository-git-command.ts";
import { hasRepositoryGitMetadata } from "../packets/repository-git-metadata.ts";

export function ensureHarnessIgnored(
  repo: string,
  command: RepositoryGitCommand = repositoryGit,
): "gitignored" | "not-a-git-worktree" {
  const root = resolve(repo);
  if (!hasRepositoryGitMetadata(root) || !repositoryWorktree(root, command)) {
    return "not-a-git-worktree";
  }
  const checkPaths = [".olt/capsules/probe", "capsules/probe", ".capsules/probe"];
  const isIgnored = checkPaths.some(
    (p) => command(root, ["check-ignore", "--quiet", p], 1024, [0, 1]).status === 0,
  );
  if (!isIgnored) {
    throw new HarnessError(
      "INVALID_STATE",
      ".olt/capsules (or capsules) must be gitignored before initializing a run",
    );
  }
  return "gitignored";
}

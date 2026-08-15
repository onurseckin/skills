import { resolve } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";
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
  const ignored = command(root, ["check-ignore", "--quiet", ".capsules/probe"], 1024, [0, 1]);
  if (ignored.status !== 0) {
    throw new HarnessError(
      "INVALID_STATE",
      ".capsules must be gitignored before initializing a run",
    );
  }
  return "gitignored";
}

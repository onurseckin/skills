import { HarnessError } from "../../errors/harness-error.ts";
import {
  repositoryGit,
  repositoryWorktree,
  type RepositoryGitCommand,
} from "../../packets/repository-git-command.ts";
import { hasRepositoryGitMetadata } from "../../packets/repository-git-metadata.ts";
import { decodeNulRecords } from "../../packets/repository-git-paths.ts";

const MAX_STATUS_BYTES = 4 * 1024 * 1024;
const RENAME_STATUS = new Set(["R", "C"]);

function statusPath(record: string): { code: string; path: string } {
  // `--porcelain=v1 -z` records are `XY<space><path>`; anything shorter cannot carry a path.
  if (record.length < 4 || record[2] !== " ")
    throw new HarnessError("INTEGRITY", "repository status record is malformed");
  return { code: record.slice(0, 2), path: record.slice(3) };
}

/**
 * The working-tree paths Git reports as changed, or null when the repository has no Git metadata —
 * an unobservable repository yields no observation rather than an empty (and therefore misleading)
 * change set.
 */
export function observeChangedFiles(
  repo: string,
  command: RepositoryGitCommand = repositoryGit,
): string[] | null {
  if (!hasRepositoryGitMetadata(repo) || !repositoryWorktree(repo, command)) return null;
  const output = command(
    repo,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"],
    MAX_STATUS_BYTES,
  ).bytes;
  const records = decodeNulRecords(output, "status");
  const paths: string[] = [];
  let pendingOrigin = false;
  for (const record of records) {
    // `--no-renames` is requested above, but a Git build that ignores it still emits the rename
    // origin as a bare follow-on record, so the prefix-less record is consumed rather than parsed.
    if (pendingOrigin) {
      paths.push(record);
      pendingOrigin = false;
      continue;
    }
    const { code, path } = statusPath(record);
    paths.push(path);
    pendingOrigin = RENAME_STATUS.has(code[0]!) || RENAME_STATUS.has(code[1]!);
  }
  if (pendingOrigin)
    throw new HarnessError("INTEGRITY", "repository status rename record lacks its origin path");
  return [...new Set(paths)].sort();
}

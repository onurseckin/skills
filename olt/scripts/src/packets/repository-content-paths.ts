import { lstatSync, opendirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { collectBoundedDirectoryEntries } from "../core/bounded-directory.ts";
import { HarnessError } from "../errors/harness-error.ts";
import type { RepositoryContentPath } from "./repository-content-types.ts";
import {
  DEFAULT_REPOSITORY_CONTENT_POLICY,
  decodeRepositoryContentPath,
  resolveRepositoryContentPolicy,
  validateRepositoryContentPath,
  type RepositoryContentLimits,
  type RepositoryContentScanPolicy,
} from "./repository-content-policy.ts";
import { repositoryGit, repositoryWorktree } from "./repository-git-command.ts";
import { hasRepositoryGitMetadata } from "./repository-git-metadata.ts";
import { gitRepositoryPaths } from "./repository-git-paths.ts";

export type { RepositoryContentPath, RepositoryIndexEntry } from "./repository-content-types.ts";

const MAX_DIRECTORY_ENTRIES = 50_000;

function excluded(path: string): boolean {
  const [root] = path.split("/");
  return root === ".git" || root === ".capsules";
}

function gitRepository(repo: string): boolean {
  return hasRepositoryGitMetadata(repo) && repositoryWorktree(repo, repositoryGit);
}

function directoryPaths(
  repo: string,
  maximum: number,
  policy: Readonly<RepositoryContentScanPolicy>,
  maxEntries: number = MAX_DIRECTORY_ENTRIES,
): RepositoryContentPath[] {
  const found: RepositoryContentPath[] = [];
  const pending = [repo];
  let listingBytes = 0;
  let visited = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const opened = opendirSync(directory, { encoding: "buffer" as BufferEncoding });
    const entries = collectBoundedDirectoryEntries(
      {
        readSync: () => {
          const entry = opened.readSync() as unknown;
          if (entry === null) return null;
          if (entry instanceof Uint8Array) return Buffer.from(entry);
          return Buffer.from((entry as { name: string | Uint8Array }).name);
        },
        closeSync: () => opened.closeSync(),
      },
      maxEntries - visited,
      () => new HarnessError("INTEGRITY", "repository content traversal limit exceeded"),
      Buffer.compare,
    );
    for (const entry of entries) {
      visited += 1;
      const absolute = join(directory, decodeRepositoryContentPath(entry));
      const path = validateRepositoryContentPath(
        relative(repo, absolute).split(sep).join("/"),
        policy,
      );
      if (excluded(path)) continue;
      const metadata = lstatSync(absolute);
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
        pending.push(absolute);
        continue;
      }
      listingBytes += Buffer.byteLength(path) + 1;
      if (listingBytes > maximum)
        throw new HarnessError("INTEGRITY", "repository content listing byte limit exceeded");
      found.push({ path, index: [] });
    }
  }
  return found;
}

export function repositoryContentPaths(
  repo: string,
  maximum: number,
  policy: Readonly<RepositoryContentLimits> = DEFAULT_REPOSITORY_CONTENT_POLICY,
  maxEntries: number = MAX_DIRECTORY_ENTRIES,
): RepositoryContentPath[] {
  const configured = resolveRepositoryContentPolicy(policy);
  const values = gitRepository(repo)
    ? gitRepositoryPaths(repo, maximum, configured)
    : directoryPaths(repo, maximum, configured, maxEntries);
  const paths = values
    .map(({ path, index }) => ({ path: validateRepositoryContentPath(path, configured), index }))
    .filter(({ path }) => !excluded(path))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(paths.map(({ path }) => path)).size !== paths.length)
    throw new HarnessError("INTEGRITY", "repository content listing contains duplicate paths");
  return paths;
}

import { HarnessError } from "../core/errors/index.ts";
import type { RepositoryContentPath, RepositoryIndexEntry } from "./repository-content-types.ts";
import {
  DEFAULT_REPOSITORY_CONTENT_POLICY,
  resolveRepositoryContentPolicy,
  validateRepositoryContentPath,
  type RepositoryContentLimits,
} from "./repository-content-policy.ts";
import { repositoryGit, type RepositoryGitCommand } from "./repository-git-command.ts";

function listing(
  repo: string,
  argv: string[],
  maximum: number,
  label: string,
  command: RepositoryGitCommand,
): Buffer {
  const output = command(repo, argv, maximum).bytes;
  if (output.byteLength > maximum)
    throw new HarnessError("INTEGRITY", `repository ${label} listing byte limit exceeded`);
  return output;
}

export function decodeNulRecords(output: Buffer, label: string): string[] {
  if (output.byteLength === 0) return [];
  if (output.at(-1) !== 0)
    throw new HarnessError("INTEGRITY", `repository ${label} listing lacks terminal NUL`);
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(output.subarray(0, -1));
  } catch (error) {
    throw new HarnessError("INTEGRITY", `repository ${label} path is not UTF-8: ${String(error)}`);
  }
  const records = decoded.split("\0");
  if (records.some((record) => record === ""))
    throw new HarnessError("INTEGRITY", `repository ${label} listing contains an empty record`);
  return records;
}

function stagedRecord(value: string): { path: string; entry: RepositoryIndexEntry } {
  const match = /^(\d{6}) ([0-9a-f]{40,64}) ([0-3])\t([\s\S]+)$/u.exec(value);
  if (!match)
    throw new HarnessError("INTEGRITY", "repository staged listing contains an invalid record");
  return {
    path: match[4]!,
    entry: { mode: match[1]!, oid: match[2]!, stage: Number(match[3]) },
  };
}

export function rejectRepositoryGitlinks(records: readonly string[]): void {
  for (const value of records) {
    const { path, entry } = stagedRecord(value);
    if (entry.mode === "160000")
      throw new HarnessError(
        "INTEGRITY",
        `repository gitlink/submodule nodes are unsupported: ${path}`,
      );
  }
}

export function gitRepositoryPaths(
  repo: string,
  maximum: number,
  policy: Readonly<RepositoryContentLimits> = DEFAULT_REPOSITORY_CONTENT_POLICY,
  command: RepositoryGitCommand = repositoryGit,
): RepositoryContentPath[] {
  const configured = resolveRepositoryContentPolicy(policy);
  const staged = decodeNulRecords(
    listing(repo, ["ls-files", "--stage", "-z", "--cached"], maximum, "staged", command),
    "staged",
  );
  const untracked = decodeNulRecords(
    listing(
      repo,
      ["ls-files", "-z", "--others", "--exclude-standard"],
      maximum,
      "untracked",
      command,
    ),
    "untracked",
  );
  const found = new Map<string, RepositoryIndexEntry[]>();
  rejectRepositoryGitlinks(staged);
  for (const raw of staged) {
    const { path: rawPath, entry } = stagedRecord(raw);
    const path = validateRepositoryContentPath(rawPath, configured);
    const entries = found.get(path) ?? [];
    entries.push(entry);
    found.set(path, entries);
  }
  for (const path of untracked) {
    const safePath = validateRepositoryContentPath(path, configured);
    if (found.has(safePath))
      throw new HarnessError("INTEGRITY", "repository path appears as staged and untracked");
    found.set(safePath, []);
  }
  return [...found].map(([path, index]) => ({
    path,
    index: index.sort((left, right) => left.stage - right.stage),
  }));
}

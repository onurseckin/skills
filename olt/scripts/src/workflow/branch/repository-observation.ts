import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { resolve } from "node:path";
import type { BranchRepositoryEntry, BranchRepositoryObservation } from "../../core/contracts/branch.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { repositoryGit, type RepositoryGitCommand } from "../../packets/repository-git-command.ts";
import { hasRepositoryGitMetadata } from "../../packets/repository-git-metadata.ts";

const MAX_STATUS_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 5_000;

export interface BranchObservationDependencies {
  command?: RepositoryGitCommand;
  hasGitMetadata?: (repo: string) => boolean;
}

const PATH_OFFSET: Readonly<Record<string, number>> = { "1": 8, "2": 9, u: 10 };

function digestFile(path: string): null | string {
  let descriptor: number;
  try {
    if (!lstatSync(path).isFile()) return null;
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    return null;
  }
  try {
    if (!fstatSync(descriptor).isFile()) return null;
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
    return hash.digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

function parseStatusLine(repo: string, line: string): BranchRepositoryEntry | null {
  if (line === "" || line.startsWith("#")) return null;
  const kind = line.slice(0, 1);
  if (kind === "?" || kind === "!") {
    const path = line.slice(2);
    return path === ""
      ? null
      : { path, status_code: kind, sha256: digestFile(resolve(repo, path)) };
  }
  const offset = PATH_OFFSET[kind];
  if (offset === undefined) return null;
  const fields = line.split(" ");
  const statusCode = fields[1] ?? kind;
  const path = fields.slice(offset).join(" ").split("\t")[0] ?? "";
  return path === ""
    ? null
    : { path, status_code: statusCode, sha256: digestFile(resolve(repo, path)) };
}

function text(command: RepositoryGitCommand, repo: string, argv: string[], accepted?: number[]) {
  const result = command(repo, argv, MAX_STATUS_BYTES, accepted);
  return { ok: result.status === 0, stdout: result.bytes.toString("utf8").trim() };
}

export function observeRepository(
  repoRoot: string,
  at: Date,
  dependencies: BranchObservationDependencies = {},
): BranchRepositoryObservation {
  const observedAt = at.toISOString();
  const repo = realpathSync(repoRoot);
  const hasGit = dependencies.hasGitMetadata ?? hasRepositoryGitMetadata;
  if (!hasGit(repo)) {
    return { observed_at: observedAt, git_available: false, head: null, entries: [] };
  }
  const command = dependencies.command ?? repositoryGit;
  const head = text(command, repo, ["rev-parse", "--verify", "-q", "HEAD^{commit}"], [0, 1]);
  const status = text(command, repo, ["status", "--porcelain=v2", "--untracked-files=all"]);
  const lines = status.stdout === "" ? [] : status.stdout.split(/\r?\n/u);
  if (lines.length > MAX_ENTRIES) {
    throw new HarnessError(
      "INVALID_STATE",
      `worktree reports ${lines.length} changed paths, above the ${MAX_ENTRIES} the branch observer will attribute`,
    );
  }
  const entries: BranchRepositoryEntry[] = [];
  for (const line of lines) {
    const entry = parseStatusLine(repo, line);
    if (entry) entries.push(entry);
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return {
    observed_at: observedAt,
    git_available: true,
    head: head.ok && head.stdout !== "" ? head.stdout : null,
    entries,
  };
}

function digests(observation: BranchRepositoryObservation): Map<string, null | string> {
  return new Map(observation.entries.map((entry) => [entry.path, entry.sha256]));
}

export function observedFilesChanged(
  before: BranchRepositoryObservation,
  after: BranchRepositoryObservation,
  dependencies: BranchObservationDependencies = {},
  repoRoot?: string,
): string[] | null {
  if (!before.git_available || !after.git_available) return null;
  const beforeDigests = digests(before);
  const afterDigests = digests(after);
  const changed = new Set<string>();
  for (const path of new Set([...beforeDigests.keys(), ...afterDigests.keys()])) {
    if (beforeDigests.get(path) !== afterDigests.get(path)) changed.add(path);
  }
  if (before.head !== null && after.head !== null && before.head !== after.head && repoRoot) {
    const command = dependencies.command ?? repositoryGit;
    const diff = text(command, realpathSync(repoRoot), [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--name-only",
      `${before.head}..${after.head}`,
    ]);
    for (const path of diff.stdout === "" ? [] : diff.stdout.split(/\r?\n/u)) {
      if (path !== "") changed.add(path);
    }
  }
  return [...changed].sort();
}

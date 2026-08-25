import { lstatSync, opendirSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { JsonObject } from "../core/contracts/json.ts";
import { collectBoundedDirectoryEntries } from "../core/bounded-directory.ts";
import { readBoundedBytes, sha256Bytes } from "../core/json.ts";
import { OLT_DIR_NAME } from "../core/shared/paths.ts";
import { repositoryGit, type RepositoryGitCommand } from "./repository-git-command.ts";
import { hasRepositoryGitMetadata } from "./repository-git-metadata.ts";
import { inspectRepositoryBinding } from "./repository-identity.ts";

// Runtime capsule state (task leases, evidence, vendored per-run mirrors) lives under this
// directory; it must never be walked or its files surfaced as repository instructions/conventions.
const ignored = new Set([
  ".git",
  ".capsules",
  OLT_DIR_NAME,
  "node_modules",
  "dist",
  "build",
  "target",
  "wasm_pkg",
  ".next",
  "Pods",
  ".turbo",
  ".expo",
  "coverage",
  ".output",
  ".vite",
]);
const instructions = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".cursorrules"]);
const conventions = [
  /^package\.json$/u,
  /^bun\.lockb?$/u,
  /^tsconfig(?:\.[^.]+)?\.json$/u,
  /^(?:biome|eslint|prettier)(?:\.config)?\.[^.]+$/u,
  /^(?:Cargo\.toml|go\.mod|pyproject\.toml)$/u,
];

export interface RepositorySnapshotDependencies {
  command?: RepositoryGitCommand;
  maxDirectoryEntries?: number;
}

function run(
  repo: string,
  argv: string[],
  command: RepositoryGitCommand,
  accepted: readonly number[] = [0],
): { ok: boolean; stdout: string } {
  const result = command(repo, argv, 2 * 1024 * 1024, accepted);
  return { ok: result.status === 0, stdout: result.bytes.toString("utf8").trim() };
}

function pathRecord(repo: string, path: string): JsonObject {
  const bytes = readBoundedBytes(path, 1024 * 1024);
  return { path: relative(repo, path).split(sep).join("/"), sha256: sha256Bytes(bytes) };
}

function repositoryFiles(
  repo: string,
  maxEntries: number = 20_000,
): { instructions: JsonObject[]; conventions: JsonObject[] } {
  const foundInstructions: JsonObject[] = [];
  const foundConventions: JsonObject[] = [];
  const pending = [repo];
  let visited = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const opened = opendirSync(directory);
    const entries = collectBoundedDirectoryEntries(
      opened,
      maxEntries - visited,
      () => new Error("repository inspection file limit exceeded"),
      (left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
    );
    for (const entry of entries) {
      visited += 1;
      if (entry.isSymbolicLink() || ignored.has(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!entry.isFile()) continue;
      if (instructions.has(entry.name)) foundInstructions.push(pathRecord(repo, path));
      if (conventions.some((pattern) => pattern.test(entry.name)))
        foundConventions.push(pathRecord(repo, path));
    }
  }
  const byPath = (left: JsonObject, right: JsonObject) =>
    String(left.path).localeCompare(String(right.path));
  return {
    instructions: foundInstructions.sort(byPath),
    conventions: foundConventions.sort(byPath),
  };
}

function lines(value: string): string[] {
  return value === "" ? [] : value.split(/\r?\n/u);
}

export function inspectRepository(
  repoRoot: string,
  phase: "baseline" | "current",
  at: Date,
  dependencies: RepositorySnapshotDependencies = {},
) {
  const repo = realpathSync(repoRoot);
  if (!lstatSync(repo).isDirectory()) throw new Error("repository root is not a directory");
  const command = dependencies.command ?? repositoryGit;
  const available = hasRepositoryGitMetadata(repo);
  const binding = inspectRepositoryBinding(repo);
  const status = available
    ? run(repo, ["status", "--porcelain=v2", "--branch", "--untracked-files=all"], command)
    : null;
  const head = available
    ? run(repo, ["rev-parse", "--verify", "-q", "HEAD^{commit}"], command, [0, 1])
    : null;
  const branch = available ? run(repo, ["branch", "--show-current"], command) : null;
  const history = head?.ok ? run(repo, ["log", "-5", "--oneline", "--decorate=no"], command) : null;
  const gitVersion = available ? run(repo, ["--version"], command) : null;
  const files = repositoryFiles(repo, dependencies.maxDirectoryEntries);
  return {
    schema: "harness.repository-inspection" as const,
    version: 3,
    phase,
    captured_at: at.toISOString(),
    repository_root: repo,
    git: status
      ? {
          available: true,
          head: head?.ok ? head.stdout : null,
          branch: branch?.ok && branch.stdout !== "" ? branch.stdout : null,
          status_porcelain_v2: lines(status.stdout),
          recent_commits: history ? lines(history.stdout) : [],
        }
      : { available: false, error: "Git metadata unavailable" },
    instruction_files: files.instructions,
    convention_files: files.conventions,
    repository_identity_sha256: binding.inspection_sha256,
    repository_git_identity_sha256: binding.git_identity_sha256,
    repository_content_sha256: binding.content_sha256,
    repository_file_count: binding.file_count,
    repository_total_bytes: binding.total_bytes,
    tool_versions: {
      bun: Bun.version,
      git: gitVersion?.stdout ?? "unavailable",
    },
  };
}

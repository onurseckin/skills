import { spawnSync } from "node:child_process";
import { delimiter, isAbsolute } from "node:path";
import { RESTRICTED_GIT_ENVIRONMENT, restrictedRepositoryGitArgv } from "../core/restricted-git.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { preflightRepositoryGitMetadata } from "./repository-git-metadata.ts";

const PASSTHROUGH = ["LANG", "LC_ALL", "LC_CTYPE", "PATH", "TMPDIR", "TZ"] as const;
export const REPOSITORY_GIT_TIMEOUT_MS = 15_000;
export interface RepositoryGitResult {
  status: number | null;
  bytes: Buffer;
}

export type RepositoryGitCommand = (
  repo: string,
  argv: string[],
  maximum: number,
  accepted?: readonly number[],
) => RepositoryGitResult;

interface RepositoryGitSpawnOptions {
  encoding: "buffer";
  env: NodeJS.ProcessEnv;
  shell: false;
  maxBuffer: number;
  timeout: number;
  killSignal: "SIGKILL";
}

interface RepositoryGitSpawnResult {
  status: number | null;
  stdout: Buffer | null;
  stderr: Buffer | null;
  error?: Error;
}

export type RepositoryGitSpawn = (
  executable: string,
  argv: string[],
  options: RepositoryGitSpawnOptions,
) => RepositoryGitSpawnResult;

export interface RepositoryGitCommandDependencies {
  preflight?: (repo: string) => boolean;
}

const nodeSpawn: RepositoryGitSpawn = (executable, argv, options) =>
  spawnSync(executable, argv, options) as RepositoryGitSpawnResult;

function validPath(value: string): boolean {
  const entries = value.split(delimiter);
  return entries.length > 0 && entries.every((entry) => Boolean(entry) && isAbsolute(entry));
}

export function repositoryGitEnvironment(source: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...RESTRICTED_GIT_ENVIRONMENT };
  for (const key of PASSTHROUGH) {
    const value = source[key];
    if (value !== undefined && value !== "") environment[key] = value;
  }
  if (!environment.PATH || !validPath(environment.PATH))
    throw new HarnessError("INTEGRITY", "repository Git PATH must contain absolute directories");
  return environment;
}

export function createRepositoryGitCommand(
  source: Readonly<NodeJS.ProcessEnv> = process.env,
  spawn: RepositoryGitSpawn = nodeSpawn,
  dependencies: RepositoryGitCommandDependencies = {},
): RepositoryGitCommand {
  const environment = repositoryGitEnvironment(source);
  const preflight = dependencies.preflight ?? preflightRepositoryGitMetadata;
  return (repo, argv, maximum, accepted = [0]) => {
    if (!preflight(repo))
      throw new HarnessError("INVALID_STATE", "repository Git metadata unavailable before command");
    const result = spawn("git", restrictedRepositoryGitArgv(repo, argv), {
      encoding: "buffer",
      env: environment,
      shell: false,
      maxBuffer: maximum + 1,
      timeout: REPOSITORY_GIT_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    const bytes = result.stdout ?? Buffer.alloc(0);
    if (bytes.byteLength > maximum)
      throw new HarnessError("INTEGRITY", "repository Git command output byte limit exceeded");
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT")
      throw new HarnessError("INVALID_STATE", "repository Git command timed out");
    if (result.error || !accepted.includes(result.status ?? -1)) {
      const detail = result.stderr?.toString("utf8").trim() || String(result.error ?? "git failed");
      throw new HarnessError("INTEGRITY", `repository Git command failed: ${detail}`);
    }
    return { status: result.status, bytes };
  };
}

export const repositoryGit: RepositoryGitCommand = (...input) =>
  createRepositoryGitCommand()(...input);

export function repositoryWorktree(repo: string, command: RepositoryGitCommand): boolean {
  const probe = command(repo, ["rev-parse", "--is-inside-work-tree"], 1024);
  const value = probe.bytes.toString("utf8").trim();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new HarnessError("INTEGRITY", "repository Git worktree probe returned invalid output");
}

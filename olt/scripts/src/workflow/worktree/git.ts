import { spawnSync } from "node:child_process";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { assertZeroDestructiveGit } from "../../engine/worktree/zero-destructive-policy.ts";

const WORKTREE_GIT_TIMEOUT_MS = 30_000;
const PASSTHROUGH = [
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PATH",
  "TMPDIR",
  "TZ",
  "HOME",
  "SSH_AUTH_SOCK",
  "GPG_TTY",
  "GNUPGHOME",
] as const;

export function worktreeGitEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    PAGER: "cat",
  };
  for (const key of PASSTHROUGH) {
    const value = source[key];
    if (value !== undefined && value !== "") environment[key] = value;
  }
  return environment;
}

export interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type GitRunner = (cwd: string, argv: readonly string[]) => GitResult;

interface GitSpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  encoding: "utf8";
  shell: false;
  timeout: number;
  killSignal: "SIGKILL";
  maxBuffer: number;
  stdio?: ["ignore", "pipe", "pipe"];
}

interface GitSpawnResult {
  status: number | null;
  stdout: string | undefined;
  stderr: string | undefined;
  error?: Error;
}

export type GitSpawn = (
  command: string,
  args: string[],
  options: GitSpawnOptions,
) => GitSpawnResult;

const nodeGitSpawn: GitSpawn = (command, args, options) =>
  spawnSync(command, args, options) as GitSpawnResult;

export function createGitRunner(spawn: GitSpawn = nodeGitSpawn): GitRunner {
  return (cwd, argv) => {
    assertZeroDestructiveGit(argv);
    const result = spawn("git", [...argv], {
      cwd,
      env: worktreeGitEnvironment(process.env),
      encoding: "utf8",
      shell: false,
      timeout: WORKTREE_GIT_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) {
      throw new HarnessError(
        "INTEGRITY",
        `git ${argv[0] ?? ""} failed to start: ${result.error.message}`,
      );
    }
    return {
      status: result.status ?? -1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  };
}

export const runGit: GitRunner = createGitRunner();

export function git(cwd: string, argv: readonly string[], runner: GitRunner = runGit): string {
  const result = runner(cwd, argv);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `exit status ${result.status}`;
    throw new HarnessError("INTEGRITY", `git ${argv.join(" ")} exited ${result.status}: ${detail}`);
  }
  return result.stdout;
}

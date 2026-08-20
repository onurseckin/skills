import { spawnSync } from "node:child_process";
import { HarnessError } from "../../errors/harness-error.ts";

const WORKTREE_GIT_TIMEOUT_MS = 30_000;
// SSH_AUTH_SOCK/GPG_TTY/GNUPGHOME matter here in a way they never did for the read-only observation
// seam (packets/repository-git-command.ts): this seam actually runs `git commit`, and a repo with
// commit signing configured needs its signing agent reachable or every commit fails asking for a
// passphrase no non-interactive process can answer.
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

/**
 * Deliberately leaves hooks ENABLED, unlike the read-only observation seam in
 * `packets/repository-git-command.ts` (which disables them because it never writes anything). A
 * worktree's `git commit` is the one git operation in this codebase meant to run the repository's
 * own pre-commit hook — against that worktree's isolated file state alone, which is the whole point
 * of B22 (B18.1: one agent's half-written file must never fail another's gate). Disabling hooks
 * here would be exactly the `--no-verify` this project refuses to run, for no benefit.
 */
function worktreeGitEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
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

/** Test seam: a fake runner can stand in without spawning a real process. */
export type GitRunner = (cwd: string, argv: readonly string[]) => GitResult;

export const runGit: GitRunner = (cwd, argv) => {
  const result = spawnSync("git", [...argv], {
    cwd,
    env: worktreeGitEnvironment(process.env),
    encoding: "utf8",
    shell: false,
    timeout: WORKTREE_GIT_TIMEOUT_MS,
    killSignal: "SIGKILL",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    throw new HarnessError("INTEGRITY", `git ${argv[0] ?? ""} failed to start: ${result.error.message}`);
  }
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

/** Runs a git command and refuses a non-zero exit; use `runner` directly when non-zero is expected
 *  (existence checks). */
export function git(cwd: string, argv: readonly string[], runner: GitRunner = runGit): string {
  const result = runner(cwd, argv);
  if (result.status !== 0) {
    // No plausible-sounding placeholder when stderr is empty (matches the read-only observation
    // seam's own rule in packets/repository-git-command.ts): report the exit status actually
    // observed rather than inventing a cause git never gave us.
    const detail = result.stderr.trim() || `exit status ${result.status}`;
    throw new HarnessError("INTEGRITY", `git ${argv.join(" ")} exited ${result.status}: ${detail}`);
  }
  return result.stdout;
}

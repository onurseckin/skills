import { describe, expect, test } from "bun:test";
import {
  createGitRunner,
  git,
  runGit,
  worktreeGitEnvironment,
  type GitResult,
  type GitRunner,
  type GitSpawn,
} from "../../../olt/scripts/src/workflow/worktree/git.ts";

function fakeRunner(result: Partial<GitResult>): GitRunner {
  return () => ({ status: 0, stdout: "", stderr: "", ...result });
}

describe("git", () => {
  test("returns stdout when the runner exits zero", () => {
    const runner = fakeRunner({ status: 0, stdout: "deadbeef\n" });
    expect(git("/repo", ["rev-parse", "HEAD"], runner)).toBe("deadbeef\n");
  });

  test("throws INTEGRITY with the joined argv and trimmed stderr when the runner exits non-zero", () => {
    const runner = fakeRunner({ status: 128, stderr: "fatal: not a git repository\n" });
    expect(() => git("/repo", ["status"], runner)).toThrow(
      /git status exited 128: fatal: not a git repository/,
    );
  });

  test("falls back to the exit status when stderr is blank", () => {
    const runner = fakeRunner({ status: 1, stderr: "   \n" });
    expect(() => git("/repo", ["fetch"], runner)).toThrow(/git fetch exited 1: exit status 1/);
  });
});

describe("worktreeGitEnvironment", () => {
  test("carries only the allow-listed passthrough variables that are set and non-empty", () => {
    const environment = worktreeGitEnvironment({
      PATH: "/usr/bin:/bin",
      LANG: "",
      HOME: "/home/user",
      NOT_ALLOWED: "secret",
    });
    expect(environment.PATH).toBe("/usr/bin:/bin");
    expect(environment.HOME).toBe("/home/user");
    expect(environment.LANG).toBeUndefined();
    expect(environment.NOT_ALLOWED).toBeUndefined();
  });

  test("always forces the terminal, pager, and git-pager overrides regardless of source", () => {
    const environment = worktreeGitEnvironment({ GIT_PAGER: "less", PAGER: "less" });
    expect(environment.GIT_TERMINAL_PROMPT).toBe("0");
    expect(environment.GIT_PAGER).toBe("cat");
    expect(environment.PAGER).toBe("cat");
  });
});

describe("createGitRunner", () => {
  function recordingSpawn(): { spawn: GitSpawn; calls: Array<Parameters<GitSpawn>> } {
    const calls: Array<Parameters<GitSpawn>> = [];
    const spawn: GitSpawn = (command, args, options) => {
      calls.push([command, args, options]);
      return { status: 0, stdout: "ok\n", stderr: "" };
    };
    return { spawn, calls };
  }

  test("invokes the injected spawn with git, the argv, and the fixed process options", () => {
    const { spawn, calls } = recordingSpawn();
    const runner = createGitRunner(spawn);
    const result = runner("/repo", ["status", "--short"]);
    expect(result).toEqual({ status: 0, stdout: "ok\n", stderr: "" });
    expect(calls).toHaveLength(1);
    const [command, args, options] = calls[0]!;
    expect(command).toBe("git");
    expect(args).toEqual(["status", "--short"]);
    expect(options.cwd).toBe("/repo");
    expect(options.encoding).toBe("utf8");
    expect(options.shell).toBe(false);
    expect(options.killSignal).toBe("SIGKILL");
    expect(options.timeout).toBe(30_000);
    expect(options.maxBuffer).toBe(16 * 1024 * 1024);
  });

  test("normalizes a killed process's null status and missing streams", () => {
    const runner = createGitRunner(() => ({ status: null, stdout: undefined, stderr: undefined }));
    expect(runner("/repo", ["fetch"])).toEqual({ status: -1, stdout: "", stderr: "" });
  });

  test("throws INTEGRITY naming the failed subcommand when the spawn itself errors", () => {
    const runner = createGitRunner(() => ({
      status: null,
      stdout: undefined,
      stderr: undefined,
      error: new Error("spawn git ENOENT"),
    }));
    expect(() => runner("/repo", ["clone", "x"])).toThrow(
      /git clone failed to start: spawn git ENOENT/,
    );
  });

  test("falls back to an empty subcommand label when argv is empty and the spawn errors", () => {
    const runner = createGitRunner(() => ({
      status: null,
      stdout: undefined,
      stderr: undefined,
      error: new Error("spawn git ENOENT"),
    }));
    expect(() => runner("/repo", [])).toThrow(/git  failed to start: spawn git ENOENT/);
  });

  test("runGit default runner executes real git commands", () => {
    const result = runGit(process.cwd(), ["status", "--short"]);
    expect(result.status).toBe(0);
    expect(git(process.cwd(), ["status", "--short"])).toBeString();
  });
});

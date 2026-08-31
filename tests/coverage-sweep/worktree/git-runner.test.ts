import { describe, expect, test } from "bun:test";
import {
  createGitRunner,
  git,
  worktreeGitEnvironment,
  type GitSpawn,
} from "../../../olt/scripts/src/workflow/worktree/git.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("coverage sweep gap tests: git runner edge cases", () => {
  test("worktreeGitEnvironment filters undefined and empty string keys and preserves passthrough", () => {
    const sourceEnv = {
      LANG: "en_US.UTF-8",
      PATH: "/usr/bin",
      TMPDIR: "",
      EXTRA_IGNORED: "secret",
    };
    const env = worktreeGitEnvironment(sourceEnv);
    expect(env.LANG).toBe("en_US.UTF-8");
    expect(env.PATH).toBe("/usr/bin");
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_PAGER).toBe("cat");
    expect(env.TMPDIR).toBeUndefined();
    expect(env.EXTRA_IGNORED).toBeUndefined();
  });

  test("createGitRunner throws INTEGRITY error when spawn result includes error", () => {
    const errorSpawn: GitSpawn = () => ({
      status: null,
      stdout: undefined,
      stderr: undefined,
      error: new Error("ENOENT spawn failed"),
    });

    const runner = createGitRunner(errorSpawn);
    expect(() => runner("/tmp", ["status"])).toThrow(HarnessError);
    expect(() => runner("/tmp", ["status"])).toThrow(/failed to start: ENOENT spawn failed/);
  });

  test("createGitRunner returns fallback values when status or outputs are undefined", () => {
    const nullSpawn: GitSpawn = () => ({
      status: null,
      stdout: undefined,
      stderr: undefined,
    });

    const runner = createGitRunner(nullSpawn);
    const result = runner("/tmp", ["status"]);
    expect(result.status).toBe(-1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("git helper throws INTEGRITY with stderr detail when command fails", () => {
    const failingRunner = () => ({
      status: 128,
      stdout: "",
      stderr: "fatal: not a git repository",
    });

    expect(() => git("/tmp", ["rev-parse", "HEAD"], failingRunner)).toThrow(HarnessError);
    expect(() => git("/tmp", ["rev-parse", "HEAD"], failingRunner)).toThrow(
      /fatal: not a git repository/,
    );
  });

  test("git helper throws with exit status when stderr is empty", () => {
    const failingRunnerEmptyStderr = () => ({
      status: 1,
      stdout: "",
      stderr: "   ",
    });

    expect(() => git("/tmp", ["status"], failingRunnerEmptyStderr)).toThrow(/exit status 1/);
  });

  test("git runner returns stdout on exit code 0", () => {
    const successRunner = () => ({
      status: 0,
      stdout: "commit-hash-abc123\n",
      stderr: "",
    });
    expect(git("/tmp", ["rev-parse", "HEAD"], successRunner)).toBe("commit-hash-abc123\n");
  });
});

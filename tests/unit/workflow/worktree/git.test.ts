import { describe, expect, test } from "bun:test";
import {
  git,
  type GitResult,
  type GitRunner,
} from "../../../../orchestrating-long-tasks/scripts/src/workflow/worktree/git.ts";

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

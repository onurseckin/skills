import { describe, expect, test } from "bun:test";
import { createGitRunner, type GitSpawn } from "../../../olt/scripts/src/workflow/worktree/git.ts";

describe("git runner zero-destructive invariant integration", () => {
  function fakeSpawn(): GitSpawn {
    return (_command, _args, _options) => ({
      status: 0,
      stdout: "ok\n",
      stderr: "",
    });
  }

  test("blocks git checkout -- from execution", () => {
    const runner = createGitRunner(fakeSpawn());
    expect(() => runner("/repo", ["checkout", "--", "modified.ts"])).toThrow(
      /Destructive git operation forbidden by Zero-Destructive Git Invariant/,
    );
  });

  test("blocks git reset --hard from execution", () => {
    const runner = createGitRunner(fakeSpawn());
    expect(() => runner("/repo", ["reset", "--hard"])).toThrow(
      /Destructive git operation forbidden by Zero-Destructive Git Invariant/,
    );
  });

  test("blocks git clean -fd from execution", () => {
    const runner = createGitRunner(fakeSpawn());
    expect(() => runner("/repo", ["clean", "-fd"])).toThrow(
      /Destructive git operation forbidden by Zero-Destructive Git Invariant/,
    );
  });

  test("blocks git restore . from execution", () => {
    const runner = createGitRunner(fakeSpawn());
    expect(() => runner("/repo", ["restore", "."])).toThrow(
      /Destructive git operation forbidden by Zero-Destructive Git Invariant/,
    );
  });

  test("allows legitimate non-destructive git commands", () => {
    const runner = createGitRunner(fakeSpawn());
    const result = runner("/repo", ["status", "--porcelain"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("ok\n");
  });
});

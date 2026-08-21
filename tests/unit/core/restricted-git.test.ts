import { describe, expect, test } from "bun:test";
import {
  isGitArgv,
  isRestrictedGitDiffArgv,
  RESTRICTED_GIT_ARGUMENTS,
  restrictedGitDiffArgv,
  restrictedRepositoryGitArgv,
} from "../../../orchestrating-long-tasks/scripts/src/core/restricted-git.ts";

describe("isGitArgv", () => {
  test("recognizes a bare 'git' invocation, case-insensitively and with a .exe suffix", () => {
    expect(isGitArgv(["git", "status"])).toBeTrue();
    expect(isGitArgv(["GIT", "status"])).toBeTrue();
    expect(isGitArgv(["git.exe", "status"])).toBeTrue();
    expect(isGitArgv(["/usr/bin/git", "status"])).toBeTrue();
  });

  test("rejects a non-git binary and an empty argv", () => {
    expect(isGitArgv(["bun", "test"])).toBeFalse();
    expect(isGitArgv([])).toBeFalse();
  });
});

describe("restrictedRepositoryGitArgv", () => {
  test("prepends the restricted argument set and pins the repo with -C", () => {
    expect(restrictedRepositoryGitArgv("/repo", ["status"])).toEqual([
      ...RESTRICTED_GIT_ARGUMENTS,
      "-C",
      "/repo",
      "status",
    ]);
  });
});

describe("isRestrictedGitDiffArgv", () => {
  test("accepts exactly 'git diff --check' and 'git diff --cached --check'", () => {
    expect(isRestrictedGitDiffArgv(["git", "diff", "--check"])).toBeTrue();
    expect(isRestrictedGitDiffArgv(["git", "diff", "--cached", "--check"])).toBeTrue();
  });

  test("rejects anything else: a non-git binary, a different subcommand, or extra/missing args", () => {
    expect(isRestrictedGitDiffArgv(["bun", "diff", "--check"])).toBeFalse();
    expect(isRestrictedGitDiffArgv(["git", "status"])).toBeFalse();
    expect(isRestrictedGitDiffArgv(["git", "diff"])).toBeFalse();
    expect(isRestrictedGitDiffArgv(["git", "diff", "--check", "extra"])).toBeFalse();
    expect(isRestrictedGitDiffArgv(["git", "diff", "--cached"])).toBeFalse();
    expect(isRestrictedGitDiffArgv(["git", "diff", "--stat", "--check"])).toBeFalse();
  });
});

describe("restrictedGitDiffArgv", () => {
  test("passes a non-git argv straight through, untouched", () => {
    expect(restrictedGitDiffArgv(["bun", "test"])).toEqual(["bun", "test"]);
  });

  test("rewrites an accepted diff check with the restricted arguments and no-ext-diff/no-textconv", () => {
    expect(restrictedGitDiffArgv(["git", "diff", "--check"])).toEqual([
      "git",
      ...RESTRICTED_GIT_ARGUMENTS,
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--check",
    ]);
    expect(restrictedGitDiffArgv(["git", "diff", "--cached", "--check"])).toEqual([
      "git",
      ...RESTRICTED_GIT_ARGUMENTS,
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--cached",
      "--check",
    ]);
  });

  test("refuses a git argv that is not one of the accepted diff checks", () => {
    expect(() => restrictedGitDiffArgv(["git", "push"])).toThrow(
      /Git gate execution argv is not an accepted diff check/,
    );
    expect(() => restrictedGitDiffArgv(["git", "diff", "--stat"])).toThrow(
      /Git gate execution argv is not an accepted diff check/,
    );
  });
});

import { describe, expect, test } from "bun:test";
import { rejectLocalGitHelpers } from "../../../olt/scripts/src/packets/repository-git-helper-policy.ts";
import type { RepositoryGitCommand } from "../../../olt/scripts/src/packets/repository-git-command.ts";

function createMockGit(status: number, output: Buffer): RepositoryGitCommand {
  return () => ({
    status,
    bytes: output,
  });
}

describe("repository-git-helper-policy", () => {
  test("allows when git config returns status 1 (no helpers found)", () => {
    const git = createMockGit(1, Buffer.alloc(0));
    expect(() => rejectLocalGitHelpers("/repo", "/repo/.git/config", 1024, git)).not.toThrow();
  });

  test("allows core.fsmonitor when explicitly disabled", () => {
    const output = Buffer.from("core.fsmonitor\nfalse\0core.fsmonitor\n0\0core.fsmonitor\noff\0");
    const git = createMockGit(0, output);
    expect(() => rejectLocalGitHelpers("/repo", "/repo/.git/config", 1024, git)).not.toThrow();
  });

  test("rejects unsupported git helpers such as diff.external and filter hooks", () => {
    const external = Buffer.from("diff.external\n/usr/bin/my-diff\0");
    const git1 = createMockGit(0, external);
    expect(() => rejectLocalGitHelpers("/repo", "/repo/.git/config", 1024, git1)).toThrow(
      "repository local Git helper configuration is unsupported: diff.external",
    );

    const filter = Buffer.from("filter.lfs.clean\ngit-lfs clean\0");
    const git2 = createMockGit(0, filter);
    expect(() => rejectLocalGitHelpers("/repo", "/repo/.git/config", 1024, git2)).toThrow(
      "repository local Git helper configuration is unsupported: filter.lfs.clean",
    );

    const enabledFsMonitor = Buffer.from("core.fsmonitor\ntrue\0");
    const git3 = createMockGit(0, enabledFsMonitor);
    expect(() => rejectLocalGitHelpers("/repo", "/repo/.git/config", 1024, git3)).toThrow(
      "repository local Git helper configuration is unsupported: core.fsmonitor",
    );
  });

  test("rejects malformed records output", () => {
    // Empty output with status 0
    const git1 = createMockGit(0, Buffer.alloc(0));
    expect(() => rejectLocalGitHelpers("/repo", "/repo/.git/config", 1024, git1)).toThrow(
      "repository local Git helper config output is invalid",
    );

    // Missing trailing NUL
    const git2 = createMockGit(0, Buffer.from("diff.external\nmy-diff"));
    expect(() => rejectLocalGitHelpers("/repo", "/repo/.git/config", 1024, git2)).toThrow(
      "repository local Git helper config output is invalid",
    );

    // Invalid UTF-8
    const git3 = createMockGit(0, Buffer.from([0xff, 0xff, 0]));
    expect(() => rejectLocalGitHelpers("/repo", "/repo/.git/config", 1024, git3)).toThrow(
      "repository local Git helper config is not UTF-8",
    );

    // Missing newline separator between key and value
    const git4 = createMockGit(0, Buffer.from("diff.external\0"));
    expect(() => rejectLocalGitHelpers("/repo", "/repo/.git/config", 1024, git4)).toThrow(
      "repository local Git helper config output is invalid",
    );
  });
});

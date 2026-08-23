import { describe, expect, test } from "bun:test";
import {
  commandOutputRetryingEmpty,
  repositoryWorktree,
  type RepositoryGitCommand,
} from "../../../olt/scripts/src/packets/repository-git-command.ts";

describe("commandOutputRetryingEmpty", () => {
  test("retries a successful-but-empty result and returns the first non-empty output", () => {
    let calls = 0;
    const command: RepositoryGitCommand = () => {
      calls += 1;
      return { status: 0, bytes: Buffer.from(calls < 3 ? "" : "settled output") };
    };
    const result = commandOutputRetryingEmpty("/repo", ["status"], 1024, command);
    expect(calls).toBe(3);
    expect(result.bytes.toString("utf8")).toBe("settled output");
  });

  test("gives up after exhausting its retry budget and returns the last empty result", () => {
    let calls = 0;
    const command: RepositoryGitCommand = () => {
      calls += 1;
      return { status: 0, bytes: Buffer.from("") };
    };
    const result = commandOutputRetryingEmpty("/repo", ["status"], 1024, command);
    // One initial call plus GIT_SPAWN_TRANSIENT_RETRIES(3) retries.
    expect(calls).toBe(4);
    expect(result.bytes.toString("utf8")).toBe("");
  });
});

describe("repositoryWorktree", () => {
  test("reports false when git says the path is not inside a worktree", () => {
    const command: RepositoryGitCommand = () => ({ status: 0, bytes: Buffer.from("false\n") });
    expect(repositoryWorktree("/repo", command)).toBe(false);
  });

  test("rejects an is-inside-work-tree probe that returns neither true nor false", () => {
    const command: RepositoryGitCommand = () => ({ status: 0, bytes: Buffer.from("maybe\n") });
    expect(() => repositoryWorktree("/repo", command)).toThrow(
      "repository Git worktree probe returned invalid output",
    );
  });
});

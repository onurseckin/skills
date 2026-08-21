import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import type { RepositoryGitCommand } from "../../../orchestrating-long-tasks/scripts/src/packets/repository-git-command.ts";
import {
  anchoredChangedPaths,
  diffAnchor,
} from "../../../orchestrating-long-tasks/scripts/src/packets/round-repository-delta.ts";
import { inspection } from "./inspection-fixture.ts";

const anchor = diffAnchor(inspection("baseline"));
const measuredAt = new Date("2026-08-13T12:31:00.000Z");

const gitReturning =
  (text: string): RepositoryGitCommand =>
  (_repo, argv) => {
    expect(argv).toContain("--name-only");
    expect(argv).toContain(anchor.head_commit);
    return { status: 0, bytes: Buffer.from(text, "utf8") };
  };

const gitThrowing =
  (message: string): RepositoryGitCommand =>
  () => {
    throw new HarnessError("INTEGRITY", message);
  };

describe("anchoredChangedPaths", () => {
  test("parses newline-delimited names, dropping blank lines", () => {
    const result = anchoredChangedPaths(
      "/repo",
      anchor,
      measuredAt,
      gitReturning("src/owned/a.ts\n\nsrc/other/b.ts\n"),
    );
    expect(result.paths).toEqual(["src/owned/a.ts", "src/other/b.ts"]);
    expect(result.truncated).toBeFalse();
    expect(result.measured_at).toBe(measuredAt.toISOString());
  });

  test("an anchor with no recorded commit is reported unavailable without running git", () => {
    const noCommit = { ...anchor, head_commit: null };
    const result = anchoredChangedPaths("/repo", noCommit, measuredAt, () => {
      throw new Error("must not be called");
    });
    expect(result.unavailable).toBe("the anchor inspection recorded no commit");
    expect(result.paths).toBeUndefined();
  });

  test("a git failure is surfaced as unavailable rather than thrown", () => {
    const result = anchoredChangedPaths(
      "/repo",
      anchor,
      measuredAt,
      gitThrowing("repository Git command failed: fatal: bad object"),
    );
    expect(result.unavailable).toBe("repository Git command failed: fatal: bad object");
    expect(result.paths).toBeUndefined();
  });

  test("a non-HarnessError failure still propagates", () => {
    expect(() =>
      anchoredChangedPaths("/repo", anchor, measuredAt, () => {
        throw new TypeError("boom");
      }),
    ).toThrow(TypeError);
  });
});

import { describe, expect, test } from "bun:test";
import {
  decodeNulRecords,
  gitRepositoryPaths,
  rejectRepositoryGitlinks,
} from "../../../../olt/scripts/src/packets/repository-git-paths.ts";
import type { RepositoryGitCommand } from "../../../../olt/scripts/src/packets/repository-git-command.ts";

function listingCommand(staged: Buffer, untracked: Buffer): RepositoryGitCommand {
  return (_repo, argv) => ({
    status: 0,
    bytes: argv.includes("--cached") ? staged : untracked,
  });
}

describe("decodeNulRecords", () => {
  test("rejects a listing whose bytes are not valid UTF-8", () => {
    const invalidUtf8 = Buffer.concat([Buffer.from([0xff, 0xfe, 0xfd]), Buffer.from([0])]);
    expect(() => decodeNulRecords(invalidUtf8, "staged")).toThrow(
      "repository staged path is not UTF-8",
    );
  });
});

describe("rejectRepositoryGitlinks", () => {
  test("rejects a staged entry whose mode marks it as a gitlink/submodule", () => {
    const oid = "a".repeat(40);
    expect(() => rejectRepositoryGitlinks([`160000 ${oid} 0\tvendor/submodule`])).toThrow(
      "repository gitlink/submodule nodes are unsupported: vendor/submodule",
    );
  });
});

describe("gitRepositoryPaths", () => {
  test("carries an untracked file through as its own path entry with no index", () => {
    const oid = "a".repeat(40);
    const command = listingCommand(
      Buffer.from(`100644 ${oid} 0\tsrc/tracked.ts\0`),
      Buffer.from("src/untracked.ts\0"),
    );
    const paths = gitRepositoryPaths("/repo", 4096, {}, command);
    const untracked = paths.find((entry) => entry.path === "src/untracked.ts");
    expect(untracked).toEqual({ path: "src/untracked.ts", index: [] });
  });

  test("sorts a merge-conflicted path's index entries by stage", () => {
    const oid = "a".repeat(40);
    const staged = Buffer.from(
      [
        `100644 ${oid} 3\tsrc/conflict.ts`,
        `100644 ${oid} 1\tsrc/conflict.ts`,
        `100644 ${oid} 2\tsrc/conflict.ts`,
      ]
        .map((line) => `${line}\0`)
        .join(""),
    );
    const command = listingCommand(staged, Buffer.alloc(0));
    const [entry] = gitRepositoryPaths("/repo", 4096, {}, command);
    expect(entry!.path).toBe("src/conflict.ts");
    expect(entry!.index.map((item) => item.stage)).toEqual([1, 2, 3]);
  });

  test("rejects a path that is reported as both staged and untracked", () => {
    const oid = "a".repeat(40);
    const command = listingCommand(
      Buffer.from(`100644 ${oid} 0\tsrc/a.ts\0`),
      Buffer.from("src/a.ts\0"),
    );
    expect(() => gitRepositoryPaths("/repo", 4096, {}, command)).toThrow(
      "repository path appears as staged and untracked",
    );
  });
});

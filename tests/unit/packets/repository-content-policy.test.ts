import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRepositoryContent } from "../../../olt/scripts/src/packets/repository-content.ts";
import { repositoryContentPaths } from "../../../olt/scripts/src/packets/repository-content-paths.ts";
import {
  DEFAULT_REPOSITORY_CONTENT_POLICY,
  decodeRepositoryContentPath,
  resolveRepositoryContentPolicy,
  validateRepositoryContentPath,
} from "../../../olt/scripts/src/packets/repository-content-policy.ts";
import { gitRepositoryPaths } from "../../../olt/scripts/src/packets/repository-git-paths.ts";
import type { RepositoryGitCommand } from "../../../olt/scripts/src/packets/repository-git-command.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function listingCommand(staged: Buffer, untracked: Buffer): RepositoryGitCommand {
  return (_repo, argv) => ({
    status: 0,
    bytes: argv.includes("--stage") ? staged : untracked,
  });
}

describe("versioned repository content path policy", () => {
  test("publishes shared default caps with an explicit policy version", () => {
    expect(DEFAULT_REPOSITORY_CONTENT_POLICY).toEqual({
      schema: "harness.repository-content-scan-policy",
      version: 1,
      maxFiles: 50_000,
      maxFileBytes: 64 * 1024 * 1024,
      maxTotalBytes: 256 * 1024 * 1024,
      maxListingBytes: 8 * 1024 * 1024,
      maxPathBytes: 4096,
      maxPathDepth: 128,
    });
  });

  test("accepts exact UTF-8 byte and depth boundaries and rejects one beyond", () => {
    const policy = resolveRepositoryContentPolicy({});
    expect(validateRepositoryContentPath("é".repeat(policy.maxPathBytes / 2), policy)).toHaveLength(
      policy.maxPathBytes / 2,
    );
    expect(() =>
      validateRepositoryContentPath(`${"é".repeat(policy.maxPathBytes / 2)}a`, policy),
    ).toThrow("path byte limit");

    const atDepth = Array.from({ length: policy.maxPathDepth }, () => "a").join("/");
    expect(validateRepositoryContentPath(atDepth, policy)).toBe(atDepth);
    expect(() => validateRepositoryContentPath(`${atDepth}/a`, policy)).toThrow("path depth limit");
  });

  test("fails closed for invalid path cap overrides", () => {
    expect(() => resolveRepositoryContentPolicy({ maxPathBytes: 0 })).toThrow(
      "maxPathBytes must be a positive integer",
    );
    expect(() => resolveRepositoryContentPolicy({ maxPathDepth: 0 })).toThrow(
      "maxPathDepth must be a positive integer",
    );
    const invalid = { ...DEFAULT_REPOSITORY_CONTENT_POLICY, maxPathBytes: 0 };
    expect(() =>
      gitRepositoryPaths(
        "/repo",
        4096,
        invalid,
        listingCommand(Buffer.alloc(0), Buffer.from("safe\0")),
      ),
    ).toThrow("maxPathBytes must be a positive integer");
  });

  test("rejects hostile staged and untracked paths at their listing ingress", () => {
    const policy = resolveRepositoryContentPolicy({ maxPathBytes: 8 });
    const oid = "a".repeat(40);
    expect(() =>
      gitRepositoryPaths(
        "/repo",
        4096,
        policy,
        listingCommand(Buffer.from(`100644 ${oid} 0\t123456789\0`), Buffer.alloc(0)),
      ),
    ).toThrow("path byte limit");
    expect(() =>
      gitRepositoryPaths(
        "/repo",
        4096,
        policy,
        listingCommand(Buffer.alloc(0), Buffer.from("123456789\0")),
      ),
    ).toThrow("path byte limit");
  });

  test("checks a directory path before descending into it", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "directory-path-policy-")));
    roots.push(repo);
    mkdirSync(join(repo, "first", "second"), { recursive: true });
    const policy = resolveRepositoryContentPolicy({ maxPathDepth: 1 });
    expect(() => repositoryContentPaths(repo, 4096, policy)).toThrow("path depth limit");
  });

  test("rejects a non-UTF-8 directory entry before traversal", () => {
    expect(() => decodeRepositoryContentPath(Buffer.from([0xff]))).toThrow("path is not UTF-8");
  });

  test("validates injected path sources before filesystem node traversal", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "injected-path-policy-")));
    roots.push(repo);
    expect(() => inspectRepositoryContent(repo, { maxPathBytes: 4 }, () => ["12345"])).toThrow(
      "path byte limit",
    );
  });
});

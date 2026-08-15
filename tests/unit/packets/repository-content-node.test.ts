import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRepositoryNode } from "../../../orchestrating-long-tasks/scripts/src/packets/repository-content-node.ts";

describe("repository-content-node", () => {
  test("inspects a missing repository entry (ENOENT)", () => {
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "repo-node-")));
    const node = inspectRepositoryNode(
      repoRoot,
      { path: "nonexistent.txt", index: [] },
      1024 * 1024,
    );
    expect(node.node_type).toBe("missing");
    expect(node.bytes).toBe(0);
    expect(node.sha256).toBeNull();
  });

  test("inspects a symlink node and enforces byte limit and stability", () => {
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "repo-node-")));
    writeFileSync(join(repoRoot, "target.txt"), "hello world");
    symlinkSync("target.txt", join(repoRoot, "link.txt"));

    const node = inspectRepositoryNode(repoRoot, { path: "link.txt", index: [] }, 1024);
    expect(node.node_type).toBe("symlink");
    expect(node.bytes).toBe(10);
    expect(node.sha256).toBeDefined();

    expect(() => inspectRepositoryNode(repoRoot, { path: "link.txt", index: [] }, 5)).toThrow(
      "repository file byte limit exceeded",
    );
  });

  test("rejects gitlink / submodule nodes and unsupported node types (directory as leaf)", () => {
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "repo-node-")));
    expect(() =>
      inspectRepositoryNode(
        repoRoot,
        { path: "sub", index: [{ mode: "160000", sha256: "0".repeat(40), stage: 0 }] },
        1024,
      ),
    ).toThrow("repository gitlink/submodule nodes are unsupported");

    mkdirSync(join(repoRoot, "some-dir"));
    expect(() => inspectRepositoryNode(repoRoot, { path: "some-dir", index: [] }, 1024)).toThrow(
      "unsupported repository content node type",
    );
  });

  test("inspects regular file and enforces byte bounds and stability", () => {
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "repo-node-")));
    const filePath = join(repoRoot, "large.txt");
    writeFileSync(filePath, "1234567890");

    expect(() => inspectRepositoryNode(repoRoot, { path: "large.txt", index: [] }, 5)).toThrow(
      "repository file byte limit exceeded",
    );

    const node = inspectRepositoryNode(repoRoot, { path: "large.txt", index: [] }, 1024);
    expect(node.node_type).toBe("file");
    expect(node.bytes).toBe(10);
  });

  test("rejects unstable file scan when modified during descriptor open", () => {
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "repo-node-")));
    const filePath = join(repoRoot, "unstable.txt");
    writeFileSync(filePath, "original");

    expect(() =>
      inspectRepositoryNode(repoRoot, { path: "unstable.txt", index: [] }, 1024, {
        beforeLeafOpen: () => {
          writeFileSync(filePath, "mutated before open");
        },
      }),
    ).toThrow("repository content scan was unstable");
  });
});

import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryContentPaths } from "../../olt/scripts/src/packets/repository-content-paths.ts";

/**
 * repositoryContentPaths' non-git walk guards against unbounded directory listings with a
 * 50,000-entry ceiling that's impractical to trip by actually creating 50,000+ files in a fast
 * unit test. The optional maxEntries parameter (default unchanged) is the injection seam added
 * to reach that guard cheaply — see repository-content-paths.ts.
 */
describe("repositoryContentPaths directory traversal limit", () => {
  test("rejects a directory listing that exceeds an injected entry ceiling", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "repo-content-paths-limit-")));
    writeFileSync(join(repo, "a.txt"), "a");
    writeFileSync(join(repo, "b.txt"), "b");
    writeFileSync(join(repo, "c.txt"), "c");

    expect(() => repositoryContentPaths(repo, 1024 * 1024, {}, 2)).toThrow(
      "repository content traversal limit exceeded",
    );
  });

  test("accepts the same directory once the ceiling comfortably covers its entries", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "repo-content-paths-limit-ok-")));
    writeFileSync(join(repo, "a.txt"), "a");
    writeFileSync(join(repo, "b.txt"), "b");

    const paths = repositoryContentPaths(repo, 1024 * 1024, {}, 50_000);
    expect(paths.map((entry) => entry.path).sort()).toEqual(["a.txt", "b.txt"]);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { treeDigest } from "../../orchestrating-long-tasks/scripts/src/installer/tree-digest.ts";
import { cleanInstallerFixtures, installerFixture } from "../unit/installer/helpers.ts";

afterEach(cleanInstallerFixtures);

interface DigestOptions {
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxEntries?: number;
  beforeFileRecheck?(path: string): Promise<void> | void;
}
const boundedDigest = treeDigest as unknown as (
  root: string,
  ignore: ReadonlySet<string>,
  options: DigestOptions,
) => Promise<string>;

describe("bounded descriptor tree digest", () => {
  test("enforces per-file total-byte and entry-count limits", async () => {
    const { root } = await installerFixture();
    const tree = join(root, "bounded-tree");
    await mkdir(tree);
    await writeFile(join(tree, "one.txt"), "12345");
    await writeFile(join(tree, "two.txt"), "67890");

    await expect(boundedDigest(tree, new Set(), { maxFileBytes: 4 })).rejects.toThrow(
      /file|limit/i,
    );
    await expect(boundedDigest(tree, new Set(), { maxTotalBytes: 9 })).rejects.toThrow(
      /total|limit/i,
    );
    await expect(boundedDigest(tree, new Set(), { maxEntries: 2 })).rejects.toThrow(/entry|limit/i);
  });

  test("rejects a file replaced while its descriptor is being hashed", async () => {
    const { root } = await installerFixture();
    const tree = join(root, "raced-tree");
    const file = join(tree, "value.txt");
    await mkdir(tree);
    await writeFile(file, "before");
    let raced = false;

    await expect(
      boundedDigest(tree, new Set(), {
        beforeFileRecheck(path) {
          if (!raced && path === file) {
            raced = true;
            writeFileSync(file, "after-after");
          }
        },
      }),
    ).rejects.toThrow(/changed|identity/i);
  });
});

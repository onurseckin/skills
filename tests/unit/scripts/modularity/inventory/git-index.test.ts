import { afterEach, expect, test } from "bun:test";
import { readIndexedBlobs } from "../../../../../scripts/modularity/inventory/index.ts";
import {
  createIndexedFixture,
  gitInFixture,
  removeIndexedFixture,
  stageFiles,
} from "./index-fixture.ts";

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(removeIndexedFixture));
});

test("reads staged bytes instead of a divergent working tree", async () => {
  const repo = await createIndexedFixture({
    staged: "a\n".repeat(300),
    working: "b\n".repeat(301),
  });
  fixtures.push(repo);

  const [blob] = await readIndexedBlobs(repo);

  expect(new TextDecoder().decode(blob?.bytes)).toBe("a\n".repeat(300));
});

test("returns index paths in lexical order and preserves NUL-safe names", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  await stageFiles(repo, { "slice/a name.ts": "a", "slice/z.ts": "z" });

  expect((await readIndexedBlobs(repo)).map((blob) => blob.path)).toEqual([
    "slice/a name.ts",
    "slice/index.ts",
    "slice/z.ts",
  ]);
});

test("uses final index paths after staged deletion and rename", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  await stageFiles(repo, { "slice/old.ts": "old", "slice/remove.ts": "remove" });
  await gitInFixture(repo, ["mv", "slice/old.ts", "slice/renamed.ts"]);
  await gitInFixture(repo, ["rm", "--cached", "slice/remove.ts"]);

  expect((await readIndexedBlobs(repo)).map((blob) => blob.path)).toEqual([
    "slice/index.ts",
    "slice/renamed.ts",
  ]);
});

test("fails closed when cat-file returns a malformed missing-object header", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  await gitInFixture(repo, [
    "update-index",
    "--add",
    "--cacheinfo",
    `100644,${"f".repeat(40)},slice/missing.ts`,
  ]);

  await expect(readIndexedBlobs(repo)).rejects.toThrow("malformed cat-file header");
});

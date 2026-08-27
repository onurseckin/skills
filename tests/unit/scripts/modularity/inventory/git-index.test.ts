import { afterEach, expect, test } from "bun:test";
import { readIndexedBlobs } from "../../../../../scripts/modularity/inventory/index.ts";
import {
  createIndexedFixture,
  gitInFixture,
  removeIndexedFixture,
  stageFiles,
} from "./index-fixture.ts";
import { runInventoryWithFakeGit } from "./fake-git-fixture.ts";

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

test("rejects invalid Git index file modes", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  const oid = "a".repeat(40);
  const result = await runInventoryWithFakeGit(repo, {
    lsFilesOutput: `100600 ${oid} 0\\tfixture.ts\\000`,
    catFileOutput: `${oid} blob 1\\nx\\n`,
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("malformed ls-files record");
});

test("rejects valid-looking cat-file headers with the wrong object type", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  const oid = "b".repeat(40);
  const result = await runInventoryWithFakeGit(repo, {
    lsFilesOutput: `100644 ${oid} 0\\tfixture.ts\\000`,
    catFileOutput: `${oid} tree 0\\n\\n`,
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("malformed cat-file header");
});

test("rejects cat-file bodies shorter than their announced size", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  const oid = "c".repeat(40);
  const result = await runInventoryWithFakeGit(repo, {
    lsFilesOutput: `100644 ${oid} 0\\tfixture.ts\\000`,
    catFileOutput: `${oid} blob 2\\nx\\n`,
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("truncated cat-file blob");
});

test("rejects duplicate index paths", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  const first = "d".repeat(40);
  const second = "e".repeat(40);
  const result = await runInventoryWithFakeGit(repo, {
    lsFilesOutput: `100644 ${first} 0\\tfixture.ts\\000100644 ${second} 0\\tfixture.ts\\000`,
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("duplicate index path");
});

test("rejects nonzero ls-files exits", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  const result = await runInventoryWithFakeGit(repo, {
    lsFilesOutput: "failure",
    lsFilesStatus: 17,
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("git ls-files failed");
});

test("rejects nonzero cat-file exits", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  const oid = "f".repeat(40);
  const result = await runInventoryWithFakeGit(repo, {
    lsFilesOutput: `100644 ${oid} 0\\tfixture.ts\\000`,
    catFileStatus: 23,
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("git cat-file failed");
});

test("orders index paths by code unit", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  const upper = "1".repeat(40);
  const lower = "2".repeat(40);
  const blobs = await readIndexedBlobs(repo);
  expect(blobs).toHaveLength(1);
  const result = await runInventoryWithFakeGit(repo, {
    lsFilesOutput: `100644 ${lower} 0\\tslice/a.ts\\000100644 ${upper} 0\\tslice/Z.ts\\000`,
    catFileOutput: `${upper} blob 1\\nZ\\n${lower} blob 1\\na\\n`,
  });

  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual(["slice/Z.ts", "slice/a.ts"]);
});

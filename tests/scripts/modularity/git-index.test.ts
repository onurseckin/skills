import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readIndexedBlobs,
  readTreeBlobs,
  type GitCommandPrefix,
} from "../../../scripts/modularity/inventory/index.ts";

interface FakeGitBehavior {
  readonly lsFilesOutput: string;
  readonly lsFilesStatus?: number;
  readonly catFileOutput?: string;
  readonly catFileStatus?: number;
}

const FAKE_GIT = `import { readFile } from "node:fs/promises";
const [cfgPath, ...args] = process.argv.slice(2);
const cfg = JSON.parse(await readFile(cfgPath, "utf8"));
const res = args.includes("ls-files") ? cfg.lsFiles : cfg.catFile;
process.stdout.write(res.output);
process.exitCode = res.status;
`;

async function withFakeGit<T>(
  behavior: FakeGitBehavior,
  operation: (command: GitCommandPrefix) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "mod-fake-git-"));
  const scriptPath = join(root, "fake-git.mjs");
  const cfgPath = join(root, "config.json");
  await Promise.all([
    writeFile(scriptPath, FAKE_GIT),
    writeFile(
      cfgPath,
      JSON.stringify({
        lsFiles: { output: behavior.lsFilesOutput, status: behavior.lsFilesStatus ?? 0 },
        catFile: { output: behavior.catFileOutput ?? "", status: behavior.catFileStatus ?? 0 },
      }),
    ),
  ]);
  try {
    return await operation([process.execPath, scriptPath, cfgPath]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function gitInFixture(repo: string, args: readonly string[]): Promise<void> {
  const proc = Bun.spawn(["git", "-C", repo, ...args], { stderr: "pipe" });
  if ((await proc.exited) !== 0) {
    throw new Error(await new Response(proc.stderr).text());
  }
}

async function createIndexedFixture(opts: { staged: string; working: string; path?: string }): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "mod-index-"));
  const path = opts.path ?? "slice/index.ts";
  const target = join(repo, path);
  await gitInFixture(repo, ["init", "--quiet", "--initial-branch", "main"]);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, opts.staged);
  await gitInFixture(repo, ["add", path]);
  await writeFile(target, opts.working);
  return repo;
}

async function stageFiles(repo: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    const target = join(repo, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, contents);
    await gitInFixture(repo, ["add", path]);
  }
}

const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

function readWithFakeGit(repo: string, behavior: FakeGitBehavior) {
  return withFakeGit(behavior, (command) => readIndexedBlobs(repo, command));
}

function indexRecord(mode: string, oid: string, path: string): string {
  return `${mode} ${oid} 0\t${path}\0`;
}

test("reads staged bytes instead of a divergent working tree", async () => {
  const repo = await createIndexedFixture({ staged: "a\n".repeat(300), working: "b\n".repeat(301) });
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

test("returns empty array when index has no entries", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  expect(await readWithFakeGit(repo, { lsFilesOutput: "" })).toEqual([]);
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
  await gitInFixture(repo, ["update-index", "--add", "--cacheinfo", `100644,${"f".repeat(40)},slice/missing.ts`]);
  await expect(readIndexedBlobs(repo)).rejects.toThrow("malformed cat-file header");
});

test("rejects invalid Git index file modes", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  const oid = "a".repeat(40);
  await expect(readWithFakeGit(repo, {
    lsFilesOutput: indexRecord("100600", oid, "fixture.ts"),
    catFileOutput: `${oid} blob 1\nx\n`,
  })).rejects.toThrow("malformed ls-files record");
});

test("rejects valid-looking cat-file headers with the wrong object type", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  const oid = "b".repeat(40);
  await expect(readWithFakeGit(repo, {
    lsFilesOutput: indexRecord("100644", oid, "fixture.ts"),
    catFileOutput: `${oid} tree 0\n\n`,
  })).rejects.toThrow("malformed cat-file header");
});

test("rejects cat-file bodies shorter than their announced size", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  const oid = "c".repeat(40);
  await expect(readWithFakeGit(repo, {
    lsFilesOutput: indexRecord("100644", oid, "fixture.ts"),
    catFileOutput: `${oid} blob 2\nx\n`,
  })).rejects.toThrow("truncated cat-file blob");
});

test("rejects duplicate index paths", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  const first = "d".repeat(40);
  const second = "e".repeat(40);
  await expect(readWithFakeGit(repo, {
    lsFilesOutput: indexRecord("100644", first, "fixture.ts") + indexRecord("100644", second, "fixture.ts"),
  })).rejects.toThrow("duplicate index path");
});

test("rejects nonzero ls-files exits", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  await expect(readWithFakeGit(repo, { lsFilesOutput: "failure", lsFilesStatus: 17 })).rejects.toThrow("git ls-files failed");
});

test("rejects nonzero cat-file exits", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  const oid = "f".repeat(40);
  await expect(readWithFakeGit(repo, {
    lsFilesOutput: indexRecord("100644", oid, "fixture.ts"),
    catFileStatus: 23,
  })).rejects.toThrow("git cat-file failed");
});

test("orders index paths by code unit", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  const upper = "1".repeat(40);
  const lower = "2".repeat(40);
  const blobs = await readWithFakeGit(repo, {
    lsFilesOutput: indexRecord("100644", lower, "slice/a.ts") + indexRecord("100644", upper, "slice/Z.ts"),
    catFileOutput: `${upper} blob 1\nZ\n${lower} blob 1\na\n`,
  });
  expect(blobs.map((blob) => blob.path)).toEqual(["slice/Z.ts", "slice/a.ts"]);
});

test("transports a single quote in an indexed path without shell interpolation", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  const oid = "3".repeat(40);
  const path = "slice/it's-safe.ts";
  const blobs = await readWithFakeGit(repo, {
    lsFilesOutput: indexRecord("100644", oid, path),
    catFileOutput: `${oid} blob 1\nx\n`,
  });
  expect(blobs.map((blob) => blob.path)).toEqual([path]);
});

test("reads working-tree bytes and an untracked in-scope file for tree provenance", async () => {
  const repo = await createIndexedFixture({ staged: "a\n".repeat(300), working: "b\n".repeat(301) });
  fixtures.push(repo);
  await stageFiles(repo, { "slice/untracked.ts": "export const value = 1;" });
  await gitInFixture(repo, ["rm", "--cached", "slice/untracked.ts"]);
  const blobs = await readTreeBlobs(repo);
  expect(new TextDecoder().decode(blobs.find((blob) => blob.path === "slice/index.ts")?.bytes)).toBe("b\n".repeat(301));
  expect(blobs.map((blob) => blob.path)).toContain("slice/untracked.ts");
});

test("rejects readTreeBlobs on invalid directory", async () => {
  await expect(readTreeBlobs("/nonexistent/invalid/directory")).rejects.toThrow("Unable to read Git index");
});

test("gitInFixture throws on failed git command", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  await expect(gitInFixture(repo, ["checkout", "nonexistent-branch"])).rejects.toThrow();
});

test("resolves merge conflict stages by selecting stage 2 (ours)", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  const oidAncestor = "1".repeat(40);
  const oidOurs = "2".repeat(40);
  const oidTheirs = "3".repeat(40);
  const lsOutput =
    `100644 ${oidAncestor} 1\tslice/conflict.ts\0` +
    `100644 ${oidOurs} 2\tslice/conflict.ts\0` +
    `100644 ${oidTheirs} 3\tslice/conflict.ts\0`;
  const blobs = await readWithFakeGit(repo, {
    lsFilesOutput: lsOutput,
    catFileOutput: `${oidOurs} blob 4\nours\n`,
  });
  expect(blobs.length).toBe(1);
  expect(blobs[0]?.path).toBe("slice/conflict.ts");
  expect(new TextDecoder().decode(blobs[0]?.bytes)).toBe("ours");
});

test("skips submodules (mode 160000) without crashing", async () => {
  const repo = await createIndexedFixture({ staged: "root", working: "root" });
  fixtures.push(repo);
  const subOid = "4".repeat(40);
  const fileOid = "5".repeat(40);
  const lsOutput = `160000 ${subOid} 0\tsubmodule\0` + `100644 ${fileOid} 0\tslice/file.ts\0`;
  const blobs = await readWithFakeGit(repo, {
    lsFilesOutput: lsOutput,
    catFileOutput: `${fileOid} blob 4\nfile\n`,
  });
  expect(blobs.map((blob) => blob.path)).toEqual(["slice/file.ts"]);
});

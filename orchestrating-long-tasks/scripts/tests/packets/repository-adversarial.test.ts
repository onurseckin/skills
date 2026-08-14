import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRepositoryContent } from "../../src/packets/repository-content.ts";
import { inspectRepositoryNode } from "../../src/packets/repository-content-node.ts";
import { repositoryContentPaths } from "../../src/packets/repository-content-paths.ts";
import { decodeNulRecords } from "../../src/packets/repository-git-paths.ts";

const roots: string[] = [];

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

function git(repo: string, args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", repo, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Harness Test",
      GIT_AUTHOR_EMAIL: "harness@example.invalid",
      GIT_COMMITTER_NAME: "Harness Test",
      GIT_COMMITTER_EMAIL: "harness@example.invalid",
    },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

async function fixture(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "repository-adversarial-"));
  roots.push(repo);
  git(repo, ["init", "-q"]);
  await writeFile(join(repo, "tracked.txt"), "tracked bytes\n");
  await writeFile(join(repo, "z-last.txt"), "last bytes\n");
  git(repo, ["add", "tracked.txt", "z-last.txt"]);
  git(repo, ["commit", "-qm", "test: seed"]);
  return repo;
}

describe("adversarial repository identity scanning", () => {
  test("keeps crafted untracked records out of the staged metadata channel", async () => {
    const repo = await fixture();
    const name = `100644 ${"a".repeat(64)} 0\tevil`;
    await writeFile(join(repo, name), "first bytes\n");
    expect(repositoryContentPaths(repo, 1024 * 1024)).toContainEqual({ path: name, index: [] });
    const first = inspectRepositoryContent(repo);
    await writeFile(join(repo, name), "second bytes\n");
    expect(inspectRepositoryContent(repo).content_sha256).not.toBe(first.content_sha256);
  });

  test("rejects a nonempty Git listing without a terminal NUL", () => {
    expect(() => decodeNulRecords(Buffer.from("unterminated"), "untracked")).toThrow(
      "terminal NUL",
    );
  });

  test("rejects deterministic byte mutation between complete node scans", async () => {
    const repo = await fixture();
    expect(() =>
      inspectRepositoryContent(repo, {}, repositoryContentPaths, {
        afterNode: ({ pass, index }) => {
          if (pass === 1 && index === 0)
            writeFileSync(join(repo, "tracked.txt"), "mutated bytes\n");
        },
      }),
    ).toThrow("node identity changed during scan");
  });

  test("rejects an ancestor swapped to a symlink before the leaf read", async () => {
    const repo = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "repository-external-"));
    roots.push(outside);
    await mkdir(join(repo, "nested"));
    await writeFile(join(repo, "nested", "leaf.txt"), "inside bytes\n");
    await writeFile(join(outside, "leaf.txt"), "external bytes\n");
    expect(() =>
      inspectRepositoryNode(repo, { path: "nested/leaf.txt", index: [] }, 1024, {
        afterAncestorCapture: () => {
          rmSync(join(repo, "nested"), { recursive: true });
          symlinkSync(outside, join(repo, "nested"), "dir");
        },
      }),
    ).toThrow("symbolic ancestor");
  });

  test("revalidates ancestor identity after the leaf read", async () => {
    const repo = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "repository-post-read-external-"));
    roots.push(outside);
    await mkdir(join(repo, "nested"));
    await writeFile(join(repo, "nested", "leaf.txt"), "inside bytes\n");
    await writeFile(join(outside, "leaf.txt"), "external bytes\n");
    expect(() =>
      inspectRepositoryNode(repo, { path: "nested/leaf.txt", index: [] }, 1024, {
        afterLeafRead: () => {
          rmSync(join(repo, "nested"), { recursive: true });
          symlinkSync(outside, join(repo, "nested"), "dir");
        },
      }),
    ).toThrow("symbolic ancestor");
  });

  test("fails closed for both uninitialized and initialized indexed gitlinks", async () => {
    const repo = await fixture();
    const head = git(repo, ["rev-parse", "HEAD"]);
    git(repo, ["update-index", "--add", "--cacheinfo", `160000,${head},vendor/module`]);
    expect(() => inspectRepositoryContent(repo)).toThrow("gitlink/submodule nodes are unsupported");

    await mkdir(join(repo, "vendor", "module"), { recursive: true });
    git(join(repo, "vendor", "module"), ["init", "-q"]);
    await writeFile(join(repo, "vendor", "module", "nested.txt"), "nested bytes\n");
    git(join(repo, "vendor", "module"), ["add", "nested.txt"]);
    git(join(repo, "vendor", "module"), ["commit", "-qm", "test: nested seed"]);
    const nestedHead = git(join(repo, "vendor", "module"), ["rev-parse", "HEAD"]);
    git(repo, ["update-index", "--cacheinfo", `160000,${nestedHead},vendor/module`]);
    expect(() => inspectRepositoryContent(repo)).toThrow("gitlink/submodule nodes are unsupported");
  });
});

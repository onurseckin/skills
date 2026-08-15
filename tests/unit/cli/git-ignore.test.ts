import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureHarnessIgnored } from "../../../orchestrating-long-tasks/scripts/src/cli/git-ignore.ts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("capsule ignore policy", () => {
  test("rejects a Git repository until .capsules is ignored", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-ignore-"));
    roots.push(repo);
    const initialized = Bun.spawnSync({ cmd: ["git", "-C", repo, "init", "--quiet"] });
    expect(initialized.exitCode).toBe(0);
    expect(() => ensureHarnessIgnored(repo)).toThrow("gitignored");
    await writeFile(join(repo, ".gitignore"), ".capsules/\n");
    expect(() => ensureHarnessIgnored(repo)).not.toThrow();
  });

  test("permits a non-Git directory without claiming ignore assurance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "harness-nongit-"));
    roots.push(directory);
    expect(ensureHarnessIgnored(directory)).toBe("not-a-git-worktree");
  });
});

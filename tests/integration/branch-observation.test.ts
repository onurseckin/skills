import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  observedFilesChanged,
  observeRepository,
} from "../../orchestrating-long-tasks/scripts/src/workflow/branch/repository-observation.ts";
import { cleanupRoots } from "../unit/branch/fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

async function gitRepo(name: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), `harness-${name}-`));
  roots.push(repo);
  for (const argv of [
    ["init", "--quiet", "--initial-branch", "main"],
    ["config", "user.email", "harness@example.test"],
    ["config", "user.name", "Harness Test"],
  ]) {
    const result = spawnSync("git", argv, { cwd: repo, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  await writeFile(join(repo, "kept.txt"), "one\n");
  spawnSync("git", ["add", "."], { cwd: repo });
  spawnSync("git", ["commit", "--quiet", "-m", "base"], { cwd: repo });
  return repo;
}

const at = (iso: string) => new Date(iso);

describe("branch repository observation", () => {
  test("measures added, edited and deleted paths between two readings", async () => {
    const repo = await gitRepo("observe-delta");
    await writeFile(join(repo, "dirty.txt"), "before\n");
    const before = observeRepository(repo, at("2026-08-19T10:00:00.000Z"));
    expect(before.git_available).toBeTrue();
    expect(before.head).toBeString();

    await writeFile(join(repo, "dirty.txt"), "after\n");
    await writeFile(join(repo, "added.txt"), "new\n");
    await writeFile(join(repo, "kept.txt"), "two\n");
    const after = observeRepository(repo, at("2026-08-19T10:05:00.000Z"));

    expect(observedFilesChanged(before, after, {}, repo)).toEqual([
      "added.txt",
      "dirty.txt",
      "kept.txt",
    ]);
  });

  test("ignores work that was already in the worktree when the branch opened", async () => {
    const repo = await gitRepo("observe-baseline");
    await writeFile(join(repo, "kept.txt"), "parent edit\n");
    const before = observeRepository(repo, at("2026-08-19T10:00:00.000Z"));
    const after = observeRepository(repo, at("2026-08-19T10:05:00.000Z"));
    expect(observedFilesChanged(before, after, {}, repo)).toEqual([]);
  });

  test("records that it measured nothing when the directory is not a Git worktree", async () => {
    const plain = await mkdtemp(join(tmpdir(), "harness-observe-plain-"));
    roots.push(plain);
    const observation = observeRepository(plain, at("2026-08-19T10:00:00.000Z"));
    expect(observation).toEqual({
      observed_at: "2026-08-19T10:00:00.000Z",
      git_available: false,
      head: null,
      entries: [],
    });
    // Unmeasured stays absent: there is no empty change set to mistake for "nothing changed".
    expect(observedFilesChanged(observation, observation, {}, plain)).toBeNull();
  });
});

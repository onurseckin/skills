import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import * as os from "node:os";
import { join } from "node:path";
import {
  areSignalHooksRegistered,
  decideSyncSource,
  firstNonEmpty,
  getActiveCleanupsCount,
  getDirtySkillPaths,
  materializeSkillFromHead,
  parsePorcelainStatus,
  refuseSyncSourceMessage,
  resolveSkillSyncSource,
} from "../../../scripts/sync/git-source.ts";
import { defaultMockSpawnSync, initSkillsRepoAt } from "../../sync/git/git-fixture.ts";
import {
  cleanupVirtualSyncFS,
  getVirtualSyncFS,
  scratchRoot,
  setupVirtualSyncFS,
} from "../../sync/sync-fixture.ts";

let spawnSpy: { mockRestore: () => void } | undefined;
let tmpdirSpy: { mockRestore: () => void } | undefined;
let vfs: ReturnType<typeof getVirtualSyncFS>;

beforeEach(() => {
  vfs = setupVirtualSyncFS();
  spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(
    defaultMockSpawnSync as typeof childProcess.spawnSync,
  );
  tmpdirSpy = spyOn(os, "tmpdir").mockReturnValue("/virtual/sync/tmp");
});

afterEach(() => {
  spawnSpy?.mockRestore();
  tmpdirSpy?.mockRestore();
  cleanupVirtualSyncFS();
});

describe("decideSyncSource", () => {
  test("clean tree without --allow-dirty proceeds from HEAD", () => {
    const decision = decideSyncSource([], false);
    expect(decision).toEqual({ mode: "head" });
  });

  test("dirty tree without --allow-dirty refuses and carries the dirty paths", () => {
    const decision = decideSyncSource(["olt/SKILL.md", "olt/new.ts"], false);
    expect(decision).toEqual({
      mode: "refuse",
      dirtyPaths: ["olt/SKILL.md", "olt/new.ts"],
    });
  });

  test("dirty tree with --allow-dirty proceeds from the worktree", () => {
    const decision = decideSyncSource(["olt/SKILL.md"], true);
    expect(decision).toEqual({ mode: "worktree" });
  });

  test("clean tree with --allow-dirty still proceeds from the worktree, not HEAD", () => {
    const decision = decideSyncSource([], true);
    expect(decision).toEqual({ mode: "worktree" });
  });
});

describe("firstNonEmpty", () => {
  test("returns first non-empty string among values", () => {
    expect(firstNonEmpty(undefined, "", "first", "second")).toBe("first");
    expect(firstNonEmpty(null, undefined, "")).toBe("unknown error");
    expect(firstNonEmpty()).toBe("unknown error");
  });
});

describe("refuseSyncSourceMessage", () => {
  test("names every dirty path, not just a count", () => {
    const message = refuseSyncSourceMessage(["olt/SKILL.md", "olt/harness.ts"], "olt");
    expect(message).toContain("refusing to sync from a dirty olt/ tree");
    expect(message).toContain("--allow-dirty");
    expect(message).toContain("  olt/SKILL.md");
    expect(message).toContain("  olt/harness.ts");
  });
});

describe("parsePorcelainStatus", () => {
  test("returns nothing for empty output", () => {
    expect(parsePorcelainStatus("")).toEqual([]);
    expect(parsePorcelainStatus("\n\n")).toEqual([]);
  });

  test("parses an unstaged modification", () => {
    expect(parsePorcelainStatus(" M olt/SKILL.md\n")).toEqual(["olt/SKILL.md"]);
  });

  test("parses a staged modification", () => {
    expect(parsePorcelainStatus("M  olt/SKILL.md\n")).toEqual(["olt/SKILL.md"]);
  });

  test("parses an untracked file", () => {
    expect(parsePorcelainStatus("?? olt/scratch.ts\n")).toEqual(["olt/scratch.ts"]);
  });

  test("parses a staged rename to the destination path", () => {
    expect(parsePorcelainStatus("R  olt/old.ts -> olt/new.ts\n")).toEqual(["olt/new.ts"]);
  });

  test("parses multiple lines and ignores blank trailing lines", () => {
    const output = " M olt/a.ts\n?? olt/b.ts\nR  olt/c.ts -> olt/d.ts\n\n";
    expect(parsePorcelainStatus(output)).toEqual(["olt/a.ts", "olt/b.ts", "olt/d.ts"]);
  });
});

describe("getDirtySkillPaths", () => {
  test("reports nothing for a clean tree", () => {
    const root = scratchRoot(import.meta.path, "dirty-paths-clean");
    initSkillsRepoAt(root);
    expect(getDirtySkillPaths(root, "olt")).toEqual([]);
  });

  test("reports modified, untracked, and renamed paths under olt/", () => {
    const root = scratchRoot(import.meta.path, "dirty-paths-dirty");
    initSkillsRepoAt(root);

    vfs.writeFileSync(join(root, "olt", "SKILL.md"), "dirty-edit\n", "utf-8");
    vfs.writeFileSync(join(root, "olt", "untracked.ts"), "new\n", "utf-8");
    vfs.renameSync(join(root, "olt", "harness.ts"), join(root, "olt", "harness-renamed.ts"));

    const dirty = getDirtySkillPaths(root, "olt");
    expect(dirty).toContain("olt/SKILL.md");
    expect(dirty).toContain("olt/untracked.ts");
    expect(dirty).toContain("olt/harness.ts");
    expect(dirty).toContain("olt/harness-renamed.ts");
  });

  test("ignores changes outside the olt/ subtree", () => {
    const root = scratchRoot(import.meta.path, "dirty-paths-outside-olt");
    initSkillsRepoAt(root);

    vfs.writeFileSync(join(root, "package.json"), '{"name":"skills","v":2}\n', "utf-8");
    vfs.writeFileSync(join(root, "README.md"), "docs\n", "utf-8");

    expect(getDirtySkillPaths(root, "olt")).toEqual([]);
  });

  test("throws an informative error if git status fails", () => {
    const nonExistent = "/virtual/sync/non-existent-repo-path-for-git-status-test";
    expect(() => getDirtySkillPaths(nonExistent, "olt")).toThrow(
      /git status --porcelain -- olt\/ failed/,
    );
  });
});

describe("materializeSkillFromHead", () => {
  test("materializes the committed content, not the dirty worktree edit", () => {
    const root = scratchRoot(import.meta.path, "materialize-tmp-parent");
    initSkillsRepoAt(root);

    const targetFile = join(root, "olt", "SKILL.md");
    vfs.writeFileSync(targetFile, "dirty-edit-not-in-git\n", "utf-8");

    const initialCount = getActiveCleanupsCount();
    const tmpParent = join(root, "my-custom-tmp");
    const source = materializeSkillFromHead(root, "olt", tmpParent);
    try {
      expect(getActiveCleanupsCount()).toBe(initialCount + 1);
      expect(areSignalHooksRegistered()).toBe(true);
      expect(vfs.existsSync(source.sourceSkillDir)).toBe(true);
      expect(source.sourceSkillDir.startsWith(tmpParent)).toBe(true);
      expect(vfs.readFileSync(join(source.sourceSkillDir, "SKILL.md"), "utf-8")).toBe(
        "canonical-skill\n",
      );
    } finally {
      source.cleanup();
    }

    expect(getActiveCleanupsCount()).toBe(initialCount);
    expect(areSignalHooksRegistered()).toBe(false);
    expect(vfs.existsSync(source.sourceSkillDir)).toBe(false);
  });

  test("throws if git archive fails on a non-repo", () => {
    const root = scratchRoot(import.meta.path, "materialize-non-repo");
    vfs.mkdirSync(root, { recursive: true });
    expect(() => materializeSkillFromHead(root, "olt")).toThrow(/git archive HEAD -- olt\/ failed/);
  });

  test("throws if git archive produces empty stdout", () => {
    const root = scratchRoot(import.meta.path, "materialize-empty-stdout");
    initSkillsRepoAt(root);
    const mockSpawn = (() => ({
      status: 0,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      pid: 1,
      output: [],
      signal: null,
    })) as unknown as typeof childProcess.spawnSync;

    expect(() => materializeSkillFromHead(root, "olt", undefined, mockSpawn)).toThrow(
      /produced no output/,
    );
  });

  test("throws if tar extract fails", () => {
    const root = scratchRoot(import.meta.path, "materialize-tar-fail");
    initSkillsRepoAt(root);
    const mockSpawn = ((cmd: string) => {
      if (cmd === "git") {
        return {
          status: 0,
          stdout: Buffer.from("valid-tar"),
          stderr: Buffer.alloc(0),
          pid: 1,
          output: [],
          signal: null,
        };
      }
      return {
        status: 1,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from("tar extract error"),
        pid: 1,
        output: [],
        signal: null,
      };
    }) as unknown as typeof childProcess.spawnSync;

    expect(() => materializeSkillFromHead(root, "olt", undefined, mockSpawn)).toThrow(
      /failed to extract HEAD olt\/ archive/,
    );
  });
});

describe("resolveSkillSyncSource", () => {
  test("clean tree without --allow-dirty materializes an isolated HEAD copy", () => {
    const root = scratchRoot(import.meta.path, "resolve-clean-head");
    initSkillsRepoAt(root);

    const source = resolveSkillSyncSource(root, "olt", false);
    try {
      expect(vfs.existsSync(source.sourceSkillDir)).toBe(true);
      expect(source.sourceSkillDir).not.toBe(join(root, "olt"));
      expect(vfs.readFileSync(join(source.sourceSkillDir, "SKILL.md"), "utf-8")).toBe(
        "canonical-skill\n",
      );
    } finally {
      source.cleanup();
    }
  });

  test("dirty tree without --allow-dirty refuses and names the dirty paths in the error", () => {
    const root = scratchRoot(import.meta.path, "resolve-dirty-refuse");
    initSkillsRepoAt(root);
    vfs.writeFileSync(join(root, "olt", "SKILL.md"), "dirty\n", "utf-8");

    expect(() => resolveSkillSyncSource(root, "olt", false)).toThrow(
      /refusing to sync from a dirty olt\/ tree/,
    );
  });

  test("dirty tree with --allow-dirty deploys the live worktree unchanged", () => {
    const root = scratchRoot(import.meta.path, "resolve-dirty-allow");
    initSkillsRepoAt(root);
    vfs.writeFileSync(join(root, "olt", "SKILL.md"), "dirty\n", "utf-8");

    const source = resolveSkillSyncSource(root, "olt", true);
    expect(source.sourceSkillDir).toBe(join(root, "olt"));
    expect(vfs.readFileSync(join(source.sourceSkillDir, "SKILL.md"), "utf-8")).toBe("dirty\n");
    expect(() => source.cleanup()).not.toThrow();
  });
});

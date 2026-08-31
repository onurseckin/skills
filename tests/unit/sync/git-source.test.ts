import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  decideSyncSource,
  firstNonEmpty,
  getDirtyOltPaths,
  materializeOltFromHead,
  parsePorcelainStatus,
  refuseSyncSourceMessage,
  resolveOltSyncSource,
} from "../../../scripts/sync/git-source.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

function git(args: string[], cwd: string): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`);
  }
}

function initSkillsRepoAt(repoRoot: string): void {
  mkdirSync(join(repoRoot, "olt"), { recursive: true });
  writeFileSync(join(repoRoot, "olt", "SKILL.md"), "canonical-skill\n", "utf-8");
  writeFileSync(join(repoRoot, "olt", "harness.ts"), "console.log('harness');\n", "utf-8");
  writeFileSync(join(repoRoot, "package.json"), '{"name":"skills"}\n', "utf-8");

  git(["init", "--quiet", "--initial-branch", "main"], repoRoot);
  git(["config", "user.email", "test@example.com"], repoRoot);
  git(["config", "user.name", "Test"], repoRoot);
  git(["add", "-A"], repoRoot);
  git(["commit", "--quiet", "-m", "init"], repoRoot);
}

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
    const message = refuseSyncSourceMessage(["olt/SKILL.md", "olt/harness.ts"]);
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

describe("getDirtyOltPaths", () => {
  test("reports nothing for a clean tree", () => {
    const root = scratchRoot(import.meta.path, "dirty-paths-clean");
    initSkillsRepoAt(root);
    expect(getDirtyOltPaths(root)).toEqual([]);
  });

  test("reports modified, untracked, and renamed paths under olt/", () => {
    const root = scratchRoot(import.meta.path, "dirty-paths-dirty");
    initSkillsRepoAt(root);

    writeFileSync(join(root, "olt", "SKILL.md"), "dirty-edit\n", "utf-8");
    writeFileSync(join(root, "olt", "untracked.ts"), "new\n", "utf-8");
    git(["add", "-N", "olt/untracked.ts"], root);
    renameSync(join(root, "olt", "harness.ts"), join(root, "olt", "harness-renamed.ts"));

    const dirty = getDirtyOltPaths(root);
    expect(dirty).toContain("olt/SKILL.md");
    expect(dirty).toContain("olt/untracked.ts");
    expect(dirty).toContain("olt/harness.ts");
    expect(dirty).toContain("olt/harness-renamed.ts");
  });

  test("ignores changes outside the olt/ subtree", () => {
    const root = scratchRoot(import.meta.path, "dirty-paths-outside-olt");
    initSkillsRepoAt(root);

    writeFileSync(join(root, "package.json"), '{"name":"skills","v":2}\n', "utf-8");
    writeFileSync(join(root, "README.md"), "docs\n", "utf-8");

    expect(getDirtyOltPaths(root)).toEqual([]);
  });

  test("throws an informative error if git status fails", () => {
    const nonExistent = "/tmp/non-existent-repo-path-for-git-status-test-" + Date.now();
    expect(() => getDirtyOltPaths(nonExistent)).toThrow(/git status --porcelain -- olt\/ failed/);
  });
});

describe("materializeOltFromHead", () => {
  test("materializes the committed content, not the dirty worktree edit", () => {
    const root = scratchRoot(import.meta.path, "materialize-tmp-parent");
    initSkillsRepoAt(root);

    const targetFile = join(root, "olt", "SKILL.md");
    writeFileSync(targetFile, "dirty-edit-not-in-git\n", "utf-8");

    const tmpParent = join(root, "my-custom-tmp");
    const source = materializeOltFromHead(root, tmpParent);
    try {
      expect(existsSync(source.sourceOltDir)).toBe(true);
      expect(source.sourceOltDir.startsWith(tmpParent)).toBe(true);
      expect(readFileSync(join(source.sourceOltDir, "SKILL.md"), "utf-8")).toBe(
        "canonical-skill\n",
      );
    } finally {
      source.cleanup();
    }

    expect(existsSync(source.sourceOltDir)).toBe(false);
  });

  test("throws if git archive fails on a non-repo", () => {
    const root = scratchRoot(import.meta.path, "materialize-non-repo");
    mkdirSync(root, { recursive: true });
    expect(() => materializeOltFromHead(root)).toThrow(/git archive HEAD -- olt\/ failed/);
  });

  test("throws if git archive produces empty stdout", () => {
    const root = scratchRoot(import.meta.path, "materialize-empty-stdout");
    initSkillsRepoAt(root);

    const mockSpawn = ((cmd: string) => {
      if (cmd === "git") {
        return {
          status: 0,
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          pid: 1,
          output: [],
          signal: null,
        };
      }
      return {
        status: 0,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        pid: 1,
        output: [],
        signal: null,
      };
    }) as unknown as typeof spawnSync;

    expect(() => materializeOltFromHead(root, undefined, mockSpawn)).toThrow(/produced no output/);
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
      if (cmd === "tar") {
        return {
          status: 1,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from("tar extract error"),
          pid: 1,
          output: [],
          signal: null,
        };
      }
      return {
        status: 0,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        pid: 1,
        output: [],
        signal: null,
      };
    }) as unknown as typeof spawnSync;

    expect(() => materializeOltFromHead(root, undefined, mockSpawn)).toThrow(
      /failed to extract HEAD olt\/ archive/,
    );
  });
});

describe("resolveOltSyncSource", () => {
  test("clean tree without --allow-dirty materializes an isolated HEAD copy", () => {
    const root = scratchRoot(import.meta.path, "resolve-clean-head");
    initSkillsRepoAt(root);

    const source = resolveOltSyncSource(root, false);
    try {
      expect(existsSync(source.sourceOltDir)).toBe(true);
      expect(source.sourceOltDir).not.toBe(join(root, "olt"));
      expect(readFileSync(join(source.sourceOltDir, "SKILL.md"), "utf-8")).toBe(
        "canonical-skill\n",
      );
    } finally {
      source.cleanup();
    }
  });

  test("dirty tree without --allow-dirty refuses and names the dirty paths in the error", () => {
    const root = scratchRoot(import.meta.path, "resolve-dirty-refuse");
    initSkillsRepoAt(root);
    writeFileSync(join(root, "olt", "SKILL.md"), "dirty\n", "utf-8");

    expect(() => resolveOltSyncSource(root, false)).toThrow(
      /refusing to sync from a dirty olt\/ tree/,
    );
  });

  test("dirty tree with --allow-dirty deploys the live worktree unchanged", () => {
    const root = scratchRoot(import.meta.path, "resolve-dirty-allow");
    initSkillsRepoAt(root);
    writeFileSync(join(root, "olt", "SKILL.md"), "dirty\n", "utf-8");

    const source = resolveOltSyncSource(root, true);
    expect(source.sourceOltDir).toBe(join(root, "olt"));
    expect(readFileSync(join(source.sourceOltDir, "SKILL.md"), "utf-8")).toBe("dirty\n");
    expect(() => source.cleanup()).not.toThrow();
  });
});

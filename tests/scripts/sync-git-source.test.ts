import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  decideSyncSource,
  getDirtyOltPaths,
  materializeOltFromHead,
  parsePorcelainStatus,
  refuseSyncSourceMessage,
  resolveOltSyncSource,
} from "../../scripts/sync/git-source.ts";
import { scratchRoot } from "../shared/scratch-root.ts";

function git(args: string[], cwd: string): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`);
  }
}

function initFixtureRepo(root: string): void {
  mkdirSync(join(root, "olt"), { recursive: true });
  writeFileSync(join(root, "olt", "SKILL.md"), "committed-v1\n", "utf-8");
  writeFileSync(join(root, "README.md"), "outside-olt-committed\n", "utf-8");
  git(["init", "--quiet", "--initial-branch", "main"], root);
  git(["config", "user.email", "test@example.com"], root);
  git(["config", "user.name", "Test"], root);
  git(["add", "-A"], root);
  git(["commit", "--quiet", "-m", "init"], root);
}

describe("decideSyncSource", () => {
  test("clean tree without --allow-dirty proceeds from HEAD", () => {
    expect(decideSyncSource([], false)).toEqual({ mode: "head" });
  });

  test("dirty tree without --allow-dirty refuses and carries the dirty paths", () => {
    const decision = decideSyncSource(["olt/agents/critic.yaml", "olt/foo.ts"], false);
    expect(decision).toEqual({
      mode: "refuse",
      dirtyPaths: ["olt/agents/critic.yaml", "olt/foo.ts"],
    });
  });

  test("dirty tree with --allow-dirty proceeds from the worktree", () => {
    expect(decideSyncSource(["olt/agents/critic.yaml"], true)).toEqual({ mode: "worktree" });
  });

  test("clean tree with --allow-dirty still proceeds from the worktree, not HEAD", () => {
    expect(decideSyncSource([], true)).toEqual({ mode: "worktree" });
  });
});

describe("refuseSyncSourceMessage", () => {
  test("names every dirty path, not just a count", () => {
    const message = refuseSyncSourceMessage(["olt/agents/critic.yaml", "olt/foo.ts"]);
    expect(message).toContain("olt/agents/critic.yaml");
    expect(message).toContain("olt/foo.ts");
    expect(message).not.toMatch(/\b2 files?\b/);
  });
});

describe("parsePorcelainStatus", () => {
  test("returns nothing for empty output", () => {
    expect(parsePorcelainStatus("")).toEqual([]);
  });

  test("parses an unstaged modification", () => {
    expect(parsePorcelainStatus(" M olt/agents/critic.yaml")).toEqual(["olt/agents/critic.yaml"]);
  });

  test("parses a staged modification", () => {
    expect(parsePorcelainStatus("M  olt/agents/critic.yaml")).toEqual(["olt/agents/critic.yaml"]);
  });

  test("parses an untracked file", () => {
    expect(parsePorcelainStatus("?? olt/scripts/src/new-file.ts")).toEqual([
      "olt/scripts/src/new-file.ts",
    ]);
  });

  test("parses a staged rename to the destination path", () => {
    expect(parsePorcelainStatus("R  olt/old-name.ts -> olt/new-name.ts")).toEqual([
      "olt/new-name.ts",
    ]);
  });

  test("parses multiple lines and ignores blank trailing lines", () => {
    const output = " M olt/a.ts\n?? olt/b.ts\nR  olt/c.ts -> olt/d.ts\n";
    expect(parsePorcelainStatus(output)).toEqual(["olt/a.ts", "olt/b.ts", "olt/d.ts"]);
  });
});

describe("getDirtyOltPaths", () => {
  test("reports nothing for a clean tree", () => {
    const root = scratchRoot(import.meta.path, "clean-repo");
    initFixtureRepo(root);
    expect(getDirtyOltPaths(root)).toEqual([]);
  });

  test("reports modified, untracked, and renamed paths under olt/", () => {
    const root = scratchRoot(import.meta.path, "dirty-repo");
    initFixtureRepo(root);
    writeFileSync(join(root, "olt", "SKILL.md"), "uncommitted-edit\n", "utf-8");
    writeFileSync(join(root, "olt", "new-untracked.ts"), "export const x = 1;\n", "utf-8");
    mkdirSync(join(root, "olt", "agents"), { recursive: true });
    writeFileSync(join(root, "olt", "agents", "old.yaml"), "name: old\n", "utf-8");
    git(["add", join(root, "olt", "agents", "old.yaml")], root);
    git(["commit", "--quiet", "-m", "add renamable file"], root);
    git(["mv", "olt/agents/old.yaml", "olt/agents/renamed.yaml"], root);

    const dirty = getDirtyOltPaths(root).sort();
    expect(dirty).toEqual(
      ["olt/SKILL.md", "olt/agents/renamed.yaml", "olt/new-untracked.ts"].sort(),
    );
  });

  test("ignores changes outside the olt/ subtree", () => {
    const root = scratchRoot(import.meta.path, "outside-scope-repo");
    initFixtureRepo(root);
    writeFileSync(join(root, "README.md"), "dirty-outside-olt\n", "utf-8");
    writeFileSync(join(root, "unrelated-untracked.txt"), "noise\n", "utf-8");
    expect(getDirtyOltPaths(root)).toEqual([]);
  });
});

describe("materializeOltFromHead", () => {
  test("materializes the committed content, not the dirty worktree edit", () => {
    const root = scratchRoot(import.meta.path, "materialize-repo");
    const tmpParent = scratchRoot(import.meta.path, "materialize-tmp-parent");
    initFixtureRepo(root);
    writeFileSync(join(root, "olt", "SKILL.md"), "uncommitted-dirty-edit\n", "utf-8");

    const { sourceOltDir, cleanup } = materializeOltFromHead(root, tmpParent);
    try {
      expect(sourceOltDir).not.toBe(join(root, "olt"));
      expect(readFileSync(join(sourceOltDir, "SKILL.md"), "utf-8")).toBe("committed-v1\n");
      expect(existsSync(join(sourceOltDir, "SKILL.md"))).toBe(true);
    } finally {
      cleanup();
    }
    expect(existsSync(sourceOltDir)).toBe(false);
  });
});

describe("resolveOltSyncSource", () => {
  test("clean tree without --allow-dirty materializes an isolated HEAD copy", () => {
    const root = scratchRoot(import.meta.path, "resolve-clean-repo");
    initFixtureRepo(root);

    const { sourceOltDir, cleanup } = resolveOltSyncSource(root, false);
    try {
      expect(sourceOltDir).not.toBe(join(root, "olt"));
      expect(readFileSync(join(sourceOltDir, "SKILL.md"), "utf-8")).toBe("committed-v1\n");
    } finally {
      cleanup();
    }
  });

  test("dirty tree without --allow-dirty refuses and names the dirty paths in the error", () => {
    const root = scratchRoot(import.meta.path, "resolve-dirty-repo");
    initFixtureRepo(root);
    writeFileSync(join(root, "olt", "SKILL.md"), "dirty\n", "utf-8");

    expect(() => resolveOltSyncSource(root, false)).toThrow(/olt\/SKILL\.md/);
  });

  test("dirty tree with --allow-dirty deploys the live worktree unchanged", () => {
    const root = scratchRoot(import.meta.path, "resolve-allow-dirty-repo");
    initFixtureRepo(root);
    writeFileSync(join(root, "olt", "SKILL.md"), "dirty-but-allowed\n", "utf-8");

    const { sourceOltDir, cleanup } = resolveOltSyncSource(root, true);
    expect(sourceOltDir).toBe(join(root, "olt"));
    expect(readFileSync(join(sourceOltDir, "SKILL.md"), "utf-8")).toBe("dirty-but-allowed\n");

    cleanup();
    expect(existsSync(join(root, "olt", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(root, "olt", "SKILL.md"), "utf-8")).toBe("dirty-but-allowed\n");
  });
});

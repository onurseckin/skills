import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { proveGateFalsifiable } from "../../../olt/scripts/src/graph/gate-proof.ts";
import {
  cleanupProofRepos,
  fakeGit,
  fsCheckSpawn,
  installGateProofSpies,
  noopSpawn,
  repoWithoutRealGit,
  setupVirtualGraphFS,
} from "./gate-proof-fixture.ts";

describe("proveGateFalsifiable: core falsifiability", () => {
  beforeEach(() => {
    installGateProofSpies();
    setupVirtualGraphFS();
  });

  afterEach(() => {
    cleanupProofRepos();
  });

  test("falsifiable when the gate checks for a file the task's write scope newly created", () => {
    const repo = repoWithoutRealGit("new-file-falsifiable");
    writeFileSync(join(repo, "README.md"), "hi\n");
    writeFileSync(join(repo, "feature.ts"), "export const x = 1;\n");
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("README.md\0feature.ts\0") },
      "ls-tree": { status: 0, bytes: Buffer.from("") },
    });
    const spawn = fsCheckSpawn((cwd) => existsSync(join(cwd, "feature.ts")));
    const result = proveGateFalsifiable(
      { repoRoot: repo, writeScope: ["feature.ts"], gateArgv: ["test", "-f", "feature.ts"] },
      { git, spawn },
    );
    expect(result.falsifiable).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(result.deletedPaths).toEqual(["feature.ts"]);
    expect(result.restoredPaths).toEqual([]);
  });

  test("falsifiable when the gate checks content a modified tracked file now carries", () => {
    const repo = repoWithoutRealGit("modified-file-falsifiable");
    writeFileSync(join(repo, "shared.ts"), "export const status = 'safe';\n");
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("shared.ts\0") },
      "ls-tree": { status: 0, bytes: Buffer.from("100644 blob abc123\tshared.ts\n") },
      show: { status: 0, bytes: Buffer.from("export const status = 'broken';\n") },
    });
    const spawn = fsCheckSpawn((cwd) =>
      readFileSync(join(cwd, "shared.ts"), "utf8").includes("safe"),
    );
    const result = proveGateFalsifiable(
      { repoRoot: repo, writeScope: ["shared.ts"], gateArgv: ["test", "-f", "README.md"] },
      { git, spawn },
    );
    expect(result.falsifiable).toBe(true);
    expect(result.restoredPaths).toEqual(["shared.ts"]);
  });

  test("falsifiable when the gate checks that a file the task deleted is gone", () => {
    const repo = repoWithoutRealGit("deleted-file-falsifiable");
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("") },
      "ls-tree": { status: 0, bytes: Buffer.from("100644 blob abc123\tlegacy.ts\n") },
      show: { status: 0, bytes: Buffer.from("export const dead = true;\n") },
    });
    const spawn = fsCheckSpawn((cwd) => !existsSync(join(cwd, "legacy.ts")));
    const result = proveGateFalsifiable(
      { repoRoot: repo, writeScope: ["legacy.ts"], gateArgv: ["test", "-f", "README.md"] },
      { git, spawn },
    );
    expect(result.falsifiable).toBe(true);
    expect(result.restoredPaths).toEqual(["legacy.ts"]);
    expect(existsSync(join(repo, "legacy.ts"))).toBe(false);
  });

  test("reverting a directory scope restores every file underneath it", () => {
    const repo = repoWithoutRealGit("directory-scope-revert");
    mkdirSync(join(repo, "src/db"), { recursive: true });
    writeFileSync(join(repo, "src/db/index.ts"), "export const a = 2;\n");
    writeFileSync(join(repo, "src/db/new.ts"), "export const b = 1;\n");
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("src/db/index.ts\0src/db/new.ts\0") },
      "ls-tree": { status: 0, bytes: Buffer.from("100644 blob abc123\tsrc/db/index.ts\n") },
      show: { status: 0, bytes: Buffer.from("export const a = 1;\n") },
    });
    const spawn = fsCheckSpawn((cwd) => existsSync(join(cwd, "src/db/new.ts")));
    const result = proveGateFalsifiable(
      { repoRoot: repo, writeScope: ["src/db"], gateArgv: ["test", "-f", "src/db/new.ts"] },
      { git, spawn },
    );
    expect(result.falsifiable).toBe(true);
    expect(result.deletedPaths).toEqual(["src/db/new.ts"]);
  });

  test("not falsifiable when the gate ignores the write scope entirely", () => {
    const repo = repoWithoutRealGit("ignores-write-scope");
    writeFileSync(join(repo, "README.md"), "hi\n");
    writeFileSync(join(repo, "feature.ts"), "export const x = 1;\n");
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("README.md\0feature.ts\0") },
      "ls-tree": { status: 0, bytes: Buffer.from("") },
    });
    const result = proveGateFalsifiable(
      { repoRoot: repo, writeScope: ["feature.ts"], gateArgv: ["test", "-f", "README.md"] },
      { git, spawn: noopSpawn },
    );
    expect(result.falsifiable).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  test("respects the repository's own ignore rules: an ignored file never reaches the scratch copy", () => {
    const repo = repoWithoutRealGit("gitignore-respected");
    writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
    writeFileSync(join(repo, "README.md"), "hi\n");
    writeFileSync(join(repo, "ignored.txt"), "should never be copied\n");
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("README.md\0") },
      "ls-tree": { status: 0, bytes: Buffer.from("100644 blob abc123\tREADME.md\n") },
      show: { status: 0, bytes: Buffer.from("hi\n") },
    });
    const spawn = fsCheckSpawn((cwd) => !existsSync(join(cwd, "ignored.txt")));
    const result = proveGateFalsifiable(
      { repoRoot: repo, writeScope: ["README.md"], gateArgv: ["test", "-f", "README.md"] },
      { git, spawn },
    );
    expect(result.exitCode).toBe(0);
  });

  test("the real repository is untouched: content, and the scratch directory, both gone afterward", () => {
    const repo = repoWithoutRealGit("repo-untouched");
    writeFileSync(join(repo, "shared.ts"), "export const status = 'safe';\n");
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("shared.ts\0") },
      "ls-tree": { status: 0, bytes: Buffer.from("100644 blob abc123\tshared.ts\n") },
      show: { status: 0, bytes: Buffer.from("export const status = 'broken';\n") },
    });
    proveGateFalsifiable(
      { repoRoot: repo, writeScope: ["shared.ts"], gateArgv: ["test", "-f", "README.md"] },
      { git, spawn: noopSpawn },
    );
    expect(readFileSync(join(repo, "shared.ts"), "utf8")).toBe("export const status = 'safe';\n");
  });

  test("a write-scope entry absent from both history and the working tree restores nothing", () => {
    const repo = repoWithoutRealGit("ghost-scope");
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("") },
      "ls-tree": { status: 0, bytes: Buffer.from("") },
    });
    const result = proveGateFalsifiable(
      {
        repoRoot: repo,
        writeScope: ["never-existed"],
        gateArgv: ["test", "-f", "README.md"],
      },
      { git, spawn: noopSpawn },
    );
    expect(result.restoredPaths).toEqual([]);
    expect(result.deletedPaths).toEqual([]);
  });

  test("reverting a directory walks into a nested subdirectory to delete a file the base never had", () => {
    const repo = repoWithoutRealGit("nested-scope");
    mkdirSync(join(repo, "src/db/nested"), { recursive: true });
    writeFileSync(join(repo, "src/db/index.ts"), "export const a = 2;\n");
    writeFileSync(join(repo, "src/db/nested/deep.ts"), "export const b = 1;\n");
    const git = fakeGit({
      "ls-files": {
        status: 0,
        bytes: Buffer.from("src/db/index.ts\0src/db/nested/deep.ts\0"),
      },
      "ls-tree": { status: 0, bytes: Buffer.from("100644 blob abc123\tsrc/db/index.ts\n") },
      show: { status: 0, bytes: Buffer.from("export const a = 1;\n") },
    });
    const result = proveGateFalsifiable(
      { repoRoot: repo, writeScope: ["src/db"], gateArgv: ["test", "-f", "README.md"] },
      { git, spawn: noopSpawn },
    );
    expect(result.restoredPaths).toEqual(["src/db/index.ts"]);
    expect(result.deletedPaths).toEqual(["src/db/nested/deep.ts"]);
  });
});

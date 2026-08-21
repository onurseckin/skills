import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendGateProof,
  latestGateProof,
  nodeSpawnGate,
  proveGateFalsifiable,
  readGateProofs,
  type GateProofRecord,
  type GateSpawn,
} from "../../../orchestrating-long-tasks/scripts/src/graph/gate-proof.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import type { JsonObject } from "../../../orchestrating-long-tasks/scripts/src/contracts/json.ts";
import type {
  RepositoryGitCommand,
  RepositoryGitResult,
} from "../../../orchestrating-long-tasks/scripts/src/packets/repository-git-command.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(repo: string, argv: readonly string[]): void {
  const result = spawnSync("git", [...argv], { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${argv.join(" ")}: ${result.stderr}`);
}

/** A real, committed repository — `proveGateFalsifiable` needs real Git history to revert against,
 *  the same way `tests/unit/workflow/worktree/fixture.ts` needs one for real worktree operations. */
function committedRepo(files: Record<string, string>): string {
  const repo = mkdtempSync(join(tmpdir(), "gate-proof-fixture-"));
  roots.push(repo);
  git(repo, ["init", "--quiet", "--initial-branch", "main"]);
  git(repo, ["config", "user.email", "harness@example.test"]);
  git(repo, ["config", "user.name", "Harness Test"]);
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(repo, relative);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, contents);
  }
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "--quiet", "-m", "base"]);
  return repo;
}

describe("proveGateFalsifiable", () => {
  test("falsifiable when the gate checks for a file the task's write scope newly created", () => {
    const repo = committedRepo({ "README.md": "hi\n" });
    writeFileSync(join(repo, "feature.ts"), "export const x = 1;\n");
    const result = proveGateFalsifiable({
      repoRoot: repo,
      writeScope: ["feature.ts"],
      gateArgv: ["test", "-f", "feature.ts"],
    });
    expect(result.falsifiable).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(result.deletedPaths).toEqual(["feature.ts"]);
    expect(result.restoredPaths).toEqual([]);
  });

  test("falsifiable when the gate checks content a modified tracked file now carries", () => {
    const repo = committedRepo({ "shared.ts": "export const status = 'broken';\n" });
    writeFileSync(join(repo, "shared.ts"), "export const status = 'safe';\n");
    const result = proveGateFalsifiable({
      repoRoot: repo,
      writeScope: ["shared.ts"],
      gateArgv: ["grep", "-q", "safe", "shared.ts"],
    });
    expect(result.falsifiable).toBe(true);
    expect(result.restoredPaths).toEqual(["shared.ts"]);
  });

  test("falsifiable when the gate checks that a file the task deleted is gone", () => {
    const repo = committedRepo({ "legacy.ts": "export const dead = true;\n" });
    rmSync(join(repo, "legacy.ts"));
    const result = proveGateFalsifiable({
      repoRoot: repo,
      writeScope: ["legacy.ts"],
      gateArgv: ["test", "!", "-f", "legacy.ts"],
    });
    expect(result.falsifiable).toBe(true);
    expect(result.restoredPaths).toEqual(["legacy.ts"]);
    // The restore happened only inside the scratch copy; the real repository the task actually
    // deleted the file in must come back untouched, still without it.
    expect(existsSync(join(repo, "legacy.ts"))).toBe(false);
  });

  test("reverting a directory scope restores every file underneath it", () => {
    const repo = committedRepo({ "src/db/index.ts": "export const a = 1;\n" });
    writeFileSync(join(repo, "src/db/index.ts"), "export const a = 2;\n");
    writeFileSync(join(repo, "src/db/new.ts"), "export const b = 1;\n");
    const result = proveGateFalsifiable({
      repoRoot: repo,
      writeScope: ["src/db"],
      gateArgv: ["test", "-f", "src/db/new.ts"],
    });
    expect(result.falsifiable).toBe(true);
    expect(result.deletedPaths).toEqual(["src/db/new.ts"]);
  });

  test("not falsifiable when the gate ignores the write scope entirely", () => {
    const repo = committedRepo({ "README.md": "hi\n" });
    writeFileSync(join(repo, "feature.ts"), "export const x = 1;\n");
    const result = proveGateFalsifiable({
      repoRoot: repo,
      writeScope: ["feature.ts"],
      gateArgv: ["true"],
    });
    expect(result.falsifiable).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  test("respects the repository's own ignore rules: an ignored file never reaches the scratch copy", () => {
    const repo = committedRepo({ ".gitignore": "ignored.txt\n", "README.md": "hi\n" });
    writeFileSync(join(repo, "ignored.txt"), "should never be copied\n");
    const result = proveGateFalsifiable({
      repoRoot: repo,
      writeScope: ["README.md"],
      gateArgv: ["test", "!", "-f", "ignored.txt"],
    });
    expect(result.exitCode).toBe(0);
  });

  test("the real repository is untouched: content, and the scratch directory, both gone afterward", () => {
    const repo = committedRepo({ "shared.ts": "export const status = 'broken';\n" });
    writeFileSync(join(repo, "shared.ts"), "export const status = 'safe';\n");
    proveGateFalsifiable({
      repoRoot: repo,
      writeScope: ["shared.ts"],
      gateArgv: ["grep", "-q", "safe", "shared.ts"],
    });
    expect(readFileSync(join(repo, "shared.ts"), "utf8")).toBe("export const status = 'safe';\n");
  });

  test("throws when the repository root carries no Git metadata", () => {
    const plain = mkdtempSync(join(tmpdir(), "gate-proof-plain-"));
    roots.push(plain);
    writeFileSync(join(plain, "a.ts"), "export const a = 1;\n");
    expect(() =>
      proveGateFalsifiable({ repoRoot: plain, writeScope: ["a.ts"], gateArgv: ["true"] }),
    ).toThrow(HarnessError);
  });

  test("throws on an empty write scope rather than reverting nothing silently", () => {
    const repo = committedRepo({ "README.md": "hi\n" });
    expect(() =>
      proveGateFalsifiable({ repoRoot: repo, writeScope: [], gateArgv: ["true"] }),
    ).toThrow(HarnessError);
  });

  test("throws on an empty gate argv", () => {
    const repo = committedRepo({ "README.md": "hi\n" });
    expect(() =>
      proveGateFalsifiable({ repoRoot: repo, writeScope: ["README.md"], gateArgv: [] }),
    ).toThrow(HarnessError);
  });

  test("refuses a tree over --max-files instead of proving an unexpectedly expensive copy", () => {
    const repo = committedRepo({ "README.md": "hi\n" });
    expect(() =>
      proveGateFalsifiable({
        repoRoot: repo,
        writeScope: ["README.md"],
        gateArgv: ["true"],
        maxFiles: 0,
      }),
    ).toThrow(HarnessError);
  });
});

/** A directory carrying only a real `.git` marker — `hasRepositoryGitMetadata` only needs that
 *  directory to exist; every actual `git` invocation is intercepted by the fake below instead. */
function repoWithoutRealGit(label: string): string {
  const repo = scratchRoot(import.meta.path, label);
  mkdirSync(join(repo, ".git"));
  return repo;
}

/** Scripts `repositoryGit` by argv[0] (ls-files / ls-tree / show), the three subcommands
 *  `proveGateFalsifiable` issues. Lets these tests reach branches that depend on exact Git
 *  plumbing output (an untracked scope, a nested directory, an unsupported blob mode) without
 *  spawning a real `git` process — the injected `GateProveDependencies.git` seam exists for
 *  exactly this. */
function fakeGit(script: Record<string, RepositoryGitResult>): RepositoryGitCommand {
  return (_repo, argv) => {
    const verb = argv[0] ?? "";
    const scripted = script[verb];
    if (!scripted) throw new Error(`fakeGit: no script for ${argv.join(" ")}`);
    return scripted;
  };
}

const noopSpawn: GateSpawn = () => ({ status: 0, stdout: "", stderr: "", timedOut: false });

describe("proveGateFalsifiable with a scripted git dependency", () => {
  test("a write-scope entry absent from both history and the working tree restores nothing", () => {
    const repo = repoWithoutRealGit("ghost-scope");
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("") },
      "ls-tree": { status: 0, bytes: Buffer.from("") },
    });
    const result = proveGateFalsifiable(
      { repoRoot: repo, writeScope: ["never-existed"], gateArgv: ["true"] },
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
      // At the base commit only index.ts existed; nested/deep.ts is new.
      "ls-tree": { status: 0, bytes: Buffer.from("100644 blob abc123\tsrc/db/index.ts\n") },
      show: { status: 0, bytes: Buffer.from("export const a = 1;\n") },
    });
    const result = proveGateFalsifiable(
      { repoRoot: repo, writeScope: ["src/db"], gateArgv: ["true"] },
      { git, spawn: noopSpawn },
    );
    expect(result.restoredPaths).toEqual(["src/db/index.ts"]);
    expect(result.deletedPaths).toEqual(["src/db/nested/deep.ts"]);
  });

  test("refuses to revert a symlink or submodule recorded in the write scope", () => {
    const repo = repoWithoutRealGit("unsupported-blob-mode");
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("") },
      "ls-tree": { status: 0, bytes: Buffer.from("120000 blob abc123\tsrc/link\n") },
    });
    expect(() =>
      proveGateFalsifiable(
        { repoRoot: repo, writeScope: ["src/link"], gateArgv: ["true"] },
        { git, spawn: noopSpawn },
      ),
    ).toThrow(/symlink or submodule/);
  });
});

describe("nodeSpawnGate", () => {
  test("surfaces a process that never started as a HarnessError, not a raw spawn error", () => {
    const cwd = scratchRoot(import.meta.path, "missing-binary");
    expect(() => nodeSpawnGate(["definitely-not-a-real-binary-8f3c2b"], cwd, 5_000)).toThrow(
      HarnessError,
    );
    expect(() => nodeSpawnGate(["definitely-not-a-real-binary-8f3c2b"], cwd, 5_000)).toThrow(
      "gate command failed to start",
    );
  });
});

describe("gate proof records", () => {
  function record(overrides: Partial<GateProofRecord> = {}): GateProofRecord {
    return {
      task_id: "task-1",
      gate_argv: ["bun", "test", "tests/db.test.ts"],
      write_scope: ["src/db"],
      base: "HEAD",
      falsifiable: true,
      exit_code: 1,
      timed_out: false,
      proved_at: "2026-08-20T00:00:00.000Z",
      actor: "coordinator",
      ...overrides,
    };
  }

  test("appendGateProof is additive and readGateProofs replays it back in order", () => {
    const state: JsonObject = {};
    appendGateProof(state, record({ exit_code: 1 }));
    appendGateProof(state, record({ exit_code: 2, falsifiable: false }));
    const records = readGateProofs(state);
    expect(records.map((entry) => entry.exit_code)).toEqual([1, 2]);
  });

  test("latestGateProof returns the most recent record for the task's current gate argv", () => {
    const state: JsonObject = {};
    appendGateProof(state, record({ gate_argv: ["old", "gate"], falsifiable: true }));
    appendGateProof(
      state,
      record({ gate_argv: ["bun", "test", "tests/db.test.ts"], falsifiable: false }),
    );
    appendGateProof(
      state,
      record({ gate_argv: ["bun", "test", "tests/db.test.ts"], falsifiable: true }),
    );
    const found = latestGateProof(state, "task-1", ["bun", "test", "tests/db.test.ts"]);
    expect(found?.falsifiable).toBe(true);
  });

  test("latestGateProof is undefined when the exact gate has never been proved", () => {
    const state: JsonObject = {};
    appendGateProof(state, record({ gate_argv: ["old", "gate"] }));
    expect(latestGateProof(state, "task-1", ["bun", "test", "tests/db.test.ts"])).toBeUndefined();
  });

  test("readGateProofs never throws on a tree gate:prove has never touched", () => {
    expect(readGateProofs({})).toEqual([]);
  });
});

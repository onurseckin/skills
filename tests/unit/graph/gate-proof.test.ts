import { describe, expect, test } from "bun:test";
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
} from "../../../olt/scripts/src/graph/gate-proof.ts";
import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";
import type { JsonObject } from "../../../olt/scripts/src/contracts/json.ts";
import type {
  RepositoryGitCommand,
  RepositoryGitResult,
} from "../../../olt/scripts/src/packets/repository-git-command.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

/** A directory carrying only a real `.git` marker — `hasRepositoryGitMetadata` only needs that
 *  directory to exist; every actual `git` invocation is intercepted by the fake below instead, so
 *  no test in this file spawns a real `git` process. */
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

/** Stands in for the real gate subprocess: it reads the same scratch-copy filesystem the real
 *  command would have run against and answers the same yes/no question a shelled-out
 *  `test -f` / `grep -q` would, without ever spawning one. This still proves the revert really
 *  happened on disk — it just asks Node instead of a child process. */
function fsCheckSpawn(check: (cwd: string) => boolean): GateSpawn {
  return (_argv, cwd) => ({
    status: check(cwd) ? 0 : 1,
    stdout: "",
    stderr: "",
    timedOut: false,
  });
}

describe("proveGateFalsifiable", () => {
  test("falsifiable when the gate checks for a file the task's write scope newly created", () => {
    const repo = repoWithoutRealGit("new-file-falsifiable");
    writeFileSync(join(repo, "README.md"), "hi\n");
    writeFileSync(join(repo, "feature.ts"), "export const x = 1;\n");
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("README.md\0feature.ts\0") },
      // feature.ts never existed at the base ref, so the write scope is empty there.
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
      { repoRoot: repo, writeScope: ["shared.ts"], gateArgv: ["grep", "-q", "safe", "shared.ts"] },
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
    // The gate is `test ! -f legacy.ts`: it passes (status 0) only while the file stays gone.
    const spawn = fsCheckSpawn((cwd) => !existsSync(join(cwd, "legacy.ts")));
    const result = proveGateFalsifiable(
      { repoRoot: repo, writeScope: ["legacy.ts"], gateArgv: ["test", "!", "-f", "legacy.ts"] },
      { git, spawn },
    );
    expect(result.falsifiable).toBe(true);
    expect(result.restoredPaths).toEqual(["legacy.ts"]);
    // The restore happened only inside the scratch copy; the real repository the task actually
    // deleted the file in must come back untouched, still without it.
    expect(existsSync(join(repo, "legacy.ts"))).toBe(false);
  });

  test("reverting a directory scope restores every file underneath it", () => {
    const repo = repoWithoutRealGit("directory-scope-revert");
    mkdirSync(join(repo, "src/db"), { recursive: true });
    writeFileSync(join(repo, "src/db/index.ts"), "export const a = 2;\n");
    writeFileSync(join(repo, "src/db/new.ts"), "export const b = 1;\n");
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("src/db/index.ts\0src/db/new.ts\0") },
      // At the base commit only index.ts existed; new.ts is new.
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
      { repoRoot: repo, writeScope: ["feature.ts"], gateArgv: ["true"] },
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
    // A real `git ls-files --exclude-standard` would already have dropped ignored.txt; scripting
    // that same result here tests that copyIntoScratch only ever copies what it is handed.
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("README.md\0") },
      "ls-tree": { status: 0, bytes: Buffer.from("100644 blob abc123\tREADME.md\n") },
      show: { status: 0, bytes: Buffer.from("hi\n") },
    });
    const spawn = fsCheckSpawn((cwd) => !existsSync(join(cwd, "ignored.txt")));
    const result = proveGateFalsifiable(
      { repoRoot: repo, writeScope: ["README.md"], gateArgv: ["test", "!", "-f", "ignored.txt"] },
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
      { repoRoot: repo, writeScope: ["shared.ts"], gateArgv: ["grep", "-q", "safe", "shared.ts"] },
      { git, spawn: noopSpawn },
    );
    expect(readFileSync(join(repo, "shared.ts"), "utf8")).toBe("export const status = 'safe';\n");
  });

  test("throws when the repository root carries no Git metadata", () => {
    // Must sit outside the checkout's own Git tree — scratchRoot() is deliberately nested inside
    // it (under os.tmpdir()/olt-test-scratch), which would make hasRepositoryGitMetadata's parent walk find
    // this repo's real .git and defeat the very thing this test proves. tmpdir() is the one
    // location guaranteed to have no Git ancestor, so this is the one test in the file that still
    // needs a real, OS-temp scratch directory with its own cleanup.
    const plain = mkdtempSync(join(tmpdir(), "gate-proof-no-git-"));
    try {
      writeFileSync(join(plain, "a.ts"), "export const a = 1;\n");
      expect(() =>
        proveGateFalsifiable({ repoRoot: plain, writeScope: ["a.ts"], gateArgv: ["true"] }),
      ).toThrow(HarnessError);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  test("throws on an empty write scope rather than reverting nothing silently", () => {
    const repo = scratchRoot(import.meta.path, "empty-write-scope");
    expect(() =>
      proveGateFalsifiable({ repoRoot: repo, writeScope: [], gateArgv: ["true"] }),
    ).toThrow(HarnessError);
  });

  test("throws on an empty gate argv", () => {
    const repo = scratchRoot(import.meta.path, "empty-gate-argv");
    expect(() =>
      proveGateFalsifiable({ repoRoot: repo, writeScope: ["README.md"], gateArgv: [] }),
    ).toThrow(HarnessError);
  });

  test("refuses a tree over --max-files instead of proving an unexpectedly expensive copy", () => {
    const repo = repoWithoutRealGit("max-files-refusal");
    writeFileSync(join(repo, "README.md"), "hi\n");
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("README.md\0") },
    });
    expect(() =>
      proveGateFalsifiable(
        { repoRoot: repo, writeScope: ["README.md"], gateArgv: ["true"], maxFiles: 0 },
        { git, spawn: noopSpawn },
      ),
    ).toThrow(HarnessError);
  });
});

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

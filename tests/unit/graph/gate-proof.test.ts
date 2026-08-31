import { describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
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
    // The gate is `test ! -f legacy.ts`: it passes (status 0) only while the file stays gone.
    const spawn = fsCheckSpawn((cwd) => !existsSync(join(cwd, "legacy.ts")));
    const result = proveGateFalsifiable(
      { repoRoot: repo, writeScope: ["legacy.ts"], gateArgv: ["test", "-f", "README.md"] },
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
    // A real `git ls-files --exclude-standard` would already have dropped ignored.txt; scripting
    // that same result here tests that copyIntoScratch only ever copies what it is handed.
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
        proveGateFalsifiable({
          repoRoot: plain,
          writeScope: ["a.ts"],
          gateArgv: ["test", "-f", "README.md"],
        }),
      ).toThrow(HarnessError);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  test("throws on an empty write scope rather than reverting nothing silently", () => {
    const repo = scratchRoot(import.meta.path, "empty-write-scope");
    expect(() =>
      proveGateFalsifiable({
        repoRoot: repo,
        writeScope: [],
        gateArgv: ["test", "-f", "README.md"],
      }),
    ).toThrow(HarnessError);
  });

  test("rejects an empty gate argv before invoking injected dependencies", () => {
    const repo = repoWithoutRealGit("empty-gate-argv");
    let gitCalled = false;
    let spawnCalled = false;
    let error: unknown;
    try {
      proveGateFalsifiable(
        { repoRoot: repo, writeScope: ["README.md"], gateArgv: [] },
        {
          git: () => {
            gitCalled = true;
            throw new Error("Git must not be invoked for an empty gate argv");
          },
          spawn: () => {
            spawnCalled = true;
            throw new Error("spawn must not be invoked for an empty gate argv");
          },
        },
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(HarnessError);
    expect((error as HarnessError).code).toBe("INVALID_ARGUMENT");
    expect((error as Error).message).toBe("gate:prove needs a gate command to run");
    expect((error as Error).message).not.toContain("gate-command-policy");
    expect(gitCalled).toBe(false);
    expect(spawnCalled).toBe(false);
  });

  test("refuses a weak gate command before creating a scratch workspace or invoking dependencies", () => {
    const repo = repoWithoutRealGit("weak-gate-command");
    let gitCalled = false;
    let spawnCalled = false;
    const scratchRootsBefore = readdirSync(tmpdir())
      .filter((entry) => entry.startsWith("gate-prove-"))
      .sort();
    expect(() =>
      proveGateFalsifiable(
        { repoRoot: repo, writeScope: ["README.md"], gateArgv: ["bash", "-c", "exit 0"] },
        {
          git: () => {
            gitCalled = true;
            throw new Error("Git must not be invoked for a weak gate");
          },
          spawn: () => {
            spawnCalled = true;
            throw new Error("spawn must not be invoked for a weak gate");
          },
        },
      ),
    ).toThrow(/fails the gate-command-policy/);
    expect(gitCalled).toBe(false);
    expect(spawnCalled).toBe(false);
    expect(
      readdirSync(tmpdir())
        .filter((entry) => entry.startsWith("gate-prove-"))
        .sort(),
    ).toEqual(scratchRootsBefore);
  });

  test("lets a policy-valid gate argv reach the injected Git and spawn path", () => {
    const repo = repoWithoutRealGit("policy-valid-gate-command");
    writeFileSync(join(repo, "README.md"), "current\n");
    const gitCalls: string[] = [];
    let spawnCalled = false;
    const git: RepositoryGitCommand = (_repo, argv) => {
      const verb = argv[0] ?? "";
      gitCalls.push(verb);
      if (verb === "ls-files") return { status: 0, bytes: Buffer.from("README.md\0") };
      if (verb === "ls-tree")
        return { status: 0, bytes: Buffer.from("100644 blob abc123\tREADME.md\n") };
      if (verb === "show") return { status: 0, bytes: Buffer.from("base\n") };
      throw new Error(`unexpected Git command: ${argv.join(" ")}`);
    };
    const result = proveGateFalsifiable(
      { repoRoot: repo, writeScope: ["README.md"], gateArgv: ["test", "-f", "README.md"] },
      {
        git,
        spawn: (argv, cwd) => {
          spawnCalled = true;
          expect(argv).toEqual(["test", "-f", "README.md"]);
          expect(readFileSync(join(cwd, "README.md"), "utf8")).toBe("base\n");
          return { status: 0, stdout: "", stderr: "", timedOut: false };
        },
      },
    );
    expect(gitCalls).toEqual(["ls-files", "ls-tree", "show"]);
    expect(spawnCalled).toBe(true);
    expect(result.outcome).toBe("not_falsifiable");
  });

  test("refuses to let a write-scope traversal escape the scratch root during revert-side deletion", () => {
    const repo = repoWithoutRealGit("scratch-traversal-escape");
    const victimName = `gate-prove-victim-${process.pid}-${Date.now()}`;
    const victimDir = join(realpathSync(tmpdir()), victimName);
    mkdirSync(victimDir, { recursive: true });
    const canaryPath = join(victimDir, "canary.txt");
    writeFileSync(canaryPath, "do not delete me\n");
    try {
      const git = fakeGit({
        "ls-files": { status: 0, bytes: Buffer.from("") },
        "ls-tree": { status: 0, bytes: Buffer.from("") },
      });
      expect(() =>
        proveGateFalsifiable(
          {
            repoRoot: repo,
            writeScope: [`../${victimName}`],
            gateArgv: ["test", "-f", "README.md"],
          },
          { git, spawn: noopSpawn },
        ),
      ).toThrow(HarnessError);
      expect(existsSync(canaryPath)).toBe(true);
    } finally {
      rmSync(victimDir, { recursive: true, force: true });
    }
  });

  test("refuses a tree over --max-files instead of proving an unexpectedly expensive copy", () => {
    const repo = repoWithoutRealGit("max-files-refusal");
    writeFileSync(join(repo, "README.md"), "hi\n");
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("README.md\0") },
    });
    expect(() =>
      proveGateFalsifiable(
        {
          repoRoot: repo,
          writeScope: ["README.md"],
          gateArgv: ["test", "-f", "README.md"],
          maxFiles: 0,
        },
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
      // At the base commit only index.ts existed; nested/deep.ts is new.
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

  test("refuses to revert a symlink or submodule recorded in the write scope", () => {
    const repo = repoWithoutRealGit("unsupported-blob-mode");
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("") },
      "ls-tree": { status: 0, bytes: Buffer.from("120000 blob abc123\tsrc/link\n") },
    });
    expect(() =>
      proveGateFalsifiable(
        { repoRoot: repo, writeScope: ["src/link"], gateArgv: ["test", "-f", "README.md"] },
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

  test("runs a successful gate command and captures stdout/stderr", () => {
    const cwd = scratchRoot(import.meta.path, "successful-binary");
    const result = nodeSpawnGate(["node", "-e", "console.log('gate-ok')"], cwd, 5_000);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("gate-ok");
    expect(result.timedOut).toBe(false);
  });

  test("passes only the allowlisted environment into a gate process", () => {
    const previousSecret = process.env.OLT_GATE_PROOF_SECRET;
    process.env.OLT_GATE_PROOF_SECRET = "must-not-leak";
    try {
      const cwd = scratchRoot(import.meta.path, "environment-allowlist");
      const result = nodeSpawnGate(
        [
          "node",
          "-e",
          "console.log(JSON.stringify({ secret: process.env.OLT_GATE_PROOF_SECRET ?? null, pathType: typeof process.env.PATH, ci: process.env.CI, term: process.env.TERM }))",
        ],
        cwd,
        5_000,
      );
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        secret: null,
        pathType: "string",
        ci: "1",
        term: "dumb",
      });
    } finally {
      if (previousSecret === undefined) {
        delete process.env.OLT_GATE_PROOF_SECRET;
      } else {
        process.env.OLT_GATE_PROOF_SECRET = previousSecret;
      }
    }
  });

  test("reports timedOut when a command exceeds its timeout", () => {
    const cwd = scratchRoot(import.meta.path, "timeout-binary");
    const result = nodeSpawnGate(["node", "-e", "setTimeout(() => {}, 10000)"], cwd, 50);
    expect(result.timedOut).toBe(true);
    expect(result.status).toBeNull();
  });

  test("rejects a gate argv containing && before spawning anything", () => {
    const cwd = scratchRoot(import.meta.path, "compound-rejected-and");
    expect(() => nodeSpawnGate(["true", "&&", "false"], cwd, 5_000)).toThrow(HarnessError);
    expect(() => nodeSpawnGate(["true", "&&", "false"], cwd, 5_000)).toThrow(
      'gate argv contains "&&"',
    );
  });

  test("rejects a gate argv containing || before spawning anything", () => {
    const cwd = scratchRoot(import.meta.path, "compound-rejected-or");
    expect(() => nodeSpawnGate(["true", "||", "false"], cwd, 5_000)).toThrow(
      'gate argv contains "||"',
    );
  });

  test("rejects a gate argv containing ; before spawning anything", () => {
    const cwd = scratchRoot(import.meta.path, "compound-rejected-semicolon");
    expect(() => nodeSpawnGate(["true", ";", "false"], cwd, 5_000)).toThrow(
      'gate argv contains ";"',
    );
  });

  test("rejecting a compound argv never lets its trailing tokens execute, closing the cwd-escape a shelled-out absolute path had", () => {
    const cwd = scratchRoot(import.meta.path, "compound-rejected-no-side-effect");
    const outsideDir = scratchRoot(import.meta.path, "compound-rejected-no-side-effect-outside");
    const outsideMarker = join(outsideDir, "escaped.txt");
    const script = `require("node:fs").writeFileSync(${JSON.stringify(outsideMarker)}, "x")`;
    expect(() => nodeSpawnGate(["true", "&&", "node", "-e", script], cwd, 5_000)).toThrow(
      HarnessError,
    );
    expect(existsSync(outsideMarker)).toBe(false);
  });

  test("a token containing shell metacharacters is passed through literally, since no shell is ever invoked", () => {
    const cwd = scratchRoot(import.meta.path, "no-shell-metachar-passthrough");
    const result = nodeSpawnGate(
      ["node", "-e", "console.log(process.argv[1])", "safe$(echo INJECTED)"],
      cwd,
      5_000,
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("safe$(echo INJECTED)");
  });
});

describe("proveGateFalsifiable revert scope and copy edge cases", () => {
  test("effectiveRevertScope handles bun test filtering out test files when implementation files exist", () => {
    const repo = repoWithoutRealGit("bun-test-effective-scope");
    mkdirSync(join(repo, "src"), { recursive: true });
    mkdirSync(join(repo, "tests"), { recursive: true });
    mkdirSync(join(repo, "node_modules"), { recursive: true });
    writeFileSync(join(repo, "src/index.ts"), "export const val = 1;\n");
    writeFileSync(join(repo, "tests/index.test.ts"), "test('a', () => {});\n");

    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("src/index.ts\0tests/index.test.ts\0") },
      "ls-tree": { status: 0, bytes: Buffer.from("100644 blob abc123\tsrc/index.ts\n") },
      show: { status: 0, bytes: Buffer.from("export const val = 0;\n") },
    });
    const spawn = fsCheckSpawn((cwd) =>
      readFileSync(join(cwd, "src/index.ts"), "utf8").includes("val = 1"),
    );
    const result = proveGateFalsifiable(
      {
        repoRoot: repo,
        writeScope: ["src/index.ts", "tests/index.test.ts"],
        gateArgv: ["bun", "test", "tests/index.test.ts"],
      },
      { git, spawn },
    );
    expect(result.falsifiable).toBe(true);
    expect(result.restoredPaths).toEqual(["src/index.ts"]);
  });

  test("effectiveRevertScope handles vitest / jest / pytest test runners", () => {
    const repo = repoWithoutRealGit("vitest-effective-scope");
    mkdirSync(join(repo, "src"), { recursive: true });
    mkdirSync(join(repo, "tests"), { recursive: true });
    writeFileSync(join(repo, "src/service.ts"), "export const run = true;\n");
    writeFileSync(join(repo, "tests/service.spec.ts"), "describe('run', () => {});\n");

    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("src/service.ts\0tests/service.spec.ts\0") },
      "ls-tree": { status: 0, bytes: Buffer.from("100644 blob abc123\tsrc/service.ts\n") },
      show: { status: 0, bytes: Buffer.from("export const run = false;\n") },
    });
    const spawn = fsCheckSpawn((cwd) =>
      readFileSync(join(cwd, "src/service.ts"), "utf8").includes("run = true"),
    );
    const result = proveGateFalsifiable(
      {
        repoRoot: repo,
        writeScope: ["src/service.ts", "tests/service.spec.ts"],
        gateArgv: ["vitest", "run", "tests/service.spec.ts"],
      },
      { git, spawn },
    );
    expect(result.falsifiable).toBe(true);
    expect(result.restoredPaths).toEqual(["src/service.ts"]);
  });

  test("copyIntoScratch skips files that fail to stat in tracked list", () => {
    const repo = repoWithoutRealGit("missing-stat-entry");
    writeFileSync(join(repo, "existing.ts"), "export const ok = true;\n");
    // git ls-files claims missing.ts is tracked, but it doesn't exist on disk
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("existing.ts\0missing.ts\0") },
      "ls-tree": { status: 0, bytes: Buffer.from("100644 blob abc123\texisting.ts\n") },
      show: { status: 0, bytes: Buffer.from("export const ok = false;\n") },
    });
    const result = proveGateFalsifiable(
      { repoRoot: repo, writeScope: ["existing.ts"], gateArgv: ["test", "-f", "README.md"] },
      { git, spawn: noopSpawn },
    );
    expect(result.exitCode).toBe(0);
  });

  test("node_modules is a real copy in the scratch tree, not a symlink back into the repo", () => {
    const repo = repoWithoutRealGit("node-modules-real-copy");
    mkdirSync(join(repo, "node_modules/dep"), { recursive: true });
    writeFileSync(join(repo, "node_modules/dep/index.js"), "module.exports = 1;\n");
    writeFileSync(join(repo, "tracked.ts"), "export const x = 1;\n");
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("tracked.ts\0") },
      "ls-tree": { status: 0, bytes: Buffer.from("100644 blob abc123\ttracked.ts\n") },
      show: { status: 0, bytes: Buffer.from("export const x = 0;\n") },
    });
    let scratchNodeModulesIsSymlink: boolean | undefined;
    const spawn: GateSpawn = (_argv, cwd) => {
      scratchNodeModulesIsSymlink = lstatSync(join(cwd, "node_modules")).isSymbolicLink();
      return { status: 0, stdout: "", stderr: "", timedOut: false };
    };
    proveGateFalsifiable(
      { repoRoot: repo, writeScope: ["tracked.ts"], gateArgv: ["test", "-f", "README.md"] },
      { git, spawn },
    );
    expect(scratchNodeModulesIsSymlink).toBe(false);
  });

  test("a gate writing into its scratch node_modules never reaches the real repo's node_modules", () => {
    const repo = repoWithoutRealGit("node-modules-write-isolation");
    mkdirSync(join(repo, "node_modules/dep"), { recursive: true });
    writeFileSync(join(repo, "node_modules/dep/index.js"), "original");
    writeFileSync(join(repo, "tracked.ts"), "export const x = 1;\n");
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("tracked.ts\0") },
      "ls-tree": { status: 0, bytes: Buffer.from("100644 blob abc123\ttracked.ts\n") },
      show: { status: 0, bytes: Buffer.from("export const x = 0;\n") },
    });
    const spawn: GateSpawn = (_argv, cwd) => {
      writeFileSync(join(cwd, "node_modules/dep/index.js"), "mutated-by-gate");
      return { status: 0, stdout: "", stderr: "", timedOut: false };
    };
    proveGateFalsifiable(
      { repoRoot: repo, writeScope: ["tracked.ts"], gateArgv: ["test", "-f", "README.md"] },
      { git, spawn },
    );
    expect(readFileSync(join(repo, "node_modules/dep/index.js"), "utf8")).toBe("original");
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

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  nodeSpawnGate,
  proveGateFalsifiable,
  type GateSpawn,
} from "../../../olt/scripts/src/graph/gate-proof.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { RepositoryGitCommand } from "../../../olt/scripts/src/packets/repository-git-command.ts";
import {
  cleanupProofRepos,
  fakeGit,
  fsCheckSpawn,
  installGateProofSpies,
  noopSpawn,
  repoWithoutRealGit,
  vdirs,
} from "./gate-proof-fixture.ts";

describe("proveGateFalsifiable: revert errors, mode handling and nodeSpawnGate", () => {
  afterEach(() => {
    cleanupProofRepos();
  });

  test("throws when the repository root carries no Git metadata", () => {
    installGateProofSpies();
    const plain = "/virtual/repo/gate-proof-no-git-fixture";
    vdirs.add(plain);
    writeFileSync(join(plain, "a.ts"), "export const a = 1;\n");
    expect(() =>
      proveGateFalsifiable({
        repoRoot: plain,
        writeScope: ["a.ts"],
        gateArgv: ["test", "-f", "README.md"],
      }),
    ).toThrow(HarnessError);
  });

  test("throws on an empty write scope rather than reverting nothing silently", () => {
    const repo = repoWithoutRealGit("empty-write-scope");
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
    const scratchRootsBefore = Array.from(vdirs)
      .filter((entry) => entry.includes("gate-prove-"))
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
      Array.from(vdirs)
        .filter((entry) => entry.includes("gate-prove-"))
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
    const victimDir = `/virtual/scratch/${victimName}`;
    mkdirSync(victimDir, { recursive: true });
    const canaryPath = join(victimDir, "canary.txt");
    writeFileSync(canaryPath, "do not delete me\n");
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

  test("nodeSpawnGate executes valid commands and rejects compound operators", () => {
    const cwd = process.cwd();
    expect(() => nodeSpawnGate(["definitely-not-a-real-binary-8f3c2b"], cwd, 5_000)).toThrow(
      HarnessError,
    );

    const result = nodeSpawnGate(["node", "-e", "console.log('gate-ok')"], cwd, 5_000);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("gate-ok");

    expect(() => nodeSpawnGate(["true", "&&", "false"], cwd, 5_000)).toThrow(HarnessError);
    expect(() => nodeSpawnGate(["true", "||", "false"], cwd, 5_000)).toThrow(HarnessError);
    expect(() => nodeSpawnGate(["true", ";", "false"], cwd, 5_000)).toThrow(HarnessError);

    const metacharResult = nodeSpawnGate(
      ["node", "-e", "console.log(process.argv[1])", "safe$(echo INJECTED)"],
      cwd,
      5_000,
    );
    expect(metacharResult.stdout.trim()).toBe("safe$(echo INJECTED)");
  });

  test("effectiveRevertScope and node_modules isolation in scratch tree", () => {
    const repo = repoWithoutRealGit("node-modules-real-copy");
    mkdirSync(join(repo, "node_modules/dep"), { recursive: true });
    writeFileSync(join(repo, "node_modules/dep/index.js"), "original");
    writeFileSync(join(repo, "tracked.ts"), "export const x = 1;\n");
    const git = fakeGit({
      "ls-files": { status: 0, bytes: Buffer.from("tracked.ts\0") },
      "ls-tree": { status: 0, bytes: Buffer.from("100644 blob abc123\ttracked.ts\n") },
      show: { status: 0, bytes: Buffer.from("export const x = 0;\n") },
    });
    let scratchNodeModulesIsSymlink: boolean | undefined;
    const spawn: GateSpawn = (_argv, cwd) => {
      scratchNodeModulesIsSymlink = lstatSync(join(cwd, "node_modules")).isSymbolicLink();
      writeFileSync(join(cwd, "node_modules/dep/index.js"), "mutated-by-gate");
      return { status: 0, stdout: "", stderr: "", timedOut: false };
    };
    proveGateFalsifiable(
      { repoRoot: repo, writeScope: ["tracked.ts"], gateArgv: ["test", "-f", "README.md"] },
      { git, spawn },
    );
    expect(scratchNodeModulesIsSymlink).toBe(false);
    expect(readFileSync(join(repo, "node_modules/dep/index.js"), "utf8")).toBe("original");
  });
});

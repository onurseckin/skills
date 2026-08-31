import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureHarnessIgnored } from "../../../olt/scripts/src/cli/git-ignore.ts";
import { ignoredByGit } from "../../../olt/scripts/src/reporting/doctor.ts";
import { createRepositoryGitCommand } from "../../../olt/scripts/src/packets/repository-git-command.ts";

const roots: string[] = [];
const prefix = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "diff.external=",
  "-c",
  "pager.diff=false",
  "--no-pager",
];
const environment = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  PAGER: "cat",
  LANG: "C",
  PATH: "/usr/bin:/bin",
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("restricted repository Git callers", () => {
  test("routes init and doctor checks through exact restricted argv and environment", () => {
    const repo = mkdtempSync(join(tmpdir(), "restricted-git-callers-"));
    roots.push(repo);
    mkdirSync(join(repo, ".git"));
    const runRoot = join(repo, ".olt", "capsules", "run");
    mkdirSync(runRoot, { recursive: true });
    const calls: Array<{ argv: string[]; options: unknown }> = [];
    const command = createRepositoryGitCommand(
      {
        ...environment,
        GIT_DIR: "/poison",
        GIT_WORK_TREE: "/poison",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.fsmonitor",
        GIT_CONFIG_VALUE_0: "/poison/helper",
      },
      (_executable, argv, options) => {
        calls.push({ argv, options });
        return {
          status: 0,
          stdout: Buffer.from(argv.includes("--is-inside-work-tree") ? "true\n" : ""),
          stderr: Buffer.alloc(0),
        };
      },
    );

    expect(ensureHarnessIgnored(repo, command)).toBe("gitignored");
    expect(ignoredByGit(runRoot, command)).toBeTrue();
    expect(calls.map(({ argv }) => argv)).toEqual([
      [...prefix, "-C", repo, "rev-parse", "--is-inside-work-tree"],
      [...prefix, "-C", repo, "check-ignore", "--quiet", ".olt/capsules/probe"],
      [...prefix, "-C", repo, "check-ignore", "--quiet", runRoot],
    ]);
    for (const call of calls)
      expect(call.options).toEqual({
        encoding: "buffer",
        env: environment,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 1025,
        timeout: 15_000,
        killSignal: "SIGKILL",
      });
  });

  test("ensureHarnessIgnored throws when .capsules is not gitignored", () => {
    const repo = mkdtempSync(join(tmpdir(), "restricted-git-callers-not-ignored-"));
    roots.push(repo);
    mkdirSync(join(repo, ".git"));
    const command = createRepositoryGitCommand(environment, (_executable, argv) => ({
      status: argv.includes("check-ignore") ? 1 : 0,
      stdout: Buffer.from(argv.includes("--is-inside-work-tree") ? "true\n" : ""),
      stderr: Buffer.alloc(0),
    }));

    expect(() => ensureHarnessIgnored(repo, command)).toThrow(
      /must be gitignored before initializing a run/,
    );
  });

  test("contains no direct production Git spawn outside the shared seam", () => {
    const scriptsRoot = join(import.meta.dir, "..", "..", "..", "olt", "scripts");
    for (const path of [
      join(scriptsRoot, "src", "cli", "git-ignore.ts"),
      join(scriptsRoot, "src", "reporting", "doctor", "facts.ts"),
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/spawnSync[\s\S]{0,200}["']git["']/u);
      expect(source).toContain("RepositoryGitCommand");
    }
  });
});

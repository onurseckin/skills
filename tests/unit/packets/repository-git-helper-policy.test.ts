import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepositoryGitCommand } from "../../../orchestrating-long-tasks/scripts/src/packets/repository-git-command.ts";
import { inspectRepositoryGitIdentity } from "../../../orchestrating-long-tasks/scripts/src/packets/repository-git-identity.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): { repo: string; gitDir: string } {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "git-helper-policy-")));
  roots.push(repo);
  const gitDir = join(repo, ".git");
  mkdirSync(join(gitDir, "info"), { recursive: true });
  writeFileSync(join(gitDir, "config"), "[core]\n\trepositoryformatversion = 0\n");
  return { repo, gitDir };
}

function commandFor(
  gitDir: string,
  helperRecords: Buffer,
  observed: string[][],
  stagedIndex = Buffer.alloc(0),
): RepositoryGitCommand {
  return (_repo, argv, _maximum, accepted = [0]) => {
    observed.push([...argv]);
    let status = 0;
    let bytes = Buffer.alloc(0);
    if (argv[0] === "rev-parse" && argv[1] === "--is-inside-work-tree")
      bytes = Buffer.from("true\n");
    else if (argv.includes("--absolute-git-dir")) bytes = Buffer.from(`${gitDir}\n`);
    else if (argv.includes("--git-common-dir")) bytes = Buffer.from(`${gitDir}\n`);
    else if (argv.includes("--git-path")) bytes = Buffer.from(".git/config.worktree\n");
    else if (argv[0] === "ls-files") bytes = stagedIndex;
    else if (argv[0] === "config" && argv.at(-1)?.includes("textconv")) {
      status = helperRecords.byteLength === 0 ? 1 : 0;
      bytes = helperRecords;
    } else if (argv[0] === "config") status = 1;
    else if (argv[0] === "rev-parse" || argv[0] === "symbolic-ref") status = 1;
    if (!accepted.includes(status)) throw new Error(`unexpected status ${status}: ${argv}`);
    return { status, bytes };
  };
}

function helperRecord(key: string, value: string): Buffer {
  return Buffer.from(`${key}\n${value}\0`);
}

describe("repository-local Git helper policy", () => {
  for (const [name, record] of [
    ["external diff", helperRecord("diff.external", "/tmp/evil-diff")],
    ["text conversion", helperRecord("diff.binary.textconv", "/tmp/evil-textconv")],
    ["pathname fsmonitor", helperRecord("core.fsmonitor", "hooks/evil-fsmonitor")],
    ["executable fsmonitor", helperRecord("core.fsmonitor", "true")],
    ["clean conversion filter", helperRecord("filter.evil.clean", "/tmp/evil-clean")],
    ["smudge conversion filter", helperRecord("filter.evil.smudge", "/tmp/evil-smudge")],
    ["process conversion filter", helperRecord("filter.evil.process", "/tmp/evil-process")],
  ] as const) {
    test(`rejects ${name} before porcelain status`, () => {
      const { repo, gitDir } = fixture();
      const observed: string[][] = [];
      expect(() =>
        inspectRepositoryGitIdentity(repo, 4096, 4096, 8192, {
          command: commandFor(gitDir, record, observed),
        }),
      ).toThrow("local Git helper configuration is unsupported");
      expect(observed.some(([operation]) => operation === "status")).toBeFalse();
      expect(observed.find((argv) => argv.includes("--null"))?.at(-1)).toContain("filter\\.");
    });
  }

  test("permits an explicitly disabled local fsmonitor and reaches status", () => {
    const { repo, gitDir } = fixture();
    const observed: string[][] = [];
    const identity = inspectRepositoryGitIdentity(repo, 4096, 4096, 8192, {
      command: commandFor(gitDir, helperRecord("core.fsmonitor", "false"), observed),
    });
    expect(identity.available).toBeTrue();
    expect(observed.some(([operation]) => operation === "status")).toBeTrue();
  });

  test("rejects an indexed gitlink before porcelain status can inspect its worktree", () => {
    const { repo, gitDir } = fixture();
    const observed: string[][] = [];
    const index = Buffer.from(`160000 ${"a".repeat(40)} 0\tvendor/module\0`);
    expect(() =>
      inspectRepositoryGitIdentity(repo, 4096, 4096, 8192, {
        command: commandFor(gitDir, Buffer.alloc(0), observed, index),
      }),
    ).toThrow("repository gitlink/submodule nodes are unsupported: vendor/module");
    expect(observed.some(([operation]) => operation === "status")).toBeFalse();
  });
});

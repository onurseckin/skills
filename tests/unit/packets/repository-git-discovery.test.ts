import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import {
  createRepositoryGitCommand,
  type RepositoryGitCommand,
} from "../../../orchestrating-long-tasks/scripts/src/packets/repository-git-command.ts";
import { inspectRepositoryGitIdentity } from "../../../orchestrating-long-tasks/scripts/src/packets/repository-git-identity.ts";
import { inspectRepositoryBinding } from "../../../orchestrating-long-tasks/scripts/src/packets/repository-identity.ts";
import { inspectRepository } from "../../../orchestrating-long-tasks/scripts/src/packets/repository-snapshot.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(repo: string, args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", repo, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Harness Test",
      GIT_AUTHOR_EMAIL: "harness@example.invalid",
      GIT_COMMITTER_NAME: "Harness Test",
      GIT_COMMITTER_EMAIL: "harness@example.invalid",
    },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function fixture(name = "repo"): { root: string; repo: string } {
  const root = mkdtempSync(join(tmpdir(), "repository-git-discovery-"));
  const repo = join(root, name);
  roots.push(root);
  mkdirSync(repo);
  git(repo, ["init", "-q"]);
  writeFileSync(join(repo, "tracked.txt"), "tracked\n");
  git(repo, ["add", "tracked.txt"]);
  git(repo, ["commit", "-qm", "test: seed"]);
  return { root, repo: realpathSync(repo) };
}

function withGitPoison(values: Record<string, string>, action: () => void): void {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    action();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function expectIntegrity(action: () => unknown, message: string): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(HarnessError);
  expect((caught as HarnessError).code).toBe("INTEGRITY");
  expect((caught as HarnessError).message).toContain(message);
}

describe("repository Git discovery", () => {
  test("ignores ambient repository and config injection variables", () => {
    const { repo } = fixture("target");
    const { repo: poison } = fixture("poison");
    writeFileSync(join(poison, "poison-only.txt"), "poison\n");
    git(poison, ["add", "poison-only.txt"]);
    git(poison, ["commit", "-qm", "test: poison identity"]);
    const expected = inspectRepositoryGitIdentity(repo);
    withGitPoison(
      {
        GIT_DIR: join(poison, ".git"),
        GIT_WORK_TREE: poison,
        GIT_INDEX_FILE: join(poison, ".git", "index"),
        GIT_COMMON_DIR: join(poison, ".git"),
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.attributesFile",
        GIT_CONFIG_VALUE_0: join(poison, "attributes"),
        GIT_CONFIG_PARAMETERS: "'core.whitespace=blank-at-eol'",
      },
      () => expect(inspectRepositoryGitIdentity(repo)).toEqual(expected),
    );
  });

  test("raises integrity when Git is missing from the sanitized PATH", () => {
    const { root, repo } = fixture();
    const emptyPath = join(root, "empty-path");
    mkdirSync(emptyPath);
    expectIntegrity(
      () =>
        inspectRepositoryGitIdentity(repo, undefined, undefined, undefined, {
          environment: { ...process.env, PATH: emptyPath },
        }),
      "repository Git command failed",
    );
  });

  test("binds an actual directory without Git metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "repository-no-git-"));
    roots.push(root);
    writeFileSync(join(root, "tracked.txt"), "directory bytes\n");
    let binding: ReturnType<typeof inspectRepositoryBinding> | undefined;
    withGitPoison({ PATH: "" }, () => {
      binding = inspectRepositoryBinding(root);
    });
    expect(binding!.file_count).toBe(1);
    expect(binding!.git_identity_sha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("raises integrity when Git is missing and metadata is present", () => {
    const { root, repo } = fixture();
    const emptyPath = join(root, "empty-binding-path");
    mkdirSync(emptyPath);
    withGitPoison({ PATH: emptyPath }, () =>
      expectIntegrity(() => inspectRepositoryBinding(repo), "repository Git command failed"),
    );
  });

  test("raises integrity for corrupt repository metadata during binding", () => {
    const { repo } = fixture();
    writeFileSync(join(repo, ".git", "config"), "[broken\n");
    expectIntegrity(() => inspectRepositoryBinding(repo), "repository Git command failed");
  });

  test("distinguishes positive non-worktree from an injected probe failure", () => {
    const { repo } = fixture();
    const nonWorktree = inspectRepositoryGitIdentity(repo, undefined, undefined, undefined, {
      command: () => ({ status: 0, bytes: Buffer.from("false\n") }),
    });
    expect(nonWorktree).toEqual({ available: false });
    expectIntegrity(
      () =>
        inspectRepositoryGitIdentity(repo, undefined, undefined, undefined, {
          command: () => {
            throw new HarnessError("INTEGRITY", "injected probe failure");
          },
        }),
      "injected probe failure",
    );
  });

  test("keeps repository inspection stable under ambient Git poisoning", () => {
    const { repo } = fixture("inspection-target");
    const { repo: poison } = fixture("inspection-poison");
    git(poison, ["commit", "--allow-empty", "-qm", "test: move poison head"]);
    const at = new Date("2026-08-14T00:00:00.000Z");
    const expected = inspectRepository(repo, "current", at);
    const observed: string[][] = [];
    const sanitized = createRepositoryGitCommand({ ...process.env, GIT_DIR: join(poison, ".git") });
    const command: RepositoryGitCommand = (...input) => {
      observed.push(input[1]);
      return sanitized(...input);
    };
    withGitPoison(
      {
        GIT_DIR: join(poison, ".git"),
        GIT_WORK_TREE: poison,
        GIT_INDEX_FILE: join(poison, ".git", "index"),
        GIT_COMMON_DIR: join(poison, ".git"),
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.whitespace",
        GIT_CONFIG_VALUE_0: "blank-at-eol",
        GIT_CONFIG_PARAMETERS: "'core.attributesFile=/invalid/ambient/path'",
      },
      () => expect(inspectRepository(repo, "current", at, { command })).toEqual(expected),
    );
    expect(observed.map(([operation]) => operation)).toEqual([
      "status",
      "rev-parse",
      "branch",
      "log",
      "--version",
    ]);
  });
});

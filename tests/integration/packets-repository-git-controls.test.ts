import { afterEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { inspectRepositoryBinding } from "../../orchestrating-long-tasks/scripts/src/packets/repository-identity.ts";

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

function fixture(): { root: string; repo: string } {
  const root = mkdtempSync(join(tmpdir(), "repository-git-controls-"));
  const repo = join(root, "repo");
  roots.push(root);
  mkdirSync(repo);
  git(repo, ["init", "-q"]);
  writeFileSync(join(repo, "tracked.txt"), "tracked\n");
  git(repo, ["add", "tracked.txt"]);
  git(repo, ["commit", "-qm", "test: seed"]);
  return { root, repo };
}

function expectIdentityChange(repo: string, mutate: () => void): void {
  const before = inspectRepositoryBinding(repo);
  mutate();
  const after = inspectRepositoryBinding(repo);
  expect(after.git_identity_sha256).not.toBe(before.git_identity_sha256);
  expect(after.inspection_sha256).not.toBe(before.inspection_sha256);
}

describe("repository-local Git-control identity", () => {
  test("versions bindings and observes config, attributes, and excludes", () => {
    const { repo } = fixture();
    const initial = inspectRepositoryBinding(repo);
    expect(initial.schema).toBe("harness.repository-binding");
    expect(initial.version).toBe(1);
    expect(initial.git_identity_sha256).toMatch(/^[0-9a-f]{64}$/u);

    expectIdentityChange(repo, () =>
      appendFileSync(join(repo, ".git", "config"), "[harness]\n\tmarker = config\n"),
    );
    expectIdentityChange(repo, () => {
      mkdirSync(join(repo, ".git", "info"), { recursive: true });
      writeFileSync(join(repo, ".git", "info", "attributes"), "*.ts whitespace=-trailing-space\n");
    });
    expectIdentityChange(repo, () =>
      writeFileSync(join(repo, ".git", "info", "exclude"), "generated/\n"),
    );
  });

  test("observes linked-worktree Git-file and common-directory linkage", () => {
    const { root, repo } = fixture();
    const linked = join(root, "linked");
    git(repo, ["worktree", "add", "-q", "-b", "linked-test", linked]);
    const gitFile = join(linked, ".git");
    const gitDirectory = readFileSync(gitFile, "utf8")
      .trim()
      .replace(/^gitdir: /u, "");

    expectIdentityChange(linked, () => {
      const relativeGitDirectory = relative(realpathSync(linked), gitDirectory);
      writeFileSync(gitFile, `gitdir: ${relativeGitDirectory}\n`);
    });
    expectIdentityChange(linked, () => {
      const commonFile = join(gitDirectory, "commondir");
      const commonDirectory = resolve(gitDirectory, readFileSync(commonFile, "utf8").trim());
      writeFileSync(commonFile, `${commonDirectory}\n`);
    });
  });

  test("observes per-worktree core.whitespace configuration", () => {
    const { root, repo } = fixture();
    const linked = join(root, "configured-linked");
    git(repo, ["config", "extensions.worktreeConfig", "true"]);
    git(repo, ["worktree", "add", "-q", "-b", "configured-linked-test", linked]);
    git(linked, ["config", "--worktree", "core.whitespace", "blank-at-eol"]);

    expectIdentityChange(linked, () =>
      git(linked, ["config", "--worktree", "core.whitespace", "space-before-tab"]),
    );
  });

  test("rejects local include and includeIf indirection", () => {
    for (const section of ["include", 'includeIf "gitdir:**"']) {
      const { root, repo } = fixture();
      const included = join(root, `included-${roots.length}.config`);
      writeFileSync(included, "[core]\n\twhitespace = blank-at-eol\n");
      appendFileSync(join(repo, ".git", "config"), `[${section}]\n\tpath = ${included}\n`);
      expect(() => inspectRepositoryBinding(repo)).toThrow("Git config indirection");
    }
  });

  test("rejects core.attributesFile inside the Git directory", () => {
    const { repo } = fixture();
    const attributes = join(repo, ".git", "gate-attributes");
    writeFileSync(attributes, "*.ts whitespace=-trailing-space\n");
    git(repo, ["config", "--local", "core.attributesFile", attributes]);
    expect(() => inspectRepositoryBinding(repo)).toThrow("Git config indirection");
  });

  test("rejects a symbolic local Git-control file without following it", () => {
    const { root, repo } = fixture();
    const exclude = join(repo, ".git", "info", "exclude");
    const external = join(root, "external-exclude");
    rmSync(exclude);
    writeFileSync(external, "outside\n");
    symlinkSync(external, exclude);
    expect(() => inspectRepositoryBinding(repo)).toThrow("symbolic");
  });

  test("validates shared byte limits before scanning Git controls", () => {
    const { repo } = fixture();
    expect(() => inspectRepositoryBinding(repo, { maxFileBytes: 0 })).toThrow(
      "maxFileBytes must be a positive integer",
    );
    expect(() => inspectRepositoryBinding(repo, { maxTotalBytes: 0 })).toThrow(
      "maxTotalBytes must be a positive integer",
    );
  });
});

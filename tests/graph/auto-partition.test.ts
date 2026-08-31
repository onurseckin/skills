import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  enumerateGlobMatches,
  globToRegExp,
  partitionByGlob,
  slugifyScope,
} from "../../olt/scripts/src/graph/auto-partition.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("globToRegExp", () => {
  test("a single * never crosses a path separator", () => {
    const pattern = globToRegExp("src/*.ts");
    expect(pattern.test("src/a.ts")).toBe(true);
    expect(pattern.test("src/sub/a.ts")).toBe(false);
  });

  test("** matches zero directories, so src/**/*.ts also matches a direct child", () => {
    const pattern = globToRegExp("src/**/*.ts");
    expect(pattern.test("src/a.ts")).toBe(true);
    expect(pattern.test("src/sub/a.ts")).toBe(true);
    expect(pattern.test("src/sub/deep/a.ts")).toBe(true);
    expect(pattern.test("other/a.ts")).toBe(false);
  });

  test("a trailing ** still requires at least a final path component", () => {
    const pattern = globToRegExp("docs/**");
    expect(pattern.test("docs/readme.md")).toBe(true);
    expect(pattern.test("docs/a/b/c.md")).toBe(true);
    expect(pattern.test("other/readme.md")).toBe(false);
  });
});

async function fixtureRepo(name: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), `harness-auto-partition-${name}-`));
  roots.push(repo);
  return repo;
}

describe("enumerateGlobMatches", () => {
  test("enumerates what is really on disk, sorted, never a guessed path", async () => {
    const repo = await fixtureRepo("enumerate");
    await mkdir(join(repo, "src/curriculum/mlQuestions"), { recursive: true });
    await writeFile(join(repo, "src/curriculum/mlQuestions/linearAlgebra.ts"), "export {};\n");
    await writeFile(join(repo, "src/curriculum/mlQuestions/calculus.ts"), "export {};\n");
    await writeFile(join(repo, "src/curriculum/mlQuestions/notes.md"), "# notes\n");

    const matches = enumerateGlobMatches(repo, "src/curriculum/mlQuestions/*.ts");
    expect(matches).toEqual([
      "src/curriculum/mlQuestions/calculus.ts",
      "src/curriculum/mlQuestions/linearAlgebra.ts",
    ]);
  });

  test("skips node_modules, .git and .capsules", async () => {
    const repo = await fixtureRepo("excluded");
    await mkdir(join(repo, "node_modules/pkg"), { recursive: true });
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(join(repo, ".olt/capsules/run-1"), { recursive: true });
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(join(repo, "node_modules/pkg/index.ts"), "export {};\n");
    await writeFile(join(repo, ".git/index.ts"), "export {};\n");
    await writeFile(join(repo, ".olt/capsules/run-1/index.ts"), "export {};\n");
    await writeFile(join(repo, "src/index.ts"), "export {};\n");

    expect(enumerateGlobMatches(repo, "**/*.ts")).toEqual(["src/index.ts"]);
  });

  test("never follows a symlink", async () => {
    const repo = await fixtureRepo("symlink");
    const outside = await mkdtemp(join(tmpdir(), "harness-auto-partition-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "secret.ts"), "export {};\n");
    await mkdir(join(repo, "src"), { recursive: true });
    await symlink(outside, join(repo, "src/linked"), "dir");

    expect(enumerateGlobMatches(repo, "**/*.ts")).toEqual([]);
  });

  test("an unreadable subdirectory is skipped rather than crashing the walk", async () => {
    const repo = await fixtureRepo("locked");
    await mkdir(join(repo, "src/locked"), { recursive: true });
    await writeFile(join(repo, "src/allowed.ts"), "export {};\n");
    await writeFile(join(repo, "src/locked/hidden.ts"), "export {};\n");
    chmodSync(join(repo, "src/locked"), 0o000);
    try {
      expect(enumerateGlobMatches(repo, "**/*.ts")).toEqual(["src/allowed.ts"]);
    } finally {
      chmodSync(join(repo, "src/locked"), 0o755);
    }
  });
});

describe("partitionByGlob", () => {
  test("one entry per matched file by default", async () => {
    const repo = await fixtureRepo("per-file");
    await mkdir(join(repo, "src/domains"), { recursive: true });
    await writeFile(join(repo, "src/domains/a.ts"), "export {};\n");
    await writeFile(join(repo, "src/domains/b.ts"), "export {};\n");

    const entries = partitionByGlob(repo, "src/domains/*.ts", "file");
    expect(entries).toEqual([
      { scope: "src/domains/a.ts", files: ["src/domains/a.ts"] },
      { scope: "src/domains/b.ts", files: ["src/domains/b.ts"] },
    ]);
  });

  test("one entry per directory when grouped", async () => {
    const repo = await fixtureRepo("per-directory");
    await mkdir(join(repo, "src/domains/alpha"), { recursive: true });
    await mkdir(join(repo, "src/domains/beta"), { recursive: true });
    await writeFile(join(repo, "src/domains/alpha/one.ts"), "export {};\n");
    await writeFile(join(repo, "src/domains/alpha/two.ts"), "export {};\n");
    await writeFile(join(repo, "src/domains/beta/one.ts"), "export {};\n");

    const entries = partitionByGlob(repo, "src/domains/**/*.ts", "directory");
    expect(entries).toEqual([
      {
        scope: "src/domains/alpha",
        files: ["src/domains/alpha/one.ts", "src/domains/alpha/two.ts"],
      },
      { scope: "src/domains/beta", files: ["src/domains/beta/one.ts"] },
    ]);
  });

  test("refuses a glob that matches nothing on disk rather than emitting zero tasks silently", async () => {
    const repo = await fixtureRepo("empty");
    expect(() => partitionByGlob(repo, "src/nowhere/*.ts", "file")).toThrow(
      "matched no files under",
    );
  });
});

describe("slugifyScope", () => {
  test("replaces non-alphanumeric runs with a single hyphen and trims the ends", () => {
    expect(slugifyScope("src/domains/linear-algebra.ts")).toBe("src-domains-linear-algebra-ts");
  });

  test("refuses a scope with no alphanumeric characters rather than emitting a blank task id", () => {
    expect(() => slugifyScope("...")).toThrow("has no usable characters for a task id");
    expect(() => slugifyScope("///")).toThrow("has no usable characters for a task id");
  });
});

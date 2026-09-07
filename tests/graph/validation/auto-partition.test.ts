import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  enumerateGlobMatches,
  globToRegExp,
  partitionByGlob,
  slugifyScope,
} from "../../../olt/scripts/src/graph/auto-partition.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

let currentSession: VirtualFSSession | null = null;
let currentVfs: VirtualMemoryFS = new VirtualMemoryFS();
let repoCounter = 0;

beforeEach(() => {
  currentVfs = new VirtualMemoryFS();
  currentSession = createVirtualFSSession(currentVfs);
});

afterEach(() => {
  if (currentSession) {
    currentSession.cleanup();
    currentSession = null;
  }
  currentVfs = new VirtualMemoryFS();
});

async function fixtureRepo(name: string): Promise<string> {
  repoCounter += 1;
  const repo = `/virtual/auto-partition-${name}-${repoCounter}`;
  currentVfs.mkdirSync(repo, { recursive: true });
  return repo;
}

const mkdir = async (p: string, _opt?: unknown) => {
  currentVfs.mkdirSync(p, { recursive: true });
};

const writeFile = async (p: string, data = "export {};\n") => {
  currentVfs.writeFileSync(p, data);
};

const symlink = async (target: string, path: string) => {
  currentSession?.symlinkSync(target, path);
};

const chmodSync = (p: string, mode: number) => {
  currentSession?.chmodSync(p, mode);
};

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
    const outside = await fixtureRepo("outside");
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

  test("strictly ignores circular symlinks and avoids infinite recursion", async () => {
    const repo = await fixtureRepo("circular-symlink");
    await mkdir(join(repo, "src/nested"), { recursive: true });
    await writeFile(join(repo, "src/nested/valid.ts"), "export {};\n");
    await symlink(join(repo, "src"), join(repo, "src/nested/loop"), "dir");

    const matches = enumerateGlobMatches(repo, "**/*.ts");
    expect(matches).toEqual(["src/nested/valid.ts"]);
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

  test("correctly matches and slugifies paths with spaces and special characters", async () => {
    const repo = await fixtureRepo("special-chars");
    await mkdir(join(repo, "src/domains"), { recursive: true });
    await writeFile(join(repo, "src/domains/my task [spec].ts"), "export {};\n");

    const entries = partitionByGlob(repo, "src/domains/*.ts", "file");
    expect(entries).toEqual([
      {
        scope: "src/domains/my task [spec].ts",
        files: ["src/domains/my task [spec].ts"],
      },
    ]);

    const slug = slugifyScope(entries[0].scope);
    expect(slug).toBe("src-domains-my-task-spec-ts");
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

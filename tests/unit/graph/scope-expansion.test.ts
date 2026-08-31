import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expandScopeEntry,
  expandWriteScope,
} from "../../../olt/scripts/src/graph/scope-expansion.ts";

const roots: string[] = [];
function fixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "scope-expansion-fixture-"));
  roots.push(root);
  return root;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("expandScopeEntry", () => {
  test("a directory expands to every file beneath it", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src/db"), { recursive: true });
    writeFileSync(join(repo, "src/db/index.ts"), "");
    writeFileSync(join(repo, "src/db/schema.ts"), "");
    expect(expandScopeEntry(repo, "src/db")).toEqual(["src/db/index.ts", "src/db/schema.ts"]);
  });

  test("nested directories are walked recursively", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src/db/migrations"), { recursive: true });
    writeFileSync(join(repo, "src/db/index.ts"), "");
    writeFileSync(join(repo, "src/db/migrations/001.ts"), "");
    expect(expandScopeEntry(repo, "src/db").sort()).toEqual([
      "src/db/index.ts",
      "src/db/migrations/001.ts",
    ]);
  });

  test("VCS and build noise are skipped inside the walk", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src/lib/node_modules"), { recursive: true });
    mkdirSync(join(repo, "src/lib/.git"), { recursive: true });
    writeFileSync(join(repo, "src/lib/index.ts"), "");
    writeFileSync(join(repo, "src/lib/node_modules/pkg.js"), "");
    writeFileSync(join(repo, "src/lib/.git/HEAD"), "");
    expect(expandScopeEntry(repo, "src/lib")).toEqual(["src/lib/index.ts"]);
  });

  test("a file counts as itself", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src/single.ts"), "");
    expect(expandScopeEntry(repo, "src/single.ts")).toEqual(["src/single.ts"]);
  });

  test("a path that does not exist yet cannot be expanded past its own token", () => {
    const repo = fixtureRepo();
    expect(expandScopeEntry(repo, "src/not-created-yet")).toEqual(["src/not-created-yet"]);
  });

  test("an empty directory counts as its own declared path, not zero files", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src/empty"), { recursive: true });
    expect(expandScopeEntry(repo, "src/empty")).toEqual(["src/empty"]);
  });

  test("an unreadable nested directory is skipped rather than crashing the walk", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src/db/locked"), { recursive: true });
    writeFileSync(join(repo, "src/db/index.ts"), "");
    writeFileSync(join(repo, "src/db/locked/hidden.ts"), "");
    chmodSync(join(repo, "src/db/locked"), 0o000);
    try {
      expect(expandScopeEntry(repo, "src/db")).toEqual(["src/db/index.ts"]);
    } finally {
      chmodSync(join(repo, "src/db/locked"), 0o755);
    }
  });

  test("root-like entries are never walked", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src/anything.ts"), "");
    expect(expandScopeEntry(repo, ".")).toEqual(["."]);
    expect(expandScopeEntry(repo, "/")).toEqual(["/"]);
    expect(expandScopeEntry(repo, "**")).toEqual(["**"]);
  });
});

describe("expandWriteScope", () => {
  test("deduplicates and sorts across every scope entry", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src/a"), { recursive: true });
    mkdirSync(join(repo, "src/b"), { recursive: true });
    writeFileSync(join(repo, "src/a/one.ts"), "");
    writeFileSync(join(repo, "src/b/two.ts"), "");
    expect(expandWriteScope(repo, ["src/a", "src/b", "src/a"])).toEqual([
      "src/a/one.ts",
      "src/b/two.ts",
    ]);
  });

  test("an empty write scope expands to no files", () => {
    const repo = fixtureRepo();
    expect(expandWriteScope(repo, [])).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  collectBoundedDirectoryEntries,
  type SyncDirectoryReader,
} from "../../../olt/scripts/src/core/bounded-directory.ts";
import {
  deriveGateConcurrencyCeiling,
  discoverHostConcurrencyCeiling,
} from "../../../olt/scripts/src/core/config/host-concurrency.ts";
import {
  isGitArgv,
  isRestrictedGitDiffArgv,
  RESTRICTED_GIT_ARGUMENTS,
  RESTRICTED_GIT_ENVIRONMENT,
  restrictedGitDiffArgv,
  restrictedRepositoryGitArgv,
} from "../../../olt/scripts/src/core/restricted-git.ts";
import { includeRuntimeSourceEntry } from "../../../olt/scripts/src/core/runtime-filter.ts";
import {
  copyPinnedRuntime,
  runtimeTreeSnapshot,
} from "../../../olt/scripts/src/core/runtime-tree.ts";

describe("core runtime utilities: bounded directory, git, filter, concurrency, runtime-tree", () => {
  const scratchBase = join(process.cwd(), "coverage", "scratch", "core-runtime-tests");

  test("collectBoundedDirectoryEntries collects sorted entries within limit and closes directory", () => {
    let closed = false;
    const items = ["banana", "apple", "cherry"];
    let idx = 0;

    const mockReader: SyncDirectoryReader<string> = {
      readSync: () => items[idx++] ?? null,
      closeSync: () => {
        closed = true;
      },
    };

    const result = collectBoundedDirectoryEntries(
      mockReader,
      5,
      () => new Error("limit exceeded"),
      (a, b) => a.localeCompare(b),
    );

    expect(result).toEqual(["apple", "banana", "cherry"]);
    expect(closed).toBe(true);

    // Limit exceeded case
    idx = 0;
    closed = false;
    expect(() =>
      collectBoundedDirectoryEntries(
        mockReader,
        2,
        () => new Error("limit exceeded"),
        (a, b) => a.localeCompare(b),
      ),
    ).toThrow(/limit exceeded/i);
    expect(closed).toBe(true);
  });

  test("restricted git commands and argument builders", () => {
    expect(RESTRICTED_GIT_ENVIRONMENT.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(RESTRICTED_GIT_ARGUMENTS).toContain("--no-pager");

    const repoArgv = restrictedRepositoryGitArgv("/repo/root", ["status", "--short"]);
    expect(repoArgv).toContain("-C");
    expect(repoArgv).toContain("/repo/root");
    expect(repoArgv).toContain("status");

    expect(isGitArgv(["git", "status"])).toBe(true);
    expect(isGitArgv(["/usr/bin/git", "status"])).toBe(true);
    expect(isGitArgv(["git.exe", "status"])).toBe(true);
    expect(isGitArgv(["bun", "test"])).toBe(false);

    expect(isRestrictedGitDiffArgv(["git", "diff", "--check"])).toBe(true);
    expect(isRestrictedGitDiffArgv(["git", "diff", "--cached", "--check"])).toBe(true);
    expect(isRestrictedGitDiffArgv(["git", "diff", "HEAD~1"])).toBe(false);
    expect(isRestrictedGitDiffArgv(["node", "index.js"])).toBe(false);

    const fullDiff = restrictedGitDiffArgv(["git", "diff", "--check"]);
    expect(fullDiff).toContain("--no-ext-diff");
    expect(fullDiff).toContain("--no-textconv");

    expect(restrictedGitDiffArgv(["npm", "test"])).toEqual(["npm", "test"]);
    expect(() => restrictedGitDiffArgv(["git", "diff", "HEAD"])).toThrow(
      /not an accepted diff check/i,
    );
  });

  test("includeRuntimeSourceEntry filters runtime directories and source extensions", () => {
    expect(includeRuntimeSourceEntry(".", "harness.ts", false)).toBe(true);
    expect(includeRuntimeSourceEntry(".", "package.json", false)).toBe(true);
    expect(includeRuntimeSourceEntry(".", "unrelated.ts", false)).toBe(false);

    expect(includeRuntimeSourceEntry("src", "foo.ts", false)).toBe(true);
    expect(includeRuntimeSourceEntry("src", "node_modules", true)).toBe(false);
    expect(includeRuntimeSourceEntry("src", ".git", true)).toBe(false);
    expect(includeRuntimeSourceEntry("src", "script.py", false)).toBe(false);
    expect(includeRuntimeSourceEntry("src", "compiled.pyc", false)).toBe(false);
    expect(includeRuntimeSourceEntry("src", ".DS_Store", false)).toBe(false);
  });

  test("host concurrency ceiling detection and safe derivation", () => {
    const ceiling = discoverHostConcurrencyCeiling();
    // In CI/local it may return null or an object
    if (ceiling !== null) {
      expect(ceiling.value).toBeGreaterThanOrEqual(1);
    }

    expect(deriveGateConcurrencyCeiling(8)).toBe(4);
    expect(deriveGateConcurrencyCeiling(1)).toBe(1);

    // Custom probe mocks
    const customProbe = {
      availableParallelism: () => 6,
      cpuCount: () => 6,
    };
    expect(deriveGateConcurrencyCeiling(undefined, customProbe)).toBe(3);

    const failingProbe = {
      availableParallelism: () => {
        throw new Error("fail");
      },
      cpuCount: () => 4,
    };
    expect(deriveGateConcurrencyCeiling(undefined, failingProbe)).toBe(2);
  });

  test("runtime-tree snapshot and copyPinnedRuntime securely copies runtime directory", () => {
    const sourceDir = join(scratchBase, "source-runtime");
    const destDir = join(scratchBase, "dest-runtime");
    mkdirSync(join(sourceDir, "src"), { recursive: true });
    writeFileSync(join(sourceDir, "package.json"), '{"name":"mock"}', "utf-8");
    writeFileSync(join(sourceDir, "harness.ts"), "// harness", "utf-8");
    writeFileSync(join(sourceDir, "src", "index.ts"), 'console.log("ok");', "utf-8");

    const snapshot = runtimeTreeSnapshot(sourceDir, { filterRuntimeSource: true });
    expect(snapshot.fileCount).toBe(3);
    expect(snapshot.digest).toHaveLength(64);

    const copiedSnapshot = copyPinnedRuntime(sourceDir, destDir);
    expect(copiedSnapshot.fileCount).toBe(3);
    expect(copiedSnapshot.digest).toBe(snapshot.digest);
    expect(existsSync(join(destDir, "src", "index.ts"))).toBe(true);

    // Source modification during copy throws
    const modDest = join(scratchBase, "mod-dest");
    expect(() =>
      copyPinnedRuntime(sourceDir, modDest, {
        beforeSourceRecheck: () => {
          writeFileSync(join(sourceDir, "harness.ts"), "// changed mid-flight", "utf-8");
        },
      }),
    ).toThrow(/runtime source changed while it was being copied/i);

    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(destDir, { recursive: true, force: true });
    rmSync(modDest, { recursive: true, force: true });
  });
});

import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

export const coreRuntimeSuiteName = "core runtime utilities: bounded directory, git, filter, concurrency, runtime-tree";

describe(coreRuntimeSuiteName, () => {
  const scratchBase = join(tmpdir(), `core-runtime-tests-${Date.now()}`);

  afterAll(() => {
    rmSync(scratchBase, { recursive: true, force: true });
  });

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
    if (ceiling !== null) {
      expect(ceiling.value).toBeGreaterThanOrEqual(1);
    }

    const isolatedHome = join(scratchBase, "isolated-home");
    const claudeCeiling = discoverHostConcurrencyCeiling({
      homeDir: isolatedHome,
      env: {
        CLAUDE_CODE_MODEL: "claude-3-5-sonnet",
        CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "4",
      },
    });
    expect(claudeCeiling).toEqual({ value: 4, hostTool: "claude-code" });

    const invalidClaudeCeiling = discoverHostConcurrencyCeiling({
      homeDir: isolatedHome,
      env: {
        CLAUDE_CODE_MODEL: "claude-3-5-sonnet",
        CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "-2",
      },
    });
    expect(invalidClaudeCeiling).toBeNull();

    const nonIntegerCeiling = discoverHostConcurrencyCeiling({
      homeDir: isolatedHome,
      env: {
        CLAUDE_CODE_MODEL: "claude-3-5-sonnet",
        CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "0",
      },
    });
    expect(nonIntegerCeiling).toBeNull();

    expect(deriveGateConcurrencyCeiling(8)).toBe(4);
    expect(deriveGateConcurrencyCeiling(1)).toBe(1);

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

    const failingAvailableParallelismOnly = {
      availableParallelism: () => {
        throw new Error("fail");
      },
    };
    expect(
      deriveGateConcurrencyCeiling(undefined, failingAvailableParallelismOnly),
    ).toBeGreaterThanOrEqual(1);

    const nonIntegerProbe = {
      availableParallelism: () => 0,
      cpuCount: () => 0,
    };
    expect(deriveGateConcurrencyCeiling(undefined, nonIntegerProbe)).toBe(1);

    const errorProbe = {
      availableParallelism: () => {
        throw new Error("error1");
      },
      cpuCount: () => {
        throw new Error("error2");
      },
    };
    expect(deriveGateConcurrencyCeiling(undefined, errorProbe)).toBe(1);
  });

  test("runtime-tree snapshot and copyPinnedRuntime securely copies runtime directory and handles error conditions", () => {
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

    const modDest = join(scratchBase, "mod-dest");
    expect(() =>
      copyPinnedRuntime(sourceDir, modDest, {
        beforeSourceRecheck: () => {
          writeFileSync(join(sourceDir, "harness.ts"), "// changed mid-flight", "utf-8");
        },
      }),
    ).toThrow(/runtime source changed while it was being copied/i);

    expect(() =>
      copyPinnedRuntime(join(scratchBase, "nonexistent-source"), join(scratchBase, "dest2")),
    ).toThrow(/runtime source must be a real directory/i);

    expect(() =>
      copyPinnedRuntime(join(sourceDir, "package.json"), join(scratchBase, "dest3")),
    ).toThrow(/runtime source must be a real directory/i);

    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(destDir, { recursive: true, force: true });
    rmSync(modDest, { recursive: true, force: true });
  });
});

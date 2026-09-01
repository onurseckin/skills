import { beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { enrichFileRefsWithDiffs } from "../../../olt/scripts/src/summary/formatters/index.ts";
import type { RepositoryGitCommand } from "../../../olt/scripts/src/packets/repository-git-command.ts";
import type { FileRef } from "../../../olt/scripts/src/summary/graph/index.ts";
import { setupVirtualSummaryFS } from "../fixture.ts";

let rootCounter = 0;

beforeEach(() => {
  setupVirtualSummaryFS();
});

function createSandboxRoot(testName: string): string {
  rootCounter += 1;
  const slug = testName.replace(/[^a-z0-9]+/giu, "-").toLowerCase();
  const dir = `/virtual/harness-file-diff-reader-tests/${slug}-${rootCounter}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Fakes the `RepositoryGitCommand` seam `enrichFileRefsWithDiffs` already accepts, so its pure
 * merge/parse logic (anchor resolution, hunk-range parsing, per-file independence) can be
 * exercised without a real git subprocess.
 */
function fixedDiffCommand(diffsByPath: ReadonlyMap<string, string>): RepositoryGitCommand {
  return (_repo, argv) => {
    const path = argv.at(-1);
    if (typeof path !== "string" || !diffsByPath.has(path)) {
      throw new Error(
        `fixedDiffCommand: no fixture diff registered for argv ${JSON.stringify(argv)}`,
      );
    }
    return { status: 0, bytes: Buffer.from(diffsByPath.get(path) as string, "utf8") };
  };
}

/** Fails loudly if a path that should short-circuit before reaching git calls into it anyway. */
const throwingCommand: RepositoryGitCommand = (repo, argv) => {
  throw new Error(`unexpected repositoryGit call: ${repo} ${argv.join(" ")}`);
};

/** Simulates a real git failure (e.g. the path never existed at that commit) once invoked. */
const failingDiffCommand: RepositoryGitCommand = () => {
  throw new Error("git diff exited with status 128");
};

interface RunRootFixture {
  runRoot: string;
  headCommit: string;
}

/**
 * A `.capsules/<run>/state.json` whose baseline anchors a diff reading at `headCommit` — the
 * same shape `recordRepositoryInspection` writes, built directly as a typed fixture.
 */
function seedRunRoot(testName: string): RunRootFixture {
  const repositoryRoot = createSandboxRoot(testName);
  const runRoot = join(repositoryRoot, ".olt", "capsules", "run-1");
  mkdirSync(runRoot, { recursive: true });
  const headCommit = "f".repeat(40);
  const digest = "d".repeat(64);
  const inspection = {
    inspection_sha256: digest,
    captured_at: "2026-08-19T00:00:00.000Z",
    phase: "baseline",
    git: { head: headCommit },
  };
  writeFileSync(
    join(runRoot, "state.json"),
    JSON.stringify({
      baseline_repository_inspection_sha256: digest,
      repository_inspections: { [digest]: inspection },
    }),
  );
  return { runRoot, headCommit };
}

function ref(path: string): FileRef {
  return { path, mode: "write", evidence_class: "agent_reported" };
}

const UNIFIED_DIFF_A = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,4 @@",
  " line one",
  "-line two",
  "+changed two",
  " line three",
  "+line four",
  "",
].join("\n");

const UNIFIED_DIFF_B = [
  "diff --git a/src/b.ts b/src/b.ts",
  "index 3333333..4444444 100644",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1 +1 @@",
  "-export const b = 1;",
  "+export const b = 2;",
  "",
].join("\n");

describe("enrichFileRefsWithDiffs", () => {
  test("a repository with no state.json at the run root passes files through unchanged", () => {
    const { runRoot } = seedRunRoot("no-state-json");
    rmSync(join(runRoot, "state.json"));
    const [enriched] = enrichFileRefsWithDiffs([ref("src/a.ts")], runRoot, throwingCommand);
    expect(enriched).toEqual(ref("src/a.ts"));
  });

  test("a state.json that is not valid JSON passes files through unchanged", () => {
    const root = createSandboxRoot("malformed-state-json");
    writeFileSync(join(root, "state.json"), "{ not json");
    const [enriched] = enrichFileRefsWithDiffs([ref("src/a.ts")], root, throwingCommand);
    expect(enriched).toEqual(ref("src/a.ts"));
  });

  test("a git command that fails leaves the file unenriched rather than throwing", () => {
    const { runRoot } = seedRunRoot("failing-git-command");
    const [enriched] = enrichFileRefsWithDiffs([ref("src/a.ts")], runRoot, failingDiffCommand);
    expect(enriched).toEqual(ref("src/a.ts"));
  });

  test("a state.json naming an inspection the registry does not hold passes files through unchanged", () => {
    const root = createSandboxRoot("dangling-inspection");
    writeFileSync(
      join(root, "state.json"),
      JSON.stringify({
        baseline_repository_inspection_sha256: "missing",
        repository_inspections: {},
      }),
    );
    const [enriched] = enrichFileRefsWithDiffs([ref("src/a.ts")], root, throwingCommand);
    expect(enriched).toEqual(ref("src/a.ts"));
  });

  test("populates diff, lines, additions and deletions from an injected Git reading", () => {
    const { runRoot } = seedRunRoot("populates-diff");
    const command = fixedDiffCommand(new Map([["src/a.ts", UNIFIED_DIFF_A]]));

    const [enriched] = enrichFileRefsWithDiffs([ref("src/a.ts")], runRoot, command);
    expect(enriched!.diff).toContain("-line two");
    expect(enriched!.diff).toContain("+changed two");
    expect(enriched!.diff).toContain("+line four");
    expect(enriched!.additions).toBeGreaterThan(0);
    expect(enriched!.deletions).toBeGreaterThan(0);
    expect(enriched!.lines?.length).toBeGreaterThan(0);
    expect(enriched!.evidence_class).toBe("agent_reported");
    expect(enriched!.path).toBe("src/a.ts");
  });

  test("a path with no actual change stays unenriched rather than gaining an empty diff", () => {
    const { runRoot } = seedRunRoot("no-actual-change");
    const command = fixedDiffCommand(new Map([["src/a.ts", ""]]));
    const [enriched] = enrichFileRefsWithDiffs([ref("src/a.ts")], runRoot, command);
    expect(enriched).toEqual(ref("src/a.ts"));
  });

  test("a run root with no repository on disk passes files through unchanged", () => {
    const root = createSandboxRoot("no-repo-on-disk");
    const runRoot = join(root, ".olt", "capsules", "run-1");
    mkdirSync(runRoot, { recursive: true });
    const [enriched] = enrichFileRefsWithDiffs([ref("src/a.ts")], runRoot, throwingCommand);
    expect(enriched).toEqual(ref("src/a.ts"));
  });

  test("an undefined run root passes files through unchanged", () => {
    expect(enrichFileRefsWithDiffs([ref("src/a.ts")], undefined, throwingCommand)).toEqual([
      ref("src/a.ts"),
    ]);
  });

  test("an empty file list is returned as-is without touching the anchor", () => {
    expect(enrichFileRefsWithDiffs([], "/nonexistent/run/root", throwingCommand)).toEqual([]);
  });

  test("multiple files are each diffed against the same baseline independently", () => {
    const { runRoot } = seedRunRoot("multiple-files");
    const command = fixedDiffCommand(
      new Map([
        ["src/a.ts", UNIFIED_DIFF_A],
        ["src/b.ts", UNIFIED_DIFF_B],
      ]),
    );

    const enriched = enrichFileRefsWithDiffs([ref("src/a.ts"), ref("src/b.ts")], runRoot, command);
    expect(enriched[0]!.diff).toContain("+line four");
    expect(enriched[1]!.diff).toContain("+export const b = 2;");
    expect(enriched[0]!.diff).not.toContain("export const b");
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrichFileRefsWithDiffs } from "../../../orchestrating-long-tasks/scripts/src/summary/file-diff-reader.ts";
import type { FileRef } from "../../../orchestrating-long-tasks/scripts/src/summary/types.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo }).toString("utf8").trim();
}

/**
 * A repository with one baseline commit, plus a `.capsules/<run>` run root whose `state.json`
 * anchors a diff reading at that commit — the same shape `recordRepositoryInspection` writes, built
 * here directly so the test does not need the full CLI to exercise the reader.
 */
function seedRunRoot(): { repo: string; runRoot: string; head: string } {
  const repo = mkdtempSync(join(tmpdir(), "file-diff-reader-"));
  roots.push(repo);
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "fixture@example.invalid"]);
  git(repo, ["config", "user.name", "fixture"]);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "a.ts"), "line one\nline two\nline three\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "baseline"]);
  const head = git(repo, ["rev-parse", "HEAD"]);

  const runRoot = join(repo, ".capsules", "run-1");
  mkdirSync(runRoot, { recursive: true });
  const digest = "d".repeat(64);
  const inspection = {
    schema: "harness.repository-inspection",
    version: 3,
    phase: "baseline",
    captured_at: "2026-08-19T00:00:00.000Z",
    repository_root: repo,
    repository_identity_sha256: "a".repeat(64),
    repository_git_identity_sha256: "b".repeat(64),
    repository_content_sha256: "c".repeat(64),
    repository_file_count: 1,
    repository_total_bytes: 20,
    inspection_sha256: digest,
    git: { status: "clean", head, history: null },
  };
  writeFileSync(
    join(runRoot, "state.json"),
    JSON.stringify({
      baseline_repository_inspection_sha256: digest,
      repository_inspections: { [digest]: inspection },
    }),
  );
  return { repo, runRoot, head };
}

function ref(path: string): FileRef {
  return { path, mode: "write", evidence_class: "agent_reported" };
}

describe("enrichFileRefsWithDiffs", () => {
  test("a repository with no state.json at the run root passes files through unchanged", () => {
    // A real repository exists here (unlike the "no repository on disk" case below), isolating
    // "the anchor is missing" from "there is nothing to diff against at all".
    const { runRoot } = seedRunRoot();
    rmSync(join(runRoot, "state.json"));
    const [enriched] = enrichFileRefsWithDiffs([ref("src/a.ts")], runRoot);
    expect(enriched).toEqual(ref("src/a.ts"));
  });

  test("a state.json naming an inspection the registry does not hold passes files through unchanged", () => {
    const root = mkdtempSync(join(tmpdir(), "file-diff-reader-dangling-"));
    roots.push(root);
    writeFileSync(
      join(root, "state.json"),
      JSON.stringify({
        baseline_repository_inspection_sha256: "missing",
        repository_inspections: {},
      }),
    );
    const [enriched] = enrichFileRefsWithDiffs([ref("src/a.ts")], root);
    expect(enriched).toEqual(ref("src/a.ts"));
  });

  test("populates diff, lines, additions and deletions from a real Git reading", () => {
    const { repo, runRoot } = seedRunRoot();
    writeFileSync(join(repo, "src", "a.ts"), "line one\nchanged two\nline three\nline four\n");

    const [enriched] = enrichFileRefsWithDiffs([ref("src/a.ts")], runRoot);
    expect(enriched!.diff).toContain("-line two");
    expect(enriched!.diff).toContain("+changed two");
    expect(enriched!.diff).toContain("+line four");
    expect(enriched!.additions).toBeGreaterThan(0);
    expect(enriched!.deletions).toBeGreaterThan(0);
    expect(enriched!.lines?.length).toBeGreaterThan(0);
    // The path's own claim provenance is untouched by adding a diff to it.
    expect(enriched!.evidence_class).toBe("agent_reported");
    expect(enriched!.path).toBe("src/a.ts");
  });

  test("a path with no actual change stays unenriched rather than gaining an empty diff", () => {
    const { runRoot } = seedRunRoot();
    const [enriched] = enrichFileRefsWithDiffs([ref("src/a.ts")], runRoot);
    expect(enriched).toEqual(ref("src/a.ts"));
  });

  test("a run root with no repository on disk passes files through unchanged", () => {
    const root = mkdtempSync(join(tmpdir(), "file-diff-reader-no-repo-"));
    roots.push(root);
    const runRoot = join(root, ".capsules", "run-1");
    mkdirSync(runRoot, { recursive: true });
    const [enriched] = enrichFileRefsWithDiffs([ref("src/a.ts")], runRoot);
    expect(enriched).toEqual(ref("src/a.ts"));
  });

  test("an undefined run root passes files through unchanged", () => {
    expect(enrichFileRefsWithDiffs([ref("src/a.ts")], undefined)).toEqual([ref("src/a.ts")]);
  });

  test("an empty file list is returned as-is without touching the anchor", () => {
    expect(enrichFileRefsWithDiffs([], "/nonexistent/run/root")).toEqual([]);
  });

  test("multiple files are each diffed against the same baseline independently", () => {
    const { repo, runRoot } = seedRunRoot();
    writeFileSync(join(repo, "src", "b.ts"), "export const b = 1;\n");
    git(repo, ["add", "-A"]);
    writeFileSync(join(repo, "src", "a.ts"), "line one\nline two\nline three\nline four\n");
    writeFileSync(join(repo, "src", "b.ts"), "export const b = 2;\n");

    const enriched = enrichFileRefsWithDiffs([ref("src/a.ts"), ref("src/b.ts")], runRoot);
    expect(enriched[0]!.diff).toContain("+line four");
    expect(enriched[1]!.diff).toContain("+export const b = 2;");
    expect(enriched[0]!.diff).not.toContain("export const b");
  });
});

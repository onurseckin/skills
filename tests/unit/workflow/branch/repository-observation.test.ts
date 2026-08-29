import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  observedFilesChanged,
  observeRepository,
} from "../../../../olt/scripts/src/workflow/branch/repository-observation.ts";
import type {
  RepositoryGitCommand,
  RepositoryGitResult,
} from "../../../../olt/scripts/src/packets/repository-git-command.ts";
import type { BranchRepositoryObservation } from "../../../../olt/scripts/src/core/contracts/index.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function trackedRepo(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `harness-${prefix}-`));
  roots.push(dir);
  return dir;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

type Call = { repo: string; argv: string[]; maximum: number; accepted?: readonly number[] };

function scriptedCommand(script: (call: Call, index: number) => RepositoryGitResult): {
  command: RepositoryGitCommand;
  calls: Call[];
} {
  const calls: Call[] = [];
  const command: RepositoryGitCommand = (repo, argv, maximum, accepted) => {
    const call = { repo, argv, maximum, accepted };
    calls.push(call);
    return script(call, calls.length - 1);
  };
  return { command, calls };
}

function bytes(text: string): Buffer {
  return Buffer.from(text, "utf8");
}

const NOW = new Date("2026-08-19T00:00:00.000Z");

describe("observeRepository", () => {
  test("reports git_available: false without invoking git when metadata preflight fails", () => {
    const repo = trackedRepo("observe-no-git");
    const { command, calls } = scriptedCommand(() => ({ status: 0, bytes: bytes("") }));
    const observation = observeRepository(repo, NOW, { hasGitMetadata: () => false, command });
    expect(observation).toEqual({
      observed_at: NOW.toISOString(),
      git_available: false,
      head: null,
      entries: [],
    });
    expect(calls).toHaveLength(0);
  });

  test("returns a null head when rev-parse does not resolve (empty repo, exit 1)", () => {
    const repo = trackedRepo("observe-no-head");
    const { command } = scriptedCommand((call) => {
      if (call.argv[0] === "rev-parse") return { status: 1, bytes: bytes("") };
      return { status: 0, bytes: bytes("") };
    });
    const observation = observeRepository(repo, NOW, { hasGitMetadata: () => true, command });
    expect(observation.head).toBeNull();
    expect(observation.git_available).toBe(true);
  });

  test("returns a null head when rev-parse succeeds but yields blank output", () => {
    const repo = trackedRepo("observe-blank-head");
    const { command } = scriptedCommand((call) => {
      if (call.argv[0] === "rev-parse") return { status: 0, bytes: bytes("   \n") };
      return { status: 0, bytes: bytes("") };
    });
    const observation = observeRepository(repo, NOW, { hasGitMetadata: () => true, command });
    expect(observation.head).toBeNull();
  });

  test("parses ordinary, renamed, unmerged, untracked, and ignored porcelain v2 lines, skipping headers and blanks", () => {
    const repo = trackedRepo("observe-parse");
    writeFileSync(join(repo, "changed.txt"), "hello\n");
    writeFileSync(join(repo, "new.txt"), "new file\n");
    mkdirSync(join(repo, "sub"), { recursive: true });
    writeFileSync(join(repo, "sub", "renamed-to.txt"), "renamed\n");
    const status = [
      "# header line should be skipped",
      "",
      "1 M. N... 100644 100644 100644 aaaa bbbb changed.txt",
      "2 R100 N... 100644 100644 100644 aaaa bbbb R100 sub/renamed-to.txt\told-name.txt",
      "u UU N... 100644 100644 100644 100644 aaaa bbbb cccc conflict.txt",
      "? new.txt",
      "! build/ignored.txt",
    ].join("\n");
    const { command } = scriptedCommand((call) => {
      if (call.argv[0] === "rev-parse") return { status: 0, bytes: bytes("deadbeef\n") };
      return { status: 0, bytes: bytes(status) };
    });
    const observation = observeRepository(repo, NOW, { hasGitMetadata: () => true, command });
    expect(observation.head).toBe("deadbeef");
    const byPath = new Map(observation.entries.map((e) => [e.path, e]));
    expect(byPath.get("changed.txt")).toEqual({
      path: "changed.txt",
      status_code: "M.",
      sha256: sha256("hello\n"),
    });
    expect(byPath.get("sub/renamed-to.txt")).toEqual({
      path: "sub/renamed-to.txt",
      status_code: "R100",
      sha256: sha256("renamed\n"),
    });
    expect(byPath.get("conflict.txt")).toEqual({
      path: "conflict.txt",
      status_code: "UU",
      sha256: null,
    });
    expect(byPath.get("new.txt")).toEqual({
      path: "new.txt",
      status_code: "?",
      sha256: sha256("new file\n"),
    });
    expect(byPath.get("build/ignored.txt")).toEqual({
      path: "build/ignored.txt",
      status_code: "!",
      sha256: null,
    });
    // sorted by path
    expect(observation.entries.map((e) => e.path)).toEqual(
      [...observation.entries.map((e) => e.path)].sort(),
    );
  });

  test("skips a line whose kind is unrecognised and one with a blank resolved path", () => {
    const repo = trackedRepo("observe-skip-bad-lines");
    const status = ["3 bogus-kind-not-in-offset-table", "? "].join("\n");
    const { command } = scriptedCommand((call) => {
      if (call.argv[0] === "rev-parse") return { status: 0, bytes: bytes("") };
      return { status: 0, bytes: bytes(status) };
    });
    const observation = observeRepository(repo, NOW, { hasGitMetadata: () => true, command });
    expect(observation.entries).toEqual([]);
  });

  test("throws INVALID_STATE when the status output reports more paths than the observer will attribute", () => {
    const repo = trackedRepo("observe-too-many");
    const lines = Array.from({ length: 5_001 }, (_, i) => `? file-${i}.txt`).join("\n");
    const { command } = scriptedCommand((call) => {
      if (call.argv[0] === "rev-parse") return { status: 0, bytes: bytes("") };
      return { status: 0, bytes: bytes(lines) };
    });
    expect(() => observeRepository(repo, NOW, { hasGitMetadata: () => true, command })).toThrow(
      /above the 5000 the branch observer will attribute/,
    );
  });

  test("digests a real file's contents, and reports null for a path that does not exist on disk", () => {
    const repo = trackedRepo("observe-digest");
    writeFileSync(join(repo, "present.txt"), "content-here\n");
    const status = ["? present.txt", "? missing.txt"].join("\n");
    const { command } = scriptedCommand((call) => {
      if (call.argv[0] === "rev-parse") return { status: 0, bytes: bytes("") };
      return { status: 0, bytes: bytes(status) };
    });
    const observation = observeRepository(repo, NOW, { hasGitMetadata: () => true, command });
    const byPath = new Map(observation.entries.map((e) => [e.path, e.sha256]));
    expect(byPath.get("present.txt")).toBe(sha256("content-here\n"));
    expect(byPath.get("missing.txt")).toBeNull();
  });

  test("reports null sha256 for a path that resolves to a directory, not a regular file", () => {
    const repo = trackedRepo("observe-digest-dir");
    mkdirSync(join(repo, "adir"));
    const status = "? adir";
    const { command } = scriptedCommand((call) => {
      if (call.argv[0] === "rev-parse") return { status: 0, bytes: bytes("") };
      return { status: 0, bytes: bytes(status) };
    });
    const observation = observeRepository(repo, NOW, { hasGitMetadata: () => true, command });
    expect(observation.entries[0]!.sha256).toBeNull();
  });

  test("treats an empty status output as no entries at all", () => {
    const repo = trackedRepo("observe-empty-status");
    const { command } = scriptedCommand((call) => {
      if (call.argv[0] === "rev-parse") return { status: 0, bytes: bytes("deadbeef\n") };
      return { status: 0, bytes: bytes("") };
    });
    const observation = observeRepository(repo, NOW, { hasGitMetadata: () => true, command });
    expect(observation.entries).toEqual([]);
  });
});

describe("observedFilesChanged", () => {
  function observation(
    overrides: Partial<BranchRepositoryObservation> = {},
  ): BranchRepositoryObservation {
    return {
      observed_at: NOW.toISOString(),
      git_available: true,
      head: null,
      entries: [],
      ...overrides,
    };
  }

  test("returns null when either side never had git available", () => {
    expect(observedFilesChanged(observation({ git_available: false }), observation())).toBeNull();
    expect(observedFilesChanged(observation(), observation({ git_available: false }))).toBeNull();
  });

  test("reports paths whose digest changed, appeared, or disappeared between the two snapshots", () => {
    const before = observation({
      entries: [
        { path: "a.txt", status_code: "M.", sha256: "hash-a-old" },
        { path: "removed.txt", status_code: "M.", sha256: "hash-removed" },
      ],
    });
    const after = observation({
      entries: [
        { path: "a.txt", status_code: "M.", sha256: "hash-a-new" },
        { path: "added.txt", status_code: "?", sha256: "hash-added" },
      ],
    });
    expect(observedFilesChanged(before, after)).toEqual(["a.txt", "added.txt", "removed.txt"]);
  });

  test("returns an empty array when nothing changed and the head is unchanged", () => {
    const before = observation({
      head: "same",
      entries: [{ path: "a.txt", status_code: "M.", sha256: "h" }],
    });
    const after = observation({
      head: "same",
      entries: [{ path: "a.txt", status_code: "M.", sha256: "h" }],
    });
    expect(observedFilesChanged(before, after)).toEqual([]);
  });

  test("does not consult git diff when a repoRoot is not supplied, even if the head moved", () => {
    const before = observation({ head: "before-sha" });
    const after = observation({ head: "after-sha" });
    const { command, calls } = scriptedCommand(() => ({
      status: 0,
      bytes: bytes("should-not-be-called.txt"),
    }));
    const changed = observedFilesChanged(before, after, { command });
    expect(changed).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test("does not consult git diff when either head is null, even with a repoRoot supplied", () => {
    const repo = trackedRepo("changed-null-head");
    const before = observation({ head: null });
    const after = observation({ head: "after-sha" });
    const { command, calls } = scriptedCommand(() => ({
      status: 0,
      bytes: bytes("should-not-be-called.txt"),
    }));
    observedFilesChanged(before, after, { command }, repo);
    expect(calls).toHaveLength(0);
  });

  test("adds paths reported by git diff --name-only when the head moved and a repoRoot is supplied", () => {
    const repo = trackedRepo("changed-diff");
    const before = observation({
      head: "before-sha",
      entries: [{ path: "a.txt", status_code: "M.", sha256: "h" }],
    });
    const after = observation({
      head: "after-sha",
      entries: [{ path: "a.txt", status_code: "M.", sha256: "h" }],
    });
    const { command, calls } = scriptedCommand(() => ({
      status: 0,
      bytes: bytes("committed-only.txt\nother.txt\n"),
    }));
    const changed = observedFilesChanged(before, after, { command }, repo);
    expect(changed).toEqual(["committed-only.txt", "other.txt"]);
    expect(calls[0]!.argv).toEqual([
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--name-only",
      "before-sha..after-sha",
    ]);
  });

  test("treats an empty git diff output as no additional committed changes", () => {
    const repo = trackedRepo("changed-diff-empty");
    const before = observation({ head: "before-sha" });
    const after = observation({ head: "after-sha" });
    const { command } = scriptedCommand(() => ({ status: 0, bytes: bytes("") }));
    expect(observedFilesChanged(before, after, { command }, repo)).toEqual([]);
  });
});

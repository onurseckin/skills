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

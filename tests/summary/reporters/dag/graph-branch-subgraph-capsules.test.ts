import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BranchRecord } from "../../../../olt/scripts/src/core/contracts/index.ts";
import type { RepositoryGitCommand } from "../../../../olt/scripts/src/packets/repository-git-command.ts";
import { generateGraphDataset } from "../../../../olt/scripts/src/summary/graph/index.ts";
import { makeState, makeTask } from "./graph-fixtures.ts";

const REASON = "The migration turned out to need a schema rewrite and a data backfill";

function branch(overrides: Partial<BranchRecord> = {}): BranchRecord {
  return {
    id: "B-1",
    parent_task_id: "T-parent",
    parent_agent_id: "worker-1",
    reason: REASON,
    depth: 1,
    status: "collected",
    opened_at: "2026-08-14T20:05:00.000Z",
    collected_at: "2026-08-14T20:30:00.000Z",
    outcome_summary: "Both halves landed",
    sub_tasks: [
      {
        id: "B-1-schema",
        label: "Rewrite the schema",
        write_scope: ["src/db/schema.ts"],
        status: "submitted",
        agent_id: "sub-1",
        submitted_at: "2026-08-14T20:20:00.000Z",
        summary: "Schema rewritten",
        gate: "bun test src/db",
      },
    ],
    ...overrides,
  };
}

describe("branch region files carry a diff (B3/B15.2)", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  const HEAD_COMMIT = "f".repeat(40);
  const FLUSH_DIFF = [
    "diff --git a/src/flush.ts b/src/flush.ts",
    "index aaaaaaa..bbbbbbb 100644",
    "--- a/src/flush.ts",
    "+++ b/src/flush.ts",
    "@@ -1 +1 @@",
    "-export const flush = 1;",
    "+export const flush = 2;",
    "",
  ].join("\n");

  function fakeGitCommand(diffByPath: ReadonlyMap<string, string>): RepositoryGitCommand {
    return (_repositoryRoot, argv) => {
      const path = argv.at(-1) ?? "";
      const text = diffByPath.get(path) ?? "";
      return { status: 0, bytes: Buffer.from(text, "utf8") };
    };
  }

  function seedRunRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "branch-diff-"));
    roots.push(root);
    const runRoot = join(root, ".olt", "capsules", "run-1");
    mkdirSync(runRoot, { recursive: true });
    const digest = "d".repeat(64);
    writeFileSync(
      join(runRoot, "state.json"),
      JSON.stringify({
        baseline_repository_inspection_sha256: digest,
        repository_inspections: {
          [digest]: {
            inspection_sha256: digest,
            git: { status: "clean", head: HEAD_COMMIT, history: null },
          },
        },
      }),
    );
    return runRoot;
  }

  test("a genuinely edited path in the closing observation gets a real diff, not just a status code", () => {
    const runRoot = seedRunRoot();

    const dataset = generateGraphDataset({
      runId: "run-branch-diff",
      state: makeState([makeTask("T-parent", { status: "branched" })], {
        branches: [
          branch({
            collected_observation: {
              observed_at: "2026-08-14T20:30:00.000Z",
              git_available: true,
              head: null,
              entries: [{ path: "src/flush.ts", status_code: "M", sha256: null }],
            },
          }),
        ],
      }),
      runRoot,
      gitCommand: fakeGitCommand(new Map([["src/flush.ts", FLUSH_DIFF]])),
    });

    const section = dataset.sections?.find((entry) => entry.id === "section-branch-B-1");
    const file = section?.files?.find((entry) => entry.path === "src/flush.ts");
    expect(file).toBeDefined();
    expect(file?.statusCode).toBe("M");
    expect(file?.evidence_class).toBe("harness_observed");
    expect(file?.diff).toContain("-export const flush = 1;");
    expect(file?.diff).toContain("+export const flush = 2;");
    expect(file?.additions).toBe(1);
    expect(file?.deletions).toBe(1);
    expect(file?.lines).toBe("1");
  });

  test("a path the observation names but nothing actually changed stays without a diff", () => {
    const runRoot = seedRunRoot();

    const dataset = generateGraphDataset({
      runId: "run-branch-no-diff",
      state: makeState([makeTask("T-parent", { status: "branched" })], {
        branches: [
          branch({
            collected_observation: {
              observed_at: "2026-08-14T20:30:00.000Z",
              git_available: true,
              head: null,
              entries: [{ path: "src/flush.ts", status_code: "M", sha256: null }],
            },
          }),
        ],
      }),
      runRoot,
      gitCommand: fakeGitCommand(new Map()),
    });

    const section = dataset.sections?.find((entry) => entry.id === "section-branch-B-1");
    const file = section?.files?.find((entry) => entry.path === "src/flush.ts");
    expect(file?.statusCode).toBe("M");
    expect(file?.diff).toBeUndefined();
  });
});

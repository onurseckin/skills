import { describe, expect, test, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateGraphDataset } from "../../../orchestrating-long-tasks/scripts/src/summary/graph-generator.ts";
import { makeEvent, makeState, makeTask } from "./graph-fixtures.ts";

/**
 * B15.1/B15.2 end-to-end: a task's reported file reaches the graph carrying the step of its own
 * submission, the report's rationale and requirement ids, and a real Git diff against the run's
 * baseline — and the same submission shows up in `run.steps`, the action-provenance trace. Exercised
 * through `generateGraphDataset` directly (not the CLI) so it stays independent of whatever else is
 * mid-edit elsewhere in the harness.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo }).toString("utf8").trim();
}

function seedRunRoot(): { repo: string; runRoot: string } {
  const repo = mkdtempSync(join(tmpdir(), "file-provenance-wiring-"));
  roots.push(repo);
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "fixture@example.invalid"]);
  git(repo, ["config", "user.name", "fixture"]);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "baseline"]);
  const head = git(repo, ["rev-parse", "HEAD"]);

  // The task's own change, made after the baseline commit so the diff has something to show.
  writeFileSync(join(repo, "src", "a.ts"), "export const a = 2;\n");

  const runRoot = join(repo, ".capsules", "run-1");
  mkdirSync(runRoot, { recursive: true });
  const digest = "d".repeat(64);
  writeFileSync(
    join(runRoot, "state.json"),
    JSON.stringify({
      baseline_repository_inspection_sha256: digest,
      repository_inspections: {
        [digest]: {
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
        },
      },
    }),
  );
  return { repo, runRoot };
}

describe("file provenance reaches the graph end to end", () => {
  test("a task node's file carries its step, rationale, requirement ids and a real diff", () => {
    const { runRoot } = seedRunRoot();
    const task = makeTask("T-1", {
      requirement_ids: ["REQ-1", "REQ-2"],
      report: {
        summary: "Bumped the constant for the new grammar",
        requirement_ids: ["REQ-1", "REQ-2"],
        files_changed: ["src/a.ts"],
      },
    });
    const events = [
      makeEvent("task-claimed", 3, "2026-08-19T00:01:00.000Z", "worker-1", {
        task_id: "T-1",
        role: "implementer",
      }),
      makeEvent("task-submitted", 9, "2026-08-19T00:02:00.000Z", "worker-1", { task_id: "T-1" }),
    ];

    const dataset = generateGraphDataset({
      runId: "run-1",
      state: makeState([task]),
      events,
      runRoot,
    });

    const node = dataset.nodes.find((candidate) => candidate.id === "node-task-T-1");
    const file = node?.files?.find((candidate) => candidate.path === "src/a.ts");
    expect(file?.evidence_class).toBe("agent_reported");
    expect(file?.rationale).toBe("Bumped the constant for the new grammar");
    expect(file?.requirementIds).toEqual(["REQ-1", "REQ-2"]);
    // Attributed to the task's own submission, not the earlier claim.
    expect(file?.step).toBe(9);
    expect(file?.diff).toContain("-export const a = 1;");
    expect(file?.diff).toContain("+export const a = 2;");
    expect(file?.additions).toBe(1);
    expect(file?.deletions).toBe(1);
    expect(file?.lines).toBe("1");

    const step = dataset.run?.steps?.find((entry) => entry.step === 9);
    expect(step?.kind).toBe("task");
    expect(step?.rawKind).toBe("task-submitted");
    expect(step?.target.taskId).toBe("T-1");
    expect(step?.target.nodeId).toBe("node-task-T-1");
    expect(step?.outcome).toBe("success");
    expect(step?.evidence_class).toBe("harness_observed");
    expect(dataset.run?.steps?.map((entry) => entry.step)).toEqual([3, 9]);
  });

  test("a task submitted more than once is attributed to its latest submission, not an earlier round", () => {
    const { runRoot } = seedRunRoot();
    const task = makeTask("T-1", {
      report: { summary: "final round", files_changed: ["src/a.ts"] },
    });
    const events = [
      makeEvent("task-submitted", 4, "2026-08-19T00:01:00.000Z", "worker-1", { task_id: "T-1" }),
      makeEvent("review-recorded", 5, "2026-08-19T00:02:00.000Z", "val-1", {
        task_id: "T-1",
        verdict: "reject",
      }),
      makeEvent("task-submitted", 8, "2026-08-19T00:03:00.000Z", "worker-1", { task_id: "T-1" }),
    ];

    const dataset = generateGraphDataset({
      runId: "run-1",
      state: makeState([task]),
      events,
      runRoot,
    });
    const node = dataset.nodes.find((candidate) => candidate.id === "node-task-T-1");
    expect(node?.files?.[0]?.step).toBe(8);
  });
});

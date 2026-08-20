import { describe, expect, test, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateGraphDataset } from "../../../orchestrating-long-tasks/scripts/src/summary/graph-generator.ts";
import { formatSummaryMarkdown } from "../../../orchestrating-long-tasks/scripts/src/summary/markdown-formatter.ts";
import { makeEvent, makeState, makeTask } from "./graph-fixtures.ts";
import { manifest, metrics } from "./markdown-fixtures.ts";

/**
 * B15.1/B15.2, end to end through `summary.md`: `file-provenance-wiring.test.ts` proves a task's
 * file reaches `graph.json` carrying its step, rationale and a real Git diff; this proves
 * `formatSummaryMarkdown` renders that exact same computed `GraphDataset`, not a second pass over
 * the report that could disagree with it.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo }).toString("utf8").trim();
}

function seedRunRoot(): { repo: string; runRoot: string } {
  const repo = mkdtempSync(join(tmpdir(), "markdown-provenance-wiring-"));
  roots.push(repo);
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "fixture@example.invalid"]);
  git(repo, ["config", "user.name", "fixture"]);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "baseline"]);
  const head = git(repo, ["rev-parse", "HEAD"]);

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

describe("summary.md renders the same file and step provenance graph.json carries", () => {
  test("a task's line ranges, diff and stated reason all reach the Files Changed section", () => {
    const { runRoot } = seedRunRoot();
    const task = makeTask("T-1", {
      requirement_ids: ["REQ-1"],
      report: {
        summary: "Bumped the constant for the new grammar",
        requirement_ids: ["REQ-1"],
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
    const state = makeState([task]);
    const graph = generateGraphDataset({ runId: "run-1", state, events, runRoot });

    const markdown = formatSummaryMarkdown({
      runId: "run-1",
      runRoot,
      manifest,
      promptText: "Do the thing.",
      metrics,
      timeline: [],
      state,
      commands: {},
      graph,
    });

    const filesSection = markdown.slice(
      markdown.indexOf("## 11. Files Changed"),
      markdown.indexOf("## 12. Scripts And Commands"),
    );
    expect(filesSection).toContain("| `src/a.ts` | `T-1` | 9 | write | 1 | +1/-1 | agent_reported |");
    expect(filesSection).toContain("#### `src/a.ts` (T-1)");
    expect(filesSection).toContain("- **Why**: Bumped the constant for the new grammar");
    expect(filesSection).toContain("- **Requirements served**: `REQ-1`");
    expect(filesSection).toContain("```diff");
    expect(filesSection).toContain("-export const a = 1;");
    expect(filesSection).toContain("+export const a = 2;");

    const provenanceSection = markdown.slice(markdown.indexOf("## 19. Action Provenance Trace"));
    expect(provenanceSection).toContain(
      "| 9 | 2026-08-19T00:02:00.000Z | `worker-1` | task | `task-submitted` | taskId=T-1 nodeId=node-task-T-1 | success | harness_observed |",
    );
  });
});

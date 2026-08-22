import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { initRun, transact } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { renderHandoff } from "../../../orchestrating-long-tasks/scripts/src/reporting/handoff.ts";
import {
  formatStatusBrief,
  runStatus,
} from "../../../orchestrating-long-tasks/scripts/src/reporting/status.ts";
import type { NextActions } from "../../../orchestrating-long-tasks/scripts/src/reporting/action-types.ts";
import { dispatchFailures, handoffArgv } from "./dispatchable.ts";

const roots: string[] = [];
const entrypoint = fileURLToPath(
  new URL("../../../orchestrating-long-tasks/scripts/harness.ts", import.meta.url),
);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createMidFlightRun(taskCount = 2): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "harness-status-actions-"));
  roots.push(repo);
  const runRoot = initRun(
    repo,
    "status-actions-run",
    new TextEncoder().encode("Test prompt content"),
    "file",
    true,
  );

  transact(runRoot, "planner", "plan-applied", {}, (state) => {
    state.graph = {
      revision: 1,
      gates: [
        {
          id: "gate-1",
          scope: "task",
          cwd: ".",
          command: ["bun", "test"],
          requirement_ids: ["R-1"],
          mandatory: true,
        },
      ],
    };
    state.requirements = {
      requirements: [{ id: "R-1", disposition: "actionable", status: "planned", evidence: [] }],
    };
    const tasks: Record<string, unknown> = {};
    for (let i = 1; i <= taskCount; i++) {
      const taskId = `task-${i}`;
      tasks[taskId] = {
        id: taskId,
        status: "ready",
        requirement_ids: ["R-1"],
        dependencies: [],
        write_scope: [`src/file-${i}.ts`],
        attempts: [],
        history: [],
        repair_round: 0,
      };
    }
    state.tasks = tasks;
  });

  return runRoot;
}

describe("status actions surfacing", () => {
  test("runStatus returns next_actions and next_argv matching handoff.md for mid-flight capsule", async () => {
    const run = await createMidFlightRun(2);
    const status = runStatus(run);

    expect(status.next_actions).toBeDefined();
    expect(status.next_argv).toBeDefined();

    const nextActionsObj = status.next_actions as NextActions;
    expect(nextActionsObj.argv.length).toBeGreaterThan(0);
    expect(status.next_argv).toEqual(nextActionsObj.argv);

    const handoff = renderHandoff(run);
    const handoffCommands = handoffArgv(handoff);
    expect(nextActionsObj.argv).toEqual(handoffCommands);

    const failures = dispatchFailures(nextActionsObj.argv);
    expect(failures).toEqual([]);
  });

  test("runStatus on preplan capsule returns empty next_actions without crashing", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-preplan-status-"));
    roots.push(repo);
    const run = initRun(
      repo,
      "preplan-status-run",
      new TextEncoder().encode("Preplan prompt"),
      "file",
      true,
    );

    const status = runStatus(run);
    expect(status.next_actions).toEqual({ argv: [], unavailable: [] });
    expect(status.next_argv).toEqual([]);
    expect(typeof status.markdown).toBe("string");
    expect((status.markdown as string).split("\n").length).toBeLessThanOrEqual(30);
  });

  test("runStatus on corrupt capsule reports empty next_actions and lists integrity issues", async () => {
    const run = await createMidFlightRun(1);
    await writeFile(join(run, "state.json"), "{ broken json", "utf-8");

    const status = runStatus(run);
    expect(status.next_actions).toEqual({ argv: [], unavailable: [] });
    expect(status.next_argv).toEqual([]);
    expect((status.integrity_issues as unknown[]).length).toBeGreaterThan(0);
  });

  test("formatStatusBrief respects maxLines 30 budget and avoids mid-command truncation", () => {
    const longArgvList: string[][] = Array.from({ length: 50 }, (_, i) => [
      "bun",
      entrypoint,
      "task:claim",
      "--run",
      "/repo/.capsules/run",
      "--task",
      `task-${i + 1}`,
      "--role",
      "implementer",
      "--agent",
      `impl-${i + 1}`,
    ]);

    const brief = formatStatusBrief({
      runId: "large-run",
      runRoot: ".capsules/large-run",
      phase: "Executing",
      tasksCount: 50,
      satisfiedCount: 10,
      actions: { argv: longArgvList, unavailable: [] },
    });

    const lines = brief.split("\n");
    expect(lines.length).toBeLessThanOrEqual(30);

    // Assert that each rendered action line is a whole, runnable command without mid-command cutoffs
    const actionLines = lines.filter((l) => l.startsWith("- `bun "));
    expect(actionLines.length).toBeGreaterThan(0);
    for (const actionLine of actionLines) {
      expect(actionLine.endsWith("`")).toBe(true);
      expect(actionLine).toContain("--agent impl-");
    }

    // Remainder summary is present
    expect(brief).toContain("more actions (50 total)");
  });

  test("formatStatusBrief handles empty actions and unavailable reasons", () => {
    const emptyBrief = formatStatusBrief({
      runId: "empty-run",
      runRoot: ".capsules/empty-run",
      phase: "Planning",
      tasksCount: 0,
      satisfiedCount: 0,
      actions: { argv: [], unavailable: [] },
    });
    expect(emptyBrief).toContain("- *None*");
    expect(emptyBrief.split("\n").length).toBeLessThanOrEqual(30);

    const unavailableBrief = formatStatusBrief({
      runId: "paused-run",
      runRoot: ".capsules/paused-run",
      phase: "Executing",
      tasksCount: 1,
      satisfiedCount: 0,
      actions: {
        argv: [],
        unavailable: ["requirement R-1 is paused for an authority decision"],
      },
    });
    expect(unavailableBrief).toContain("- *Unavailable*: requirement R-1 is paused");
    expect(unavailableBrief.split("\n").length).toBeLessThanOrEqual(30);
  });
});

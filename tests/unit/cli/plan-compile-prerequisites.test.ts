import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { transact } from "../../../olt/scripts/src/engine/store/transaction.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function createTestRun(
  prefix: string,
  promptText = "Build an edge-case aware service",
): Promise<{ repo: string; run: string }> {
  const repo = await mkdtemp(join(tmpdir(), prefix));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, promptText, "utf-8");
  const init = await execute([
    "init",
    "--repo",
    repo,
    "--run-id",
    "test-run",
    "--prompt-file",
    promptPath,
  ]);
  const run = init.run_root as string;
  return { repo, run };
}

describe("plan:compile prerequisites", () => {
  test("throws INVALID_STATE / MANDATORY_PLAN_STEP_SKIPPED when plan:brainstorm was not executed", async () => {
    const { run } = await createTestRun("harness-plan-compile-nobrainstorm-");

    try {
      await execute([
        "plan:compile",
        "--run",
        run,
        "--actor",
        "planner",
        "--completion-gate",
        "bun test tests",
      ]);
      expect.unreachable("plan:compile should have thrown HarnessError");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(HarnessError);
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_STATE");
      expect(harnessErr.message).toContain(
        "[MANDATORY_PLAN_STEP_SKIPPED] Cannot compile plan: plan:brainstorm must be executed first.",
      );
    }
  });

  test("succeeds when plan:brainstorm is executed first", async () => {
    const { run } = await createTestRun("harness-plan-compile-withbrainstorm-");

    const brainstormResult = await execute(["plan:brainstorm", "--run", run, "--rounds", "1"]);
    expect(brainstormResult.success).toBe(true);

    const compileResult = await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    expect(compileResult.total_tasks).toBe(0);
    expect(compileResult.revision).toBe(1);
  });

  test("succeeds when brainstorming.json is directly present in the run root", async () => {
    const { run } = await createTestRun("harness-plan-compile-jsonfile-");

    await writeFile(
      join(run, "brainstorming.json"),
      JSON.stringify({ roundsExecuted: 1, totalExpandedItems: 8 }),
      "utf-8",
    );

    const compileResult = await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    expect(compileResult.total_tasks).toBe(0);
    expect(compileResult.revision).toBe(1);
  });

  test("succeeds when plan-brainstormed event is recorded in state/events", async () => {
    const { run } = await createTestRun("harness-plan-compile-event-");

    transact(run, "planner", "plan-brainstormed", { rounds: 1 }, () => {});

    const compileResult = await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    expect(compileResult.total_tasks).toBe(0);
    expect(compileResult.revision).toBe(1);
  });

  test("succeeds when state.planning.brainstorming is set", async () => {
    const { run } = await createTestRun("harness-plan-compile-state-");

    transact(run, "planner", "test-seeded", {}, (state) => {
      state.planning = {
        brainstorming: {
          rounds: 2,
          total_expanded_items: 16,
        },
      };
    });

    const compileResult = await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    expect(compileResult.total_tasks).toBe(0);
    expect(compileResult.revision).toBe(1);
  });
});

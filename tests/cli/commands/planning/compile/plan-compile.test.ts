import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun, setupCompiledRunUncompiled } from "../../fixtures/task-ops-fixture.ts";

const roots: string[] = [];

describe("plan:compile", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

  test("compiles an empty planning buffer with 0 tasks", async () => {
    const repo = `/virtual/cli/harness-plan-compile-empty-${Math.random().toString(36).slice(2)}`;
    roots.push(repo);
    await mkdir(join(repo, ".git"), { recursive: true });
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Do one thing");
    const init = await execute([
      "plan:init",
      "--repo",
      repo,
      "--run-id",
      `compile-empty-${Math.random().toString(36).slice(2)}`,
      "--prompt-file",
      promptPath,
    ]);
    await execute(["plan:brainstorm", "--run", init.run_root as string, "--actor", "planner"]);
    const result = await execute([
      "plan:compile",
      "--run",
      init.run_root as string,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    expect(result.total_tasks).toBe(0);
    expect(result.revision).toBe(1);
  });

  test("refuses overlapping write scopes between two buffered tasks", async () => {
    const repo = `/virtual/cli/harness-plan-compile-collision-${Math.random().toString(36).slice(2)}`;
    roots.push(repo);
    await mkdir(join(repo, ".git"), { recursive: true });
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Do one thing\n\nDo another thing");
    const init = await execute([
      "plan:init",
      "--repo",
      repo,
      "--run-id",
      `compile-collision-${Math.random().toString(36).slice(2)}`,
      "--prompt-file",
      promptPath,
    ]);
    const run = init.run_root as string;
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-a",
      "--label",
      "A",
      "--scope",
      "src/shared",
      "--gate",
      "bun test src/shared",
      "--actor",
      "planner",
    ]);
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-b",
      "--label",
      "B",
      "--scope",
      "src/shared",
      "--gate",
      "bun test src/shared",
      "--actor",
      "planner",
    ]);
    await execute(["plan:brainstorm", "--run", run, "--actor", "planner"]);
    await expect(
      execute([
        "plan:compile",
        "--run",
        run,
        "--actor",
        "planner",
        "--completion-gate",
        "bun test tests",
      ]),
    ).rejects.toThrow(/Scope collision detected/);
  });

  test("refuses to seal on a blocking audit finding that was not accepted, and refuses an acceptance the audit never raised", async () => {
    const { run } = await setupCompiledRunUncompiled("compile-blocked", roots);
    await expect(
      execute([
        "plan:compile",
        "--run",
        run,
        "--actor",
        "planner",
        "--completion-gate",
        "bun test tests",
      ]),
    ).rejects.toThrow(/plan:audit blocks compilation/);

    await expect(
      execute([
        "plan:compile",
        "--run",
        run,
        "--actor",
        "planner",
        "--completion-gate",
        "bun test tests",
        "--accept-audit",
        "A1-granularity:not the invariant that actually blocked",
      ]),
    ).rejects.toThrow(/which the audit did not raise as blocking/);
  });

  test("compiles successfully once every blocking invariant is explicitly accepted, and provisions no worktree ledger by default", async () => {
    const { run } = await setupCompiledRun("compile-accepted", roots);
    const status = await execute(["plan:status", "--run", run]);
    expect(status.is_compiled).toBe(true);
  });

  test("--accept-audit rejects malformed input: no colon, unknown invariant, or a blank reason", async () => {
    const { run } = await setupCompiledRunUncompiled("compile-accept-malformed", roots);
    await expect(
      execute([
        "plan:compile",
        "--run",
        run,
        "--actor",
        "planner",
        "--completion-gate",
        "bun test tests",
        "--accept-audit",
        "no colon at all here",
      ]),
    ).rejects.toThrow(/must be "<invariant-id>:<reason>"/);

    await expect(
      execute([
        "plan:compile",
        "--run",
        run,
        "--actor",
        "planner",
        "--completion-gate",
        "bun test tests",
        "--accept-audit",
        "not-a-real-invariant:some reason",
      ]),
    ).rejects.toThrow(/names an unknown invariant/);

    await expect(
      execute([
        "plan:compile",
        "--run",
        run,
        "--actor",
        "planner",
        "--completion-gate",
        "bun test tests",
        "--accept-audit",
        "A4-false-barrier:   ",
      ]),
    ).rejects.toThrow(/must carry a reason after the colon/);
  });
});

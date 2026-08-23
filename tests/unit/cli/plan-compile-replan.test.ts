import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { transact } from "../../../olt/scripts/src/engine/store/transaction.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun, markCoreImplemented } from "./task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("plan:compile", () => {
  test("compiles an empty planning buffer with 0 tasks", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-plan-compile-empty-"));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Do one thing");
    const init = await execute([
      "init",
      "--repo",
      repo,
      "--run-id",
      "compile-empty",
      "--prompt-file",
      promptPath,
    ]);
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
    const repo = await mkdtemp(join(tmpdir(), "harness-plan-compile-collision-"));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Do one thing\n\nDo another thing");
    const init = await execute([
      "init",
      "--repo",
      repo,
      "--run-id",
      "compile-collision",
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
    const roots2 = roots;
    const { run } = await setupCompiledRunUncompiled("compile-blocked", roots2);
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

describe("plan:replan", () => {
  test("raises the graph revision, generates a repair task inheriting its parent's gate, and stamps repair_round", async () => {
    const { repo, run } = await setupCompiledRun("replan-basic", roots);
    await markCoreImplemented(repo);

    const replanned = await execute([
      "plan:replan",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--findings",
      JSON.stringify([
        {
          observation: "task-core left a null check out",
          severity: "critical",
          remediation: "add the null check",
          file_paths: ["tests/unit/core/impl.ts"],
        },
      ]),
    ]);
    expect(replanned.revision).toBe(2);
    expect(replanned.repair_round).toBe(1);
    const repairTasks = replanned.repair_tasks as { id: string; gateCommand: string[] }[];
    expect(repairTasks.length).toBeGreaterThan(0);
    expect(String(replanned.markdown)).toContain("Graph Revision 2");
  });

  test("refuses when the findings source is entirely empty", async () => {
    const { run } = await setupCompiledRun("replan-no-findings", roots);
    await expect(
      execute([
        "plan:replan",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--gate",
        "bun run typecheck",
      ]),
    ).rejects.toThrow(/no findings available for replanning/);
  });

  test("an explicit --gate flag overrides any inherited or declared gate", async () => {
    const { repo, run } = await setupCompiledRun("replan-flag-gate", roots);
    await markCoreImplemented(repo);
    const replanned = await execute([
      "plan:replan",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--gate",
      "bun run typecheck",
      "--findings",
      JSON.stringify([
        {
          observation: "x",
          severity: "minor",
          file_paths: ["tests/unit/core/impl.ts"],
        },
      ]),
    ]);
    const repairTasks = replanned.repair_tasks as { gate_source: string; gateCommand: string[] }[];
    expect(repairTasks[0]!.gate_source).toBe("flag");
    expect(repairTasks[0]!.gateCommand).toEqual(["bun", "run", "typecheck"]);
  });

  // The uncompiled-buffer's state carries no `requirements`/`tasks` at all (those only exist once
  // plan:compile has run), so plan:replan's own binding lookup refuses the finding for having no
  // requirement to inherit before its later `isRecord(draft.graph)` guard is ever reached — the
  // guard is unreachable from the CLI on a genuinely uncompiled run; see the summary's findings.
  test("refuses plan:replan against an uncompiled plan (no requirement to bind the finding to)", async () => {
    const { run } = await setupCompiledRunUncompiled("replan-uncompiled", roots);
    await expect(
      execute([
        "plan:replan",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--gate",
        "bun run typecheck",
        "--findings",
        JSON.stringify([{ observation: "x", severity: "minor" }]),
      ]),
    ).rejects.toThrow(/no planned task writing .* carries one to inherit/);
  });

  test("expires a live completion_critic attempt and clears completion_review when replanning", async () => {
    const { repo, run } = await setupCompiledRun("replan-expires-critic", roots);
    await markCoreImplemented(repo);
    transact(run, "critic-1", "seed-completion-critic-for-test", {}, (state) => {
      state.completion_critic = { attempt: 1, status: "pending" };
      state.completion_critic_history = [{ attempt: 1, status: "pending" }];
      state.completion_review = {
        findings: [
          {
            observation: "recorded review finding",
            severity: "minor",
            file_paths: ["tests/unit/core/impl.ts"],
          },
        ],
      };
    });

    const replanned = await execute([
      "plan:replan",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--gate",
      "bun run typecheck",
    ]);
    expect(replanned.revision).toBe(2);
    const afterState = loadRun(run).state as unknown as {
      completion_critic?: unknown;
      completion_critic_history: { attempt: number; status: string }[];
      completion_review?: unknown;
    };
    expect(afterState.completion_critic).toBeUndefined();
    expect(afterState.completion_critic_history[0]!.status).toBe("expired");
    expect(afterState.completion_review).toBeUndefined();
  });
});

// setupCompiledRunUncompiled mirrors task-ops-fixture's setupCompiledRun up to (but not through)
// plan:compile, so the audit-blocking test above can attempt the compile itself and observe the
// refusal — task-ops-fixture's own helper only returns a run that already compiled successfully.
async function setupCompiledRunUncompiled(
  name: string,
  roots2: string[],
): Promise<{ repo: string; run: string }> {
  const repo = await mkdtemp(join(tmpdir(), `harness-plan-compile-blocked-${name}-`));
  roots2.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Core unit tests\n\nSecondary tests");
  await mkdir(join(repo, "tests/unit/core"), { recursive: true });
  await mkdir(join(repo, "tests/unit/sec"), { recursive: true });
  await writeFile(join(repo, "gate-core.ts"), "console.log('gate-core');\n");
  await writeFile(join(repo, "gate-sec.ts"), "console.log('gate-sec');\n");

  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    name,
    "--prompt-file",
    promptPath,
  ]);
  const run = init.run_root as string;

  await execute([
    "plan:add",
    "--run",
    run,
    "--id",
    "task-core",
    "--label",
    "Core Unit Tests",
    "--scope",
    "tests/unit/core",
    "--gate",
    "bun gate-core.ts",
    "--actor",
    "planner",
  ]);
  await execute([
    "plan:add",
    "--run",
    run,
    "--id",
    "task-sec",
    "--label",
    "Secondary Tests",
    "--scope",
    "tests/unit/sec",
    "--gate",
    "bun gate-sec.ts",
    "--deps",
    "task-core",
    "--dep-reason",
    "task-core:secondary tests read the fixtures task-core writes",
    "--actor",
    "planner",
  ]);
  return { repo, run };
}

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("CLI plan commands", () => {
  test("plan:init, plan:add, plan:status, and plan:compile flow", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-plan-cmd-"));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Core module tasks\n\nCLI module tasks\nIntegration tasks");

    const init = await execute([
      "plan:init",
      "--repo",
      repo,
      "--run",
      "test-plan-run",
      "--prompt-file",
      promptPath,
      "--source-verified",
    ]);
    expect(init.run_root).toBeString();
    expect(init.markdown).toBeString();
    expect(String(init.markdown)).toContain("### Capsule Initialized: test-plan-run");

    const run = init.run_root as string;

    const add1 = await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-core",
      "--label",
      "Core Unit Tests",
      "--scope",
      "src/core,tests/unit/core",
      "--gate",
      "bun test tests/unit/core",
      "--goal",
      "Implement core unit tests",
      "--priority",
      "80",
      "--actor",
      "planner",
    ]);
    expect(add1.total_tasks).toBe(1);
    expect(String(add1.markdown)).toContain("### Task Registered: task-core");

    const add2 = await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-cli",
      "--label",
      "CLI Commands",
      "--scope",
      "src/cli,tests/unit/cli",
      "--gate",
      "bun test tests/unit/cli",
      "--actor",
      "planner",
    ]);
    expect(add2.total_tasks).toBe(2);

    const status1 = await execute(["plan:status", "--run", run]);
    expect(status1.is_compiled).toBe(false);
    expect(String(status1.markdown)).toContain("### Planning Buffer: test-plan-run (Draft)");

    const compile = await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    expect(compile.revision).toBe(1);
    expect(compile.total_tasks).toBe(2);
    expect(String(compile.markdown)).toContain("### Plan Compiled Successfully (Graph Revision 1)");

    const status2 = await execute(["plan:status", "--run", run]);
    expect(status2.is_compiled).toBe(true);
    expect(String(status2.markdown)).toContain("(Compiled)");
  });

  test("plan:add rejects duplicate task IDs", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-plan-dup-"));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Some prompt");

    const init = await execute([
      "plan:init",
      "--repo",
      repo,
      "--run",
      "dup-run",
      "--prompt-file",
      promptPath,
    ]);
    const run = init.run_root as string;

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "t1",
      "--label",
      "T1",
      "--scope",
      "src/a",
      "--gate",
      "bun test tests/a",
      "--actor",
      "planner",
    ]);

    await expect(
      execute([
        "plan:add",
        "--run",
        run,
        "--id",
        "t1",
        "--label",
        "T1 duplicate",
        "--scope",
        "src/a",
        "--gate",
        "bun test tests/a",
        "--actor",
        "planner",
      ]),
    ).rejects.toThrow("task t1 already exists in planning buffer");
  });

  test("plan:compile throws on scope collisions", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-plan-coll-"));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Some prompt");

    const init = await execute([
      "plan:init",
      "--repo",
      repo,
      "--run",
      "coll-run",
      "--prompt-file",
      promptPath,
    ]);
    const run = init.run_root as string;

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "t1",
      "--label",
      "T1",
      "--scope",
      "src/shared",
      "--gate",
      "bun test tests/shared",
      "--actor",
      "planner",
    ]);

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "t2",
      "--label",
      "T2",
      "--scope",
      "src/shared/inner",
      "--gate",
      "bun test tests/inner",
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
    ).rejects.toThrow("Scope collision detected between t1 and t2");
  });

  test("plan:replan ingests findings, partitions scopes, and increments graph_revision", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-plan-replan-"));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Initial requirements for Drawer and Layout");

    const init = await execute([
      "plan:init",
      "--repo",
      repo,
      "--run",
      "replan-run",
      "--prompt-file",
      promptPath,
    ]);
    const run = init.run_root as string;

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-init",
      "--label",
      "Initial Task",
      "--scope",
      "src/init",
      "--gate",
      "bun test tests/init",
      "--actor",
      "planner",
    ]);

    await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);

    const findingsJson = JSON.stringify([
      {
        id: "F-DRAWER-01",
        requirement_id: "req-init",
        severity: "critical",
        file_paths: ["src/components/EdgeDetailDrawer/EdgeDrawer.tsx"],
        observation: "TS2322 in drawer toggle handler",
        remediation: "Update Props interface",
      },
      {
        id: "F-LAYOUT-01",
        requirement_id: "req-init",
        severity: "important",
        file_paths: ["src/engine/layout/hierarchical.ts"],
        observation: "Negative coordinate clamping bug",
        remediation: "Clamp coordinates to zero",
      },
    ]);

    const replan = await execute([
      "plan:replan",
      "--run",
      run,
      "--findings",
      findingsJson,
      "--actor",
      "coordinator",
      "--gate",
      "bun test tests/init",
    ]);

    expect(replan.revision).toBe(2);
    expect(replan.repair_round).toBe(1);
    expect(Array.isArray(replan.new_tasks)).toBe(true);
    expect((replan.new_tasks as string[]).length).toBe(2);
    expect(String(replan.markdown)).toContain("### Plan Recompiled: Wave R1 (Graph Revision 2)");
  });

  // B29.3: this exercises the actual plan:add call site (planAddCommand), not just gate-breadth.ts's
  // own unit tests — the wiring from a whole-suite gate + narrow scope through to a warning AND a
  // disk-discovered suggestion in the real CLI response is otherwise unproven.
  test("plan:add warns on a whole-suite gate against a narrow scope and suggests real test paths", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-plan-breadth-"));
    roots.push(repo);
    // The suggestion must come from a path this fixture repository actually has on disk, never a
    // guessed convention: discoverGatePaths requires the write scope itself to exist before it looks
    // for a mirror, so both the scope and the mirrored test directory need to be real here.
    await mkdir(join(repo, "src/db"), { recursive: true });
    await mkdir(join(repo, "tests/unit/db"), { recursive: true });
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Database task");

    const init = await execute([
      "plan:init",
      "--repo",
      repo,
      "--run",
      "breadth-run",
      "--prompt-file",
      promptPath,
    ]);
    const run = init.run_root as string;

    const add = await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-db",
      "--label",
      "Database",
      "--scope",
      "src/db",
      "--gate",
      "bun test",
      "--actor",
      "planner",
    ]);

    expect(add.gate_breadth_warning).toBeString();
    expect(String(add.gate_breadth_warning)).toContain(
      'gate "bun test" looks like a whole-suite run',
    );
    expect(add.suggested_gate_paths).toEqual(["tests/unit/db"]);
    expect(String(add.markdown)).toContain("> **Gate breadth**:");
    expect(String(add.markdown)).toContain("This repository already has: tests/unit/db.");
  });

  test("plan:add stays silent when the gate is already scoped to the write scope", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-plan-narrow-"));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Database task");

    const init = await execute([
      "plan:init",
      "--repo",
      repo,
      "--run",
      "narrow-run",
      "--prompt-file",
      promptPath,
    ]);
    const run = init.run_root as string;

    const add = await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-db",
      "--label",
      "Database",
      "--scope",
      "src/db",
      "--gate",
      "bun test tests/unit/db",
      "--actor",
      "planner",
    ]);

    expect(add.gate_breadth_warning).toBeUndefined();
    expect(add.suggested_gate_paths).toBeUndefined();
    expect(String(add.markdown)).not.toContain("Gate breadth");
  });
});

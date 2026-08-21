import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function initRun(name: string): Promise<{ repo: string; run: string }> {
  const repo = await mkdtemp(join(tmpdir(), `harness-auto-partition-cmd-${name}-`));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Harden the curriculum question banks, one domain at a time");
  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    name,
    "--prompt-file",
    promptPath,
  ]);
  return { repo, run: init.run_root as string };
}

// C6: the planner declares a glob, the harness enumerates what is really on disk and derives one
// task per match — the countermeasure for FORENSICS.md's ten-question-bank monolithic task.
describe("plan:add --auto-partition", () => {
  test("emits one task per matched file, each with its own scope-narrow gate", async () => {
    const { repo, run } = await initRun("per-file");
    await mkdir(join(repo, "src/curriculum/mlQuestions"), { recursive: true });
    await writeFile(join(repo, "src/curriculum/mlQuestions/linearAlgebra.ts"), "export {};\n");
    await writeFile(join(repo, "src/curriculum/mlQuestions/calculus.ts"), "export {};\n");
    await writeFile(join(repo, "src/curriculum/mlQuestions/notes.md"), "# not a task file\n");

    const added = await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-domain",
      "--label",
      "Domain bank",
      "--actor",
      "planner",
      "--auto-partition",
      "src/curriculum/mlQuestions/*.ts",
      "--gate-template",
      "bun test {scope}",
    ]);

    expect(added.total_tasks).toBe(2);
    const generated = (added.auto_partition as { generated_task_ids: string[] }).generated_task_ids;
    expect(generated.sort()).toEqual([
      "task-domain-src-curriculum-mlQuestions-calculus-ts",
      "task-domain-src-curriculum-mlQuestions-linearAlgebra-ts",
    ]);
    expect(String(added.markdown)).toContain("### Auto-Partitioned: 2 tasks from");

    const status = await execute(["plan:status", "--run", run]);
    const tasks = status.tasks as Array<{ id: string; gate: string; deps: string[] }>;
    const calculus = tasks.find((t) => t.id.endsWith("calculus-ts"))!;
    expect(calculus.gate).toBe("bun test src/curriculum/mlQuestions/calculus.ts");
    expect(calculus.deps).toEqual([]);
  });

  test("plan:compile seals with every generated task an independent root", async () => {
    const { repo, run } = await initRun("compile");
    await mkdir(join(repo, "src/curriculum/mlQuestions"), { recursive: true });
    await writeFile(join(repo, "src/curriculum/mlQuestions/a.ts"), "export {};\n");
    await writeFile(join(repo, "src/curriculum/mlQuestions/b.ts"), "export {};\n");

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-domain",
      "--label",
      "Domain bank",
      "--actor",
      "planner",
      "--auto-partition",
      "src/curriculum/mlQuestions/*.ts",
      "--gate-template",
      "bun test {scope}",
    ]);

    const compiled = await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    expect(compiled.total_tasks).toBe(2);
    const declaration = compiled.topology_declaration as { independent_roots: string[] };
    expect(declaration.independent_roots.length).toBe(2);
  });

  test("--group-by directory emits one task per directory holding a match", async () => {
    const { repo, run } = await initRun("per-directory");
    await mkdir(join(repo, "src/curriculum/alpha"), { recursive: true });
    await mkdir(join(repo, "src/curriculum/beta"), { recursive: true });
    await writeFile(join(repo, "src/curriculum/alpha/one.ts"), "export {};\n");
    await writeFile(join(repo, "src/curriculum/alpha/two.ts"), "export {};\n");
    await writeFile(join(repo, "src/curriculum/beta/one.ts"), "export {};\n");

    const added = await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-domain",
      "--label",
      "Domain bank",
      "--actor",
      "planner",
      "--auto-partition",
      "src/curriculum/**/*.ts",
      "--gate-template",
      "bun test {scope}",
      "--group-by",
      "directory",
    ]);
    expect(added.total_tasks).toBe(2);
    const generated = (added.auto_partition as { generated_task_ids: string[] }).generated_task_ids;
    expect(generated.sort()).toEqual([
      "task-domain-src-curriculum-alpha",
      "task-domain-src-curriculum-beta",
    ]);
  });

  test("refuses a --gate-template with no {scope} placeholder", async () => {
    const { repo, run } = await initRun("no-placeholder");
    await mkdir(join(repo, "src/curriculum/mlQuestions"), { recursive: true });
    await writeFile(join(repo, "src/curriculum/mlQuestions/a.ts"), "export {};\n");

    await expect(
      execute([
        "plan:add",
        "--run",
        run,
        "--id",
        "task-domain",
        "--label",
        "Domain bank",
        "--actor",
        "planner",
        "--auto-partition",
        "src/curriculum/mlQuestions/*.ts",
        "--gate-template",
        "bun test tests/unit/curriculum",
      ]),
    ).rejects.toThrow("--gate-template must contain the literal placeholder {scope}");
  });

  test("refuses a glob that matches nothing rather than silently registering zero tasks", async () => {
    const { run } = await initRun("no-match");
    await expect(
      execute([
        "plan:add",
        "--run",
        run,
        "--id",
        "task-domain",
        "--label",
        "Domain bank",
        "--actor",
        "planner",
        "--auto-partition",
        "src/nowhere/*.ts",
        "--gate-template",
        "bun test {scope}",
      ]),
    ).rejects.toThrow("matched no files under");
  });

  for (const exclusive of ["scope", "gate", "deps"] as const) {
    test(`refuses --auto-partition combined with --${exclusive}`, async () => {
      const { repo, run } = await initRun(`exclusive-${exclusive}`);
      await mkdir(join(repo, "src/curriculum/mlQuestions"), { recursive: true });
      await writeFile(join(repo, "src/curriculum/mlQuestions/a.ts"), "export {};\n");

      await expect(
        execute([
          "plan:add",
          "--run",
          run,
          "--id",
          "task-domain",
          "--label",
          "Domain bank",
          "--actor",
          "planner",
          "--auto-partition",
          "src/curriculum/mlQuestions/*.ts",
          "--gate-template",
          "bun test {scope}",
          `--${exclusive}`,
          exclusive === "deps" ? "task-other" : "irrelevant",
        ]),
      ).rejects.toThrow(`--auto-partition cannot be combined with --${exclusive}`);
    });
  }
});

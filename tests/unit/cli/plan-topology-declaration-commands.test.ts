import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function initRun(name: string): Promise<{ repo: string; run: string }> {
  const repo = await mkdtemp(join(tmpdir(), `harness-topo-decl-${name}-`));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Ports work\n\nCore work depending on ports");
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

// C6: the topology declaration DESIGN.md's plan:compile section requires — every dependency edge
// needs its own one-line justification, or the compile is refused outright.
describe("plan:compile's mandatory topology declaration", () => {
  test("refuses to seal while a --deps edge has no matching --dep-reason", async () => {
    const { run } = await initRun("unjustified");
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-ports",
      "--label",
      "Ports",
      "--scope",
      "src/ports",
      "--gate",
      "bun test src/ports",
      "--actor",
      "planner",
    ]);
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-core",
      "--label",
      "Core",
      "--scope",
      "src/ports/core",
      "--gate",
      "bun test src/ports/core",
      "--deps",
      "task-ports",
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
    ).rejects.toThrow(
      "dependency edge(s) without a declared justification: task-core -> task-ports",
    );
  });

  test("plan:add reports the unjustified dependency back as an advisory, before compile refuses it", async () => {
    const { run } = await initRun("advisory");
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-ports",
      "--label",
      "Ports",
      "--scope",
      "src/ports",
      "--gate",
      "bun test src/ports",
      "--actor",
      "planner",
    ]);
    const added = await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-core",
      "--label",
      "Core",
      "--scope",
      "src/ports/core",
      "--gate",
      "bun test src/ports/core",
      "--deps",
      "task-ports",
      "--actor",
      "planner",
    ]);
    expect(added.unjustified_dependencies).toEqual(["task-ports"]);
    expect(String(added.markdown)).toContain("**Unjustified dependency**: task-ports");
  });

  test("compiles once every edge carries a --dep-reason, and the brief reports the declaration", async () => {
    const { run } = await initRun("justified");
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-ports",
      "--label",
      "Ports",
      "--scope",
      "src/ports",
      "--gate",
      "bun test src/ports",
      "--actor",
      "planner",
    ]);
    const added = await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-core",
      "--label",
      "Core",
      "--scope",
      "src/ports/core",
      "--gate",
      "bun test src/ports/core",
      "--deps",
      "task-ports",
      "--dep-reason",
      "task-ports:core imports the port types task-ports declares",
      "--actor",
      "planner",
    ]);
    expect(added.unjustified_dependencies).toBeUndefined();

    const compiled = await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    expect(compiled.topology_declaration).toEqual({
      independent_roots: ["task-ports"],
      edges: [
        {
          task: "task-core",
          dependsOn: "task-ports",
          justification: "core imports the port types task-ports declares",
        },
      ],
    });
    expect(String(compiled.markdown)).toContain(
      "**Topology Declaration**: 1/2 tasks are independent roots; 1 dependency edge(s), all justified",
    );
  });

  test("--dep-reason naming an id outside --deps is refused rather than silently ignored", async () => {
    const { run } = await initRun("typo");
    await expect(
      execute([
        "plan:add",
        "--run",
        run,
        "--id",
        "task-core",
        "--label",
        "Core",
        "--scope",
        "src/core",
        "--gate",
        "bun test src/core",
        "--dep-reason",
        "task-ports:core imports the port types task-ports declares",
        "--actor",
        "planner",
      ]),
    ).rejects.toThrow("--dep-reason names 'task-ports', which is not in --deps (none)");
  });

  test("a malformed --dep-reason without a colon is refused", async () => {
    const { run } = await initRun("malformed");
    await expect(
      execute([
        "plan:add",
        "--run",
        run,
        "--id",
        "task-core",
        "--label",
        "Core",
        "--scope",
        "src/core",
        "--gate",
        "bun test src/core",
        "--deps",
        "task-ports",
        "--dep-reason",
        "task-ports",
        "--actor",
        "planner",
      ]),
    ).rejects.toThrow('--dep-reason must read "<dep-id>:<why this edge exists>"');
  });
});

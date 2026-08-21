import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  cleanupRoots,
  compiledCapsule,
  ledgerOf,
  registerCoordinator,
} from "../unit/agents/fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

async function registerWorker(run: string, extra: readonly string[] = []): Promise<void> {
  await execute([
    "agent:register",
    "--run",
    run,
    "--agent",
    "worker-1",
    "--role",
    "implementer",
    "--host",
    "some-host",
    "--parent-agent",
    "coordinator-1",
    "--parent-task",
    "task-1",
    ...extra,
  ]);
}

async function capsuleWithWorker(name: string, extra: readonly string[] = []): Promise<string> {
  const run = await compiledCapsule(roots, name);
  await registerCoordinator(run);
  await registerWorker(run, extra);
  return run;
}

function worker(run: string) {
  return ledgerOf(run).find((grant) => grant.id === "worker-1")!;
}

describe("a tool is a name, a category and an open bag", () => {
  test("records the category the dispatcher declared beside the tool's own name", async () => {
    const run = await capsuleWithWorker("tool-category", [
      "--tool",
      "Read=file-edit",
      "--tool",
      "Bash=shell",
      "--tool-extra",
      "Bash:shell=zsh",
    ]);

    expect(worker(run).tools_granted?.value).toEqual([
      { name: "Read", category: "file-edit" },
      { name: "Bash", category: "shell", extras: { shell: "zsh" } },
    ]);
  });

  test("a tool given without a category has none: no category is read out of a name", async () => {
    const run = await capsuleWithWorker("tool-uncategorised", ["--tool", "cypress"]);
    expect(worker(run).tools_granted?.value).toEqual([{ name: "cypress" }]);
  });

  test("a category outside the seed vocabulary is recorded as given and marked, not rejected", async () => {
    const run = await compiledCapsule(roots, "tool-open-vocabulary");
    await registerCoordinator(run);
    const registered = await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--host",
      "some-host",
      "--tool",
      "Bench=model-evaluation",
    ]);

    expect(worker(run).tools_granted?.value).toEqual([
      { name: "Bench", category: "model-evaluation" },
    ]);
    expect(String(registered.markdown)).toContain("unrecognised category");
  });

  test("a later report may attach the category a first report did not carry", async () => {
    const run = await capsuleWithWorker("tool-late-category");
    await execute(["agent:report", "--run", run, "--agent", "worker-1", "--tool", "Grep"]);
    await execute([
      "agent:report",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--tool",
      "Grep=search",
      "--tool-extra",
      "Grep:engine=literal",
    ]);

    const used = worker(run).tools_used ?? [];
    expect(used).toHaveLength(1);
    expect(used[0]?.name).toBe("Grep");
    expect(used[0]?.category).toBe("search");
    expect(used[0]?.extras).toEqual({ engine: "literal" });
    // The first sighting is when the tool was first seen, not when it was later described.
    expect(used[0]?.first_reported_at).toBe(worker(run).tools_used![0]!.first_reported_at);
  });

  test("extras from separate reports accumulate under the names they were reported by", async () => {
    const run = await capsuleWithWorker("tool-extra-merge");
    await execute([
      "agent:report",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--tool",
      "Bash",
      "--tool-extra",
      "Bash:shell=zsh",
    ]);
    await execute([
      "agent:report",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--tool",
      "Bash",
      "--tool-extra",
      "Bash:cwd=/repo",
    ]);

    expect(worker(run).tools_used?.[0]?.extras).toEqual({ shell: "zsh", cwd: "/repo" });
  });
});

describe("what the tool flags refuse", () => {
  test("a --tool with a blank name or a blank category", async () => {
    const run = await compiledCapsule(roots, "tool-flag-refusals");
    await registerCoordinator(run);
    await expect(registerWorker(run, ["--tool", "Read="])).rejects.toThrow(
      "--tool expects <name>[=<category>]",
    );
    await expect(registerWorker(run, ["--tool", "=file-edit"])).rejects.toThrow(
      "--tool expects <name>[=<category>]",
    );
  });

  test("a --tool-extra that is not <tool>:<key>=<value>", async () => {
    const run = await compiledCapsule(roots, "tool-extra-shape");
    await registerCoordinator(run);
    await expect(registerWorker(run, ["--tool", "Bash", "--tool-extra", "Bash"])).rejects.toThrow(
      "--tool-extra expects <tool>:<key>=<value>",
    );
    await expect(
      registerWorker(run, ["--tool", "Bash", "--tool-extra", "Bash:shell"]),
    ).rejects.toThrow("--tool-extra expects <tool>:<key>=<value>");
  });

  test("a --tool-extra naming a tool that no --tool declared", async () => {
    const run = await compiledCapsule(roots, "tool-extra-orphan");
    await registerCoordinator(run);
    await expect(
      registerWorker(run, ["--tool", "Read", "--tool-extra", "Bash:shell=zsh"]),
    ).rejects.toThrow("--tool-extra names Bash, which no --tool declared");
    await expect(registerWorker(run, ["--tool-extra", "Bash:shell=zsh"])).rejects.toThrow(
      "--tool-extra names Bash, which no --tool declared",
    );
  });

  test("the same tool key reported twice in one call", async () => {
    const run = await compiledCapsule(roots, "tool-extra-duplicate");
    await registerCoordinator(run);
    await expect(
      registerWorker(run, [
        "--tool",
        "Bash",
        "--tool-extra",
        "Bash:shell=zsh",
        "--tool-extra",
        "Bash:shell=bash",
      ]),
    ).rejects.toThrow("names Bash:shell twice");
  });

  test("the same tool declared twice, so a contradicted category is never quietly dropped", async () => {
    const run = await compiledCapsule(roots, "tool-duplicate");
    await registerCoordinator(run);
    await expect(
      registerWorker(run, ["--tool", "Bash=shell", "--tool", "Bash=build"]),
    ).rejects.toThrow("--tool names Bash twice; declare each tool once");
    await expect(registerWorker(run, ["--tool", "Bash", "--tool", "Bash"])).rejects.toThrow(
      "--tool names Bash twice; declare each tool once",
    );
  });
});

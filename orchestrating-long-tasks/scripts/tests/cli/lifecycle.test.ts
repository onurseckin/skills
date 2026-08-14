import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execute } from "../../src/cli/execute.ts";
import { graphDocument } from "../graph/fixtures.ts";
import { requirementsDocument } from "../requirements/fixtures.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), "harness-cli-"));
  roots.push(repo);
  await mkdir(join(repo, ".harness"));
  const prompt = "First\n\nThird";
  const promptPath = join(repo, "prompt.txt");
  const requirementsPath = join(repo, "requirements.json");
  const graphPath = join(repo, "graph.json");
  const requirements = requirementsDocument(prompt);
  await writeFile(promptPath, prompt);
  await writeFile(requirementsPath, JSON.stringify(requirements));
  await writeFile(graphPath, JSON.stringify(graphDocument(requirements)));
  return { repo, promptPath, requirementsPath, graphPath };
}

describe("CLI durable lifecycle", () => {
  test("initializes, applies, schedules, claims, and reports status", async () => {
    const value = await fixture();
    const initialized = await execute([
      "init",
      "--repo",
      value.repo,
      "--run-id",
      "cli-run",
      "--prompt-file",
      value.promptPath,
      "--capture-mode",
      "file",
      "--source-verified",
    ]);
    const runRoot = initialized.run_root as string;
    await execute([
      "plan-apply",
      "--run",
      runRoot,
      "--requirements",
      value.requirementsPath,
      "--graph",
      value.graphPath,
      "--expected-revision",
      "0",
      "--actor",
      "planner",
    ]);
    const ready = await execute(["ready", "--run", runRoot, "--max-parallel", "2"]);
    expect((ready.tasks as { id: string }[]).map(({ id }) => id)).toEqual(["task-1"]);
    const claimed = await execute([
      "claim",
      "--run",
      runRoot,
      "--task",
      "task-1",
      "--agent",
      "worker",
      "--role",
      "implementer",
    ]);
    expect(claimed.token).toBeString();
    const status = await execute(["status", "--run", runRoot]);
    expect(status.counts).toMatchObject({ leased: 1, proposed: 1 });
    expect(status.integrity_issues).toEqual([]);
  });

  test("requires actors for mutations and exactly one prompt source", async () => {
    const value = await fixture();
    await expect(
      execute(
        [
          "init",
          "--repo",
          value.repo,
          "--run-id",
          "cli-run",
          "--prompt-file",
          value.promptPath,
          "--capture-mode",
          "file",
          "--source-verified",
          "--prompt-stdin",
        ],
        { stdin: new TextEncoder().encode("other") },
      ),
    ).rejects.toThrow("exactly one");
    await expect(
      execute([
        "plan-apply",
        "--run",
        "missing",
        "--requirements",
        value.requirementsPath,
        "--graph",
        value.graphPath,
      ]),
    ).rejects.toThrow("actor");
  });

  test("requires revision and concurrency guards instead of using unbounded defaults", async () => {
    const value = await fixture();
    await expect(
      execute([
        "plan-apply",
        "--run",
        "missing",
        "--requirements",
        value.requirementsPath,
        "--graph",
        value.graphPath,
        "--actor",
        "planner",
      ]),
    ).rejects.toThrow("expected-revision");
    await expect(execute(["ready", "--run", "missing"])).rejects.toThrow("max-parallel");
    await expect(
      execute(["schedule", "--run", "missing", "--actor", "coordinator"]),
    ).rejects.toThrow("max-parallel");
    await expect(execute(["projection-recover", "--run", "missing"])).rejects.toThrow("actor");
    await expect(execute(["doctor", "--run", "missing", "--source", value.repo])).rejects.toThrow(
      "source and home",
    );
  });

  test("classifies hostile workflow options as invalid arguments", async () => {
    try {
      await execute([
        "assign-repairer",
        "--run",
        "missing",
        "--task",
        "T-1",
        "--repairer",
        "agent",
        "--reason",
        "invented",
        "--evidence",
        "none",
        "--actor",
        "coordinator",
      ]);
      throw new Error("expected invalid reason to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_ARGUMENT" });
    }
    await expect(
      execute([
        "decide-authority",
        "--run",
        "missing",
        "--requirement",
        "R-1",
        "--actor",
        "coordinator",
        "--decision",
        "invented",
        "--rationale",
        "user decision",
      ]),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  test("schedule promotes dependency-ready proposed tasks before claim", async () => {
    const value = await fixture();
    const graph = JSON.parse(await readFile(value.graphPath, "utf8"));
    graph.nodes.find((node: { id: string }) => node.id === "task-1").status = "proposed";
    await writeFile(value.graphPath, JSON.stringify(graph));
    const initialized = await execute([
      "init",
      "--repo",
      value.repo,
      "--run-id",
      "schedule-run",
      "--prompt-file",
      value.promptPath,
      "--capture-mode",
      "file",
      "--source-verified",
    ]);
    const run = initialized.run_root as string;
    await execute([
      "plan-apply",
      "--run",
      run,
      "--requirements",
      value.requirementsPath,
      "--graph",
      value.graphPath,
      "--expected-revision",
      "0",
      "--actor",
      "planner",
    ]);
    const scheduled = await execute([
      "schedule",
      "--run",
      run,
      "--max-parallel",
      "1",
      "--actor",
      "coordinator",
    ]);
    expect((scheduled.tasks as { id: string; status: string }[])[0]).toMatchObject({
      id: "task-1",
      status: "ready",
    });
    const claim = await execute([
      "claim",
      "--run",
      run,
      "--task",
      "task-1",
      "--agent",
      "worker",
      "--role",
      "implementer",
    ]);
    expect(claim.token).toBeString();
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execute } from "../../src/cli/execute.ts";
import { initRun, loadRun } from "../../src/store/index.ts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("CLI monitored command", () => {
  test("passes literal argv and registers authoritative evidence", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-cli-run-"));
    roots.push(repo);
    const run = initRun(repo, "command-run", new TextEncoder().encode("prompt"), "file", true);
    const result = await execute([
      "run",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--cwd",
      repo,
      "--task",
      "task-1",
      "--gate",
      "gate-1",
      "--wall-ms",
      "5000",
      "--idle-ms",
      "1000",
      "--",
      "bun",
      "-e",
      "console.log(process.argv[1])",
      "literal;$(ignored)",
    ]);
    const record = result.record as Record<string, unknown>;
    expect(record).toMatchObject({
      status: "succeeded",
      task_id: "task-1",
      gate_id: "gate-1",
      actor: "coordinator",
    });
    const stored = loadRun(run).state.commands as Record<string, unknown>;
    expect(stored[record.id as string]).toEqual(record);
  });

  test("requires actor, cwd, and a nonempty literal argv", async () => {
    await expect(
      execute(["run", "--run", "/tmp/no", "--cwd", "/tmp", "--", "true"]),
    ).rejects.toThrow("actor");
    await expect(
      execute(["run", "--run", "/tmp/no", "--actor", "a", "--cwd", "/tmp", "--"]),
    ).rejects.toThrow("argv");
  });
});

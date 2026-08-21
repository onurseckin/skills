import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "../unit/cli/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../unit/cli/file-persistence-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("Harness File Persistence - Evidence Commands", () => {
  test("run:exec keeps the command record as the only evidence document, and evidence:get reads it", async () => {
    const { repo, run } = await setupCompiledRun("exec-persist", roots);

    const execResult = await execute([
      "run:exec",
      "--run",
      run,
      "--cwd",
      repo,
      "--task",
      "task-core",
      "--gate",
      "gate-core",
      "--actor",
      "worker-core",
      "--",
      "echo",
      "hello persistence",
    ]);

    const cmdId = execResult.command_id as string;
    expect(cmdId).toBeString();

    const expectedEvidencePath = join(run, "commands", cmdId, "record.json");
    expect(existsSync(expectedEvidencePath)).toBe(true);
    // The evidence document the old layout wrote beside the record is gone; the record is it.
    expect(existsSync(join(run, "evidence", `${cmdId}.json`))).toBe(false);

    const evidenceRaw = readFileSync(expectedEvidencePath, "utf-8");
    const evidence = JSON.parse(evidenceRaw) as Record<string, unknown>;

    expect(evidence.id).toBe(cmdId);
    expect(evidence.argv).toEqual(["echo", "hello persistence"]);
    expect(evidence.actor).toBe("worker-core");
    expect(evidence.exit_code).toBe(0);
    expect(typeof evidence.started_at).toBe("string");
    expect(evidence.task_id).toBe("task-core");
    expect(evidence.gate_id).toBe("gate-core");

    // Execute another command for coordinator with different gate
    const execResult2 = await execute([
      "run:exec",
      "--run",
      run,
      "--cwd",
      repo,
      "--gate",
      "gate-run-completion",
      "--actor",
      "coordinator",
      "--",
      "echo",
      "coordinator gate",
    ]);
    expect(execResult2.command_id).toBeString();

    // Test evidence:get with specific ID
    const getResult = await execute(["evidence:get", "--run", run, "--id", cmdId]);
    expect(getResult.command_id).toBe(cmdId);
    expect(getResult.path).toBe(`${run}/commands/${cmdId}/record.json`);
    expect(String(getResult.markdown)).toContain(`### Evidence: \`${cmdId}\``);

    // Test evidence:get listing all
    const listResult = await execute(["evidence:get", "--run", run]);
    expect(listResult.count).toBe(2);
    expect(Array.isArray(listResult.evidence)).toBe(true);

    // Test evidence:get filtering by --task
    const taskFiltered = await execute(["evidence:get", "--run", run, "--task", "task-core"]);
    expect(taskFiltered.count).toBe(1);
    expect((taskFiltered.evidence as Record<string, unknown>[])[0]?.id).toBe(cmdId);

    // Test evidence:get filtering by --gate
    const gateFiltered = await execute([
      "evidence:get",
      "--run",
      run,
      "--gate",
      "gate-run-completion",
    ]);
    expect(gateFiltered.count).toBe(1);
    expect((gateFiltered.evidence as Record<string, unknown>[])[0]?.id).toBe(
      execResult2.command_id,
    );

    // Test evidence:get filtering by --actor
    const actorFiltered = await execute(["evidence:get", "--run", run, "--actor", "worker-core"]);
    expect(actorFiltered.count).toBe(1);

    // Test evidence:get filtering with no matches
    const noMatch = await execute(["evidence:get", "--run", run, "--task", "task-nonexistent"]);
    expect(noMatch.count).toBe(0);
  });

  test("inspection commands throw INVALID_ARGUMENT when files do not exist", async () => {
    const { run } = await setupCompiledRun("errors-persist", roots);

    expect(execute(["finding:get", "--run", run, "--id", "nonexistent-finding"])).rejects.toThrow(
      /not recorded/u,
    );
    expect(execute(["report:get", "--run", run, "--task", "nonexistent-task"])).rejects.toThrow(
      /not found/u,
    );
    expect(execute(["evidence:get", "--run", run, "--id", "nonexistent-cmd"])).rejects.toThrow(
      /not recorded/u,
    );
  });
});

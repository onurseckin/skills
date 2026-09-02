import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import type { JsonObject } from "../../../../../olt/scripts/src/core/contracts/index.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";

import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../../olt/scripts/src/runtime/session.ts";

const roots: string[] = [];
beforeEach(() => {
  setupVirtualCliFS();
  enableInMemoryAgentMetadata();
});
afterEach(async () => {
  disableInMemoryAgentMetadata();
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
  roots.length = 0;
});

describe("task:abandon", () => {
  test("closes an open attempt on the coordinator's authority and frees the lease", async () => {
    const { run } = await setupCompiledRun("task-abandon", roots);
    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);

    const result = await execute([
      "task:abandon",
      "--run",
      run,
      "--task",
      "task-core",
      "--actor",
      "coordinator",
      "--reason",
      "worker-1 crashed mid-attempt and will not return",
    ]);

    expect(String(result.markdown)).toContain("### Attempt Abandoned: `task-core`");
    const task = result.task as JsonObject;
    expect(task.status).toBe("retry_ready");
    expect(task.lease).toBeUndefined();
    const attempts = task.attempts as JsonObject[];
    const attempt = attempts.at(-1)!;
    expect(attempt.abandoned_by).toBe("coordinator");
    expect(attempt.abandoned_reason).toBe("worker-1 crashed mid-attempt and will not return");

    const reclaimed = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-2",
      "--role",
      "implementer",
    ]);
    const reclaimedTask = reclaimed.task as JsonObject;
    expect(reclaimedTask.status).toBe("leased");
    expect((reclaimedTask.lease as JsonObject).agent_id).toBe("worker-2");
  });

  test("refuses when the task has no open attempt to abandon", async () => {
    const { run } = await setupCompiledRun("task-abandon-refusal", roots);
    await expect(
      execute([
        "task:abandon",
        "--run",
        run,
        "--task",
        "task-core",
        "--actor",
        "coordinator",
        "--reason",
        "nothing has been claimed yet",
      ]),
    ).rejects.toThrow("no open attempt to abandon");
  });
});

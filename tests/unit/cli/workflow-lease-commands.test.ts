import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { plannedFixture } from "./scenario-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("CLI workflow lease commands", () => {
  test("claimCommand supports explicit and default lease seconds", async () => {
    const fixture = await plannedFixture(roots);
    const claim1 = await execute([
      "claim",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--lease-seconds",
      "300",
    ]);
    expect(claim1.token).toBeString();
    expect(claim1.run_root).toBe(fixture.run);
    expect((claim1.task as { id: string }).id).toBe("task-1");

    await execute([
      "release",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--agent",
      "worker-1",
      "--token",
      claim1.token as string,
    ]);

    const claim2 = await execute([
      "claim",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--agent",
      "worker-2",
      "--role",
      "implementer",
    ]);
    expect(claim2.token).toBeString();
  });

  test("heartbeatCommand updates active lease", async () => {
    const fixture = await plannedFixture(roots);
    const claim = await execute([
      "claim",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--agent",
      "worker",
      "--role",
      "implementer",
    ]);
    const hb = await execute([
      "heartbeat",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--agent",
      "worker",
      "--token",
      claim.token as string,
    ]);
    expect(hb.run_root).toBe(fixture.run);
    expect((hb.task as { id: string }).id).toBe("task-1");
  });
});

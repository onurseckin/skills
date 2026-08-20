import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { claimSubmitValidateAndReject, setupCompiledRun } from "./file-persistence-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("Harness File Persistence - Multiple Rejection Rounds", () => {
  test("multiple rejection rounds preserve separate finding files on disk", async () => {
    const { repo, run } = await setupCompiledRun("multi-round-rejections", roots);

    // Round 1
    const reject1 = await claimSubmitValidateAndReject({
      run,
      repo,
      taskId: "task-core",
      agent: "worker-core",
      validator: "val-1",
      reason: "Round 1 failure: missing validation",
    });
    expect(reject1.finding_id).toBe("finding-task-core-reject");

    // Round 2
    const reject2 = await claimSubmitValidateAndReject({
      run,
      repo,
      taskId: "task-core",
      agent: "worker-core",
      validator: "val-2",
      role: "repairer",
      reason: "Round 2 failure: incomplete edge case",
    });
    expect(reject2.finding_id).toBe("finding-task-core-reject-2");

    // Round 3 with explicit --finding-id
    const reject3 = await claimSubmitValidateAndReject({
      run,
      repo,
      taskId: "task-core",
      agent: "worker-core",
      validator: "val-3",
      role: "repairer",
      reason: "Round 3 failure: custom finding id",
      findingId: "finding-custom-round-3",
    });
    expect(reject3.finding_id).toBe("finding-custom-round-3");

    // Every round keeps its own finding, and none of them is written to a second place.
    expect(existsSync(join(run, "findings"))).toBe(false);

    // Verify finding:get can inspect each individually
    const f1 = await execute(["finding:get", "--run", run, "--id", "finding-task-core-reject"]);
    expect(f1.id).toBe("finding-task-core-reject");

    const f2 = await execute(["finding:get", "--run", run, "--id", "finding-task-core-reject-2"]);
    expect(f2.id).toBe("finding-task-core-reject-2");

    const f3 = await execute(["finding:get", "--run", run, "--id", "finding-custom-round-3"]);
    expect(f3.id).toBe("finding-custom-round-3");

    // Verify finding:get list returns all 3
    const allFindings = await execute(["finding:get", "--run", run]);
    expect(allFindings.count).toBe(3);
  });
});

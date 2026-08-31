import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import { criticRemediateCommand } from "../../../../olt/scripts/src/cli/commands/critic-ops.ts";
import { cleanupRoots } from "../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../fixtures/task-ops-fixture.ts";
import { reviewedFindingsRun } from "./critic-remediate-core.test.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("critic:remediate - Task & Authorization Errors", () => {
  test("rejects when no completion review is recorded for the run", async () => {
    const { run } = await setupCompiledRun("critic-remediate-no-review", roots);
    expect(() =>
      criticRemediateCommand({
        run,
        actor: "coordinator",
        resolve: ["F-ANY=C-1"],
      }),
    ).toThrow("no completion review is recorded for this run");
  });

  test("rejects when the completion review already approved the run", async () => {
    const { run } = await setupCompiledRun("critic-remediate-approved", roots);
    expect(() =>
      criticRemediateCommand({
        run,
        actor: "coordinator",
        resolve: ["F-ANY=C-1"],
      }),
    ).toThrow("no completion review is recorded for this run");
  });

  test("rejects when a resolving command id is not recorded in the capsule", async () => {
    const { run, findingId } = await reviewedFindingsRun("missing-command", roots);
    expect(() =>
      criticRemediateCommand({
        run,
        actor: "coordinator",
        resolve: [`${findingId}=C-DOES-NOT-EXIST`],
        "resolution-method": [`${findingId}=failed attempt`],
      }),
    ).toThrow("remediation command evidence is invalid");
  });

  test("rejects an actor not authorized to remediate via CLI execution", async () => {
    const { run, findingId } = await reviewedFindingsRun("unauthorized-actor", roots);
    await expect(
      execute([
        "critic:remediate",
        "--run",
        run,
        "--actor",
        "worker-1",
        "--resolve",
        `${findingId}=C-FIX`,
        "--resolution-method",
        `${findingId}=unauthorized attempt`,
      ]),
    ).rejects.toThrow();
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { transact } from "../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { cleanupRoots, successfulCommand, writeJson } from "./full-lifecycle-fixture.ts";
import { claimAndSubmit, plannedFixture } from "./scenario-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function beginAndReview(
  run: string,
  repo: string,
  validator: string,
  review: Record<string, unknown>,
) {
  const validation = await execute([
    "begin-validation",
    "--run",
    run,
    "--task",
    "task-1",
    "--validator",
    validator,
  ]);
  await execute([
    "packet",
    "--run",
    run,
    "--task",
    "task-1",
    "--role",
    "validator",
    "--agent",
    validator,
    "--token",
    validation.token as string,
    "--id",
    `task-1-${validator}`,
  ]);
  const commandId = await successfulCommand(run, repo, validator, "task-1", "gate-required");
  const reviewPath = await writeJson(repo, `${validator}-review.json`, {
    ...review,
    checks: [{ command_id: commandId, result: "passed" }],
  });
  return execute([
    "review",
    "--run",
    run,
    "--task",
    "task-1",
    "--validator",
    validator,
    "--token",
    validation.token as string,
    "--review",
    reviewPath,
  ]).then((result) => ({ result, commandId }));
}

describe("CLI repair and stale-evidence recovery", () => {
  test("routes a structured rejection through repair and fresh revalidation", async () => {
    const fixture = await plannedFixture(roots);
    await claimAndSubmit(fixture, "implementer", "implementer");
    const rejected = await beginAndReview(fixture.run, fixture.repo, "validator-1", {
      verdict: "reject",
      requirement_ids: ["R-001"],
      findings: [
        {
          id: "F-1",
          requirement_id: "R-001",
          severity: "important",
          observation: "coverage is missing",
          evidence: [{ path: "src/area-1" }],
          remediation: "add focused coverage",
          revalidation: "rerun the validator command",
        },
      ],
    });
    expect((rejected.result.task as { status: string }).status).toBe("changes_requested");

    await claimAndSubmit(fixture, "implementer", "repairer");
    const validation = await execute([
      "begin-validation",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--validator",
      "validator-2",
    ]);
    await execute([
      "packet",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--role",
      "validator",
      "--agent",
      "validator-2",
      "--token",
      validation.token as string,
      "--id",
      "task-1-validator-2",
    ]);
    const commandId = await successfulCommand(
      fixture.run,
      fixture.repo,
      "validator-2",
      "task-1",
      "gate-required",
    );
    const reviewPath = await writeJson(fixture.repo, "validator-2-review.json", {
      verdict: "pass",
      requirement_ids: ["R-001"],
      checks: [{ command_id: commandId, result: "passed" }],
      findings: [],
      resolved_findings: [
        {
          finding_id: "F-1",
          method: "independent rerun",
          evidence: [{ command_id: commandId }],
        },
      ],
    });
    const accepted = await execute([
      "review",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--validator",
      "validator-2",
      "--token",
      validation.token as string,
      "--review",
      reviewPath,
    ]);
    expect(accepted.task).toMatchObject({
      status: "validated",
      findings: [{ id: "F-1", status: "resolved" }],
    });
  });

  test("preserves a late authenticated report as orphan evidence after stale recovery", async () => {
    const fixture = await plannedFixture(roots);
    const claim = await execute([
      "claim",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--agent",
      "slow-agent",
      "--role",
      "implementer",
      "--lease-seconds",
      "5",
    ]);
    await execute([
      "packet",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--role",
      "implementer",
      "--agent",
      "slow-agent",
      "--token",
      claim.token as string,
      "--id",
      "task-1-slow-agent",
    ]);
    transact(fixture.run, "test-clock", "lease-expired", {}, (state) => {
      const tasks = state.tasks as Record<string, Record<string, unknown>>;
      const lease = tasks["task-1"]!.lease as Record<string, unknown>;
      lease.expires_at = "2000-01-01T00:00:00.000Z";
    });
    await execute([
      "recover",
      "--run",
      fixture.run,
      "--actor",
      "coordinator",
      "--grace-seconds",
      "0",
    ]);
    const late = await execute([
      "submit",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--agent",
      "slow-agent",
      "--token",
      claim.token as string,
      "--report",
      fixture.reportPath,
    ]);
    expect(late.orphaned).toBeTrue();
    const status = await execute(["status", "--run", fixture.run]);
    expect(status.orphan_evidence as unknown[]).toHaveLength(1);
    expect(
      (status.completion_blockers as string[]).some((issue) =>
        issue.includes("orphan evidence is open"),
      ),
    ).toBeTrue();
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { requirementIds, setupReadyRun } from "./critic-run-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("critic:remediate", () => {
  test("closes out a findings review with command-backed resolutions", async () => {
    const { repo, run } = await setupReadyRun("critic-remediate-run", roots);

    const inspect = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "critic-1",
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-t1.ts",
    ]);

    const start = await execute([
      "critic:start",
      "--run",
      run,
      "--critic",
      "critic-1",
      "--repository-command-ids",
      inspect.command_id as string,
    ]);

    const review = await execute([
      "critic:review",
      "--run",
      run,
      "--critic",
      "critic-1",
      "--token",
      start.token as string,
      "--decision",
      "request_changes",
      "--summary",
      "Missing integration check",
      "--findings",
      JSON.stringify([
        {
          id: "F-CRITIC-01",
          requirement_id: requirementIds(run)[0],
          severity: "important",
          observation: "No test covers the cross-module edge case",
          remediation: "Add a test for the cross-module edge case",
          revalidation: "bun test tests",
        },
      ]),
    ]);
    expect(review.decision).toBe("request_changes");
    const reviewSha = (review.completion_review as { review_sha256: string }).review_sha256;

    const doctorBefore = await execute(["doctor", "--run", run]);
    expect(doctorBefore.issues).toContain("completeness critic has unresolved finding F-CRITIC-01");

    const fixCommand = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--cwd",
      repo,
      "--",
      "bun",
      "test",
      "tests",
    ]);

    const remediated = await execute([
      "critic:remediate",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--resolve",
      `F-CRITIC-01=${fixCommand.command_id as string}`,
      "--resolution-method",
      "F-CRITIC-01=focused repair and verification",
    ]);
    expect(String(remediated.markdown)).toContain("### Completion Findings Remediated");
    const remediation = remediated.remediation as {
      review_sha256: string;
      resolutions: { finding_id: string; method: string; command_ids: string[] }[];
    };
    expect(remediation.review_sha256).toBe(reviewSha);
    expect(remediation.resolutions).toEqual([
      {
        finding_id: "F-CRITIC-01",
        method: "focused repair and verification",
        command_ids: [fixCommand.command_id as string],
      },
    ]);

    const persisted = loadRun(run).state.completion_remediations;
    expect(persisted).toHaveLength(1);
    expect(persisted![0]!.review_sha256).toBe(reviewSha);

    // The review still stays in history and unresolved: a fresh critic pass, not this remediation
    // record alone, is what clears "completeness critic has unresolved finding" from doctor.
    const doctorAfter = await execute(["doctor", "--run", run]);
    expect(doctorAfter.issues).toContain("completeness critic has unresolved finding F-CRITIC-01");
    expect(doctorAfter.issues).not.toContain(
      "completion findings review 1 lacks exact remediation",
    );
  });

  test("refuses to remediate a review it does not match", async () => {
    const { run } = await setupReadyRun("critic-remediate-no-review", roots);
    await expect(
      execute([
        "critic:remediate",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--review-sha256",
        "0".repeat(64),
        "--resolve",
        "F-1=C-does-not-exist",
        "--resolution-method",
        "F-1=n/a",
      ]),
    ).rejects.toThrow();
  });
});

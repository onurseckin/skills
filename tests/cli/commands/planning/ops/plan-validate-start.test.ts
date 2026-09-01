import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { planReviewCommand } from "../../../../../olt/scripts/src/cli/commands/plan-validate.ts";
import { cleanupRoots } from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

function passAnswers(): string[] {
  return [
    "--decomposition-answer",
    "Two tasks match the two named topics",
    "--dependency-answer",
    "task-sec genuinely reads task-core's fixtures",
    "--gate-answer",
    "each gate runs only that task's own scoped tests",
    "--straggler-answer",
    "effort is evenly split between the two tasks",
    "--dependency-edges-reviewed",
    "task-sec:task-core",
    "--gate-ids-reviewed",
    "gate-core,gate-sec",
  ];
}

describe("plan:validate-start and plan:review - Validation Lifecycle", () => {
  test("happy path: start creates an attempt, review approves and seals plan", async () => {
    const { run } = await setupCompiledRun("plan-val-happy", roots);
    const started = await execute([
      "plan:validate-start",
      "--run",
      run,
      "--validator",
      "plan-val-1",
    ]);
    expect(started.run_root).toBe(run);
    expect(typeof started.token).toBe("string");
    expect(started.graph_revision).toBe(1);

    const reviewed = await execute([
      "plan:review",
      "--run",
      run,
      "--validator",
      "plan-val-1",
      "--token",
      started.token as string,
      "--status",
      "approved",
      "--summary",
      "Two tasks, clean boundaries, full coverage",
      ...passAnswers(),
    ]);
    expect(reviewed.verdict).toBe("approved");
    expect(reviewed.graph_revision).toBe(1);
    expect(String(reviewed.markdown)).toContain("### Plan Validation Approved:");
  });

  test("happy path: review requests changes with findings and re-arms planning", async () => {
    const { run } = await setupCompiledRun("plan-val-changes", roots);
    const started = await execute([
      "plan:validate-start",
      "--run",
      run,
      "--validator",
      "plan-val-1",
    ]);

    const findings = [
      {
        id: "PV-1",
        invariant: "A1-granularity",
        severity: "important",
        observation: "task-core is too broad",
        remediation: "split task-core into core and auth",
      },
    ];

    const reviewed = await execute([
      "plan:review",
      "--run",
      run,
      "--validator",
      "plan-val-1",
      "--token",
      started.token as string,
      "--status",
      "changes_requested",
      "--summary",
      "Needs finer task granularity",
      ...passAnswers(),
      "--findings",
      JSON.stringify(findings),
    ]);
    expect(reviewed.verdict).toBe("changes_requested");
    expect(reviewed.findings).toBeDefined();
    expect(String(reviewed.markdown)).toContain("### Plan Validation Rejected:");
  });

  test("rejects plan:validate-start with unrecognised validator agent", async () => {
    const { run } = await setupCompiledRun("plan-val-bad-agent", roots);
    await expect(
      execute(["plan:validate-start", "--run", run, "--validator", "impostor-agent"]),
    ).rejects.toThrow();
  });

  test("rejects review with wrong validator token", async () => {
    const { run } = await setupCompiledRun("plan-val-bad-token", roots);
    await execute(["plan:validate-start", "--run", run, "--validator", "plan-val-1"]);
    await expect(
      execute([
        "plan:review",
        "--run",
        run,
        "--validator",
        "plan-val-1",
        "--token",
        "invalid-token-here",
        "--status",
        "approved",
        "--summary",
        "Looks good",
        ...passAnswers(),
      ]),
    ).rejects.toThrow();
  });

  test("rejects malformed inline --findings JSON", async () => {
    await expect(
      planReviewCommand({
        run: "/tmp/malformed-inline-findings",
        validator: "plan-val-1",
        token: "unused-token",
        status: "changes_requested",
        summary: "Bad findings JSON",
        "decomposition-answer": "n/a",
        "dependency-answer": "n/a",
        "gate-answer": "n/a",
        "straggler-answer": "n/a",
        findings: "{ not valid json",
      }),
    ).rejects.toThrow(/--findings is not valid JSON/);
  });
});

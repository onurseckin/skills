import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";

const roots: string[] = [];

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

describe("plan:review - Edge Cases & Guard Verification", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

  test("--findings-file reads a JSON payload from disk", async () => {
    const { repo, run } = await setupCompiledRun("plan-review-findings-file", roots);
    const started = await execute([
      "plan:validate-start",
      "--run",
      run,
      "--validator",
      "plan-val-1",
    ]);
    const findingsPath = join(repo, "findings.json");
    await writeFile(
      findingsPath,
      JSON.stringify([
        {
          id: "PV-2",
          invariant: "A1-granularity",
          severity: "important",
          observation: "from a file",
          remediation: "fix it",
        },
      ]),
    );
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
      "See attached findings",
      ...passAnswers(),
      "--findings-file",
      findingsPath,
    ]);
    expect((reviewed.findings as { id: string }[])[0]!.id).toBe("PV-2");
  });

  test("an approval omitting the real dependency edge is refused", async () => {
    const { run } = await setupCompiledRun("plan-review-missing-edge", roots);
    const started = await execute([
      "plan:validate-start",
      "--run",
      run,
      "--validator",
      "plan-val-1",
    ]);
    await expect(
      execute([
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
        "Sound",
        "--decomposition-answer",
        "Two tasks match the two named topics",
        "--dependency-answer",
        "task-sec genuinely reads task-core's fixtures",
        "--gate-answer",
        "each gate runs only that task's own scoped tests",
        "--straggler-answer",
        "effort is evenly split between the two tasks",
        "--gate-ids-reviewed",
        "gate-core,gate-sec",
      ]),
    ).rejects.toThrow(/dependency_edges_reviewed omits real edges/);
  });

  test("an approval naming a dependency edge the plan does not declare is refused", async () => {
    const { run } = await setupCompiledRun("plan-review-fabricated-edge", roots);
    const started = await execute([
      "plan:validate-start",
      "--run",
      run,
      "--validator",
      "plan-val-1",
    ]);
    await expect(
      execute([
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
        "Sound",
        "--decomposition-answer",
        "Two tasks match the two named topics",
        "--dependency-answer",
        "task-sec genuinely reads task-core's fixtures",
        "--gate-answer",
        "each gate runs only that task's own scoped tests",
        "--straggler-answer",
        "effort is evenly split between the two tasks",
        "--dependency-edges-reviewed",
        "task-sec:task-core,task-core:task-sec",
        "--gate-ids-reviewed",
        "gate-core,gate-sec",
      ]),
    ).rejects.toThrow(/dependency_edges_reviewed names edges the compiled plan does not declare/);
  });

  test("an approval omitting a real gate id is refused", async () => {
    const { run } = await setupCompiledRun("plan-review-missing-gate", roots);
    const started = await execute([
      "plan:validate-start",
      "--run",
      run,
      "--validator",
      "plan-val-1",
    ]);
    await expect(
      execute([
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
        "Sound",
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
        "gate-core",
      ]),
    ).rejects.toThrow(/gate_ids_reviewed omits mandatory gates/);
  });

  test("the run-scoped completion gate is never demanded from --gate-ids-reviewed", async () => {
    const { run } = await setupCompiledRun("plan-review-no-completion-gate", roots);
    const started = await execute([
      "plan:validate-start",
      "--run",
      run,
      "--validator",
      "plan-val-1",
    ]);
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
      "Sound",
      ...passAnswers(),
    ]);
    expect(reviewed.verdict).toBe("approved");
    const review = reviewed.plan_review as { gate_ids_reviewed: string[] };
    expect(review.gate_ids_reviewed.sort()).toEqual(["gate-core", "gate-sec"]);
  });

  test("rejects malformed --dependency-edges-reviewed entries", async () => {
    const { run } = await setupCompiledRun("plan-review-bad-edge", roots);
    const started = await execute([
      "plan:validate-start",
      "--run",
      run,
      "--validator",
      "plan-val-1",
    ]);

    await expect(
      execute([
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
        "Sound",
        "--decomposition-answer",
        "ans",
        "--dependency-answer",
        "ans",
        "--gate-answer",
        "ans",
        "--straggler-answer",
        "ans",
        "--dependency-edges-reviewed",
        "malformed_pair_without_colon",
      ]),
    ).rejects.toThrow(/--dependency-edges-reviewed entries must be "<from>:<to>"/);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";

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
  ];
}

describe("plan:validate-start", () => {
  test("mints a validation token bound to the current graph revision", async () => {
    const { run } = await setupCompiledRun("plan-validate-start", roots);
    const started = await execute([
      "plan:validate-start",
      "--run",
      run,
      "--validator",
      "plan-val-1",
    ]);
    expect(typeof started.token).toBe("string");
    expect(started.graph_revision).toBe(1);
    expect(started.packet_id).toBeDefined();
    expect(String(started.markdown)).toContain("plan-val-1");
  });

  test("honours a custom --lease-duration", async () => {
    const { run } = await setupCompiledRun("plan-validate-lease", roots);
    const started = await execute([
      "plan:validate-start",
      "--run",
      run,
      "--validator",
      "plan-val-1",
      "--lease-duration",
      "600",
    ]);
    expect(typeof started.token).toBe("string");
  });
});

describe("plan:review", () => {
  test("--status must be approved or changes_requested", async () => {
    const { run } = await setupCompiledRun("plan-review-bad-status", roots);
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
        "maybe",
        "--summary",
        "x",
        ...passAnswers(),
      ]),
    ).rejects.toThrow(/--status must be approved or changes_requested/);
  });

  test("an approved verdict cannot carry findings", async () => {
    const { run } = await setupCompiledRun("plan-review-approved-findings", roots);
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
        "Looks good",
        ...passAnswers(),
        "--findings",
        JSON.stringify([{ id: "PV-1", severity: "critical", observation: "x", remediation: "y" }]),
      ]),
    ).rejects.toThrow(/cannot carry findings/);
  });

  test("changes_requested requires --findings or --findings-file", async () => {
    const { run } = await setupCompiledRun("plan-review-missing-findings", roots);
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
        "changes_requested",
        "--summary",
        "Needs work",
        ...passAnswers(),
      ]),
    ).rejects.toThrow(/requires --findings or --findings-file/);
  });

  test("records an approved verdict with all four mandatory answers", async () => {
    const { run } = await setupCompiledRun("plan-review-approved", roots);
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
      "Decomposition matches the prompt",
      ...passAnswers(),
    ]);
    expect(reviewed.verdict).toBe("approved");
    const review = reviewed.plan_review as { status: string };
    expect(review.status).toBe("approved");
  });

  test("records a changes_requested verdict with inline --findings JSON", async () => {
    const { run } = await setupCompiledRun("plan-review-changes-requested", roots);
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
      "changes_requested",
      "--summary",
      "Compressed decomposition",
      ...passAnswers(),
      "--findings",
      JSON.stringify([
        {
          id: "PV-1",
          invariant: "A2-parallelism",
          severity: "critical",
          observation: "topics collapsed into one task",
          remediation: "one task per topic",
        },
      ]),
    ]);
    expect(reviewed.verdict).toBe("changes_requested");
    expect((reviewed.findings as unknown[]).length).toBe(1);
  });

  test("an unreadable --findings-file is refused with the underlying error", async () => {
    const { run } = await setupCompiledRun("plan-review-findings-file-missing", roots);
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
        "changes_requested",
        "--summary",
        "See attached findings",
        ...passAnswers(),
        "--findings-file",
        "/does/not/exist/findings.json",
      ]),
    ).rejects.toThrow(/cannot read --findings-file/);
  });

  test("malformed inline --findings JSON is refused", async () => {
    const { run } = await setupCompiledRun("plan-review-findings-malformed", roots);
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
        "changes_requested",
        "--summary",
        "Bad findings JSON",
        ...passAnswers(),
        "--findings",
        "{ not valid json",
      ]),
    ).rejects.toThrow(/--findings is not valid JSON/);
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
});

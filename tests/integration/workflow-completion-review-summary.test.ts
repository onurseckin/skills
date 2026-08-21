import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { loadRun } from "../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { requirementIds, setupReadyRun } from "../unit/cli/critic-run-fixture.ts";
import { cleanupRoots } from "../unit/cli/full-lifecycle-fixture.ts";

// B21: recording the completion review is the run's final lifecycle closure. Before this, the
// CLI's --summary flag was already required but its value only ever reached a side report file and
// the markdown brief — never the durable, hash-chained CompletionReview the run actually completes
// against. `recordCompletionReview` never validated or stored it at all. A completion review is now
// refused outright when it carries no summary, and the CLI can no longer drop the flag's own value.
//
// These two cases drive the real CLI end to end against a real capsule (setupReadyRun), so they
// live here rather than with the in-memory domain tests for the same behavior in
// tests/unit/workflow/completion-review-summary.test.ts.

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("B21: completion review refuses without a summary, before touching the store", () => {
  test("CLI: --summary is required", async () => {
    const { run } = await setupReadyRun("b21-review-cli-missing-summary", roots);
    await expect(
      execute([
        "critic:review",
        "--run",
        run,
        "--critic",
        "critic-1",
        "--token",
        "irrelevant",
        "--decision",
        "approve",
      ]),
    ).rejects.toThrow("--summary is required");
  });
});

describe("B21.3: the critic's summary is durably recorded, not only reported to a side file", () => {
  test("critic:review persists the summary onto completion_review.summary", async () => {
    const { repo, run } = await setupReadyRun("b21-review-persists-summary", roots);

    const execInspect = await execute([
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
    const cmdId = execInspect.command_id as string;

    const start = await execute([
      "critic:start",
      "--run",
      run,
      "--critic",
      "critic-1",
      "--repository-command-ids",
      cmdId,
    ]);

    const evidence = [{ kind: "command", reference: cmdId, observation: "gate covers it" }];
    const proofs = JSON.stringify(
      requirementIds(run).map((id) => ({ requirement_id: id, status: "satisfied", evidence })),
    );
    const spokenSummary = "Whole diff verified: parser, gate and requirement R-1 all check out";

    const review = await execute([
      "critic:review",
      "--run",
      run,
      "--critic",
      "critic-1",
      "--token",
      start.token as string,
      "--decision",
      "approve",
      "--proofs",
      proofs,
      "--summary",
      spokenSummary,
    ]);

    // Before this fix, `reviewPayload` never carried `summary` at all — the value stopped at the
    // CLI's local variable and the side `reports/critic-review.json` file. This is the actual
    // regression the fix closes: the durable, hashed record itself now carries the account.
    const recorded = review.completion_review as { summary?: string };
    expect(recorded.summary).toBe(spokenSummary);

    const persisted = loadRun(run).state.completion_review;
    expect(persisted?.summary).toBe(spokenSummary);
  });
});

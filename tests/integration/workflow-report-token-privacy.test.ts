import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { tokenDigest } from "../../orchestrating-long-tasks/scripts/src/workflow/lease/token.ts";
import { cleanupRoots } from "../unit/cli/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../unit/cli/file-persistence-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

function fileText(path: string): string {
  return readFileSync(path, "utf-8");
}

describe("bearer tokens in persisted reports", () => {
  test("a submission report carries the lease digest, never the lease token", async () => {
    const { repo, run } = await setupCompiledRun("token-privacy-submit", roots);
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-core",
      "--role",
      "implementer",
    ]);
    const workerToken = claim.token as string;

    // C4: task:submit refuses a submission whose write scope is byte-identical to its content at
    // claim, so the declared file has to actually exist and differ before it is claimed as changed.
    mkdirSync(join(repo, "tests/unit/core"), { recursive: true });
    writeFileSync(join(repo, "tests/unit/core/impl.ts"), "export const implemented = true;\n");
    await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      "task-core",
      "--actor",
      "worker-core",
      "--cwd",
      repo,
      "--",
      "echo",
      "implementer-work",
    ]);
    await execute([
      "task:submit",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-core",
      "--token",
      workerToken,
      "--files-changed",
      "tests/unit/core/impl.ts",
      "--summary",
      "Implemented the task under test",
    ]);

    const raw = fileText(join(run, "reports", "task-core-submission.json"));
    expect(raw).not.toContain(workerToken);
    const report = JSON.parse(raw) as { token_digest: string; token?: string };
    expect(report.token_digest).toBe(tokenDigest(workerToken));
    expect(report.token).toBeUndefined();
  });

  test("a critic report carries the critic digest, never the critic token", async () => {
    const { repo, run } = await setupCompiledRun("token-privacy-critic", roots);
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-core",
      "--role",
      "implementer",
    ]);
    // C4: task:submit refuses a submission whose write scope is byte-identical to its content at
    // claim, so the declared file has to actually exist and differ before it is claimed as changed.
    mkdirSync(join(repo, "tests/unit/core"), { recursive: true });
    writeFileSync(join(repo, "tests/unit/core/impl.ts"), "export const implemented = true;\n");
    await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      "task-core",
      "--actor",
      "worker-core",
      "--cwd",
      repo,
      "--",
      "echo",
      "implementer-work",
    ]);
    await execute([
      "task:submit",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-core",
      "--token",
      claim.token as string,
      "--files-changed",
      "tests/unit/core/impl.ts",
      "--summary",
      "Implemented the task under test",
    ]);
    const valStart = await execute([
      "task:validate-start",
      "--run",
      run,
      "--task",
      "task-core",
      "--validator",
      "val-agent-1",
    ]);
    const gate = await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      "task-core",
      "--gate",
      "gate-core",
      "--actor",
      "val-agent-1",
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-core.ts",
    ]);
    const probe = await execute([
      "task:probe",
      "--run",
      run,
      "--task",
      "task-core",
      "--validator",
      "val-agent-1",
      "--token",
      valStart.token as string,
      "--demand",
      "Prove the gate fails when the implementation regresses",
    ]);
    await execute([
      "task:review",
      "--run",
      run,
      "--task",
      "task-core",
      "--validator",
      "val-agent-1",
      "--token",
      valStart.token as string,
      "--evidence",
      gate.command_id as string,
      "--resolve",
      `${(probe.finding_ids as string[])[0]}=${gate.command_id as string}`,
      "--status",
      "pass",
    ]);
    await execute([
      "run:exec",
      "--run",
      run,
      "--gate",
      "gate-run-completion",
      "--actor",
      "coordinator",
      "--cwd",
      repo,
      "--",
      "bun",
      "test",
      "tests",
    ]);
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
      "gate-core.ts",
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
    const criticToken = start.token as string;

    await execute([
      "critic:review",
      "--run",
      run,
      "--critic",
      "critic-1",
      "--token",
      criticToken,
      "--decision",
      "request_changes",
      "--summary",
      "Requirements are not yet proved",
      "--findings",
      JSON.stringify([
        {
          id: "F-PROOF-01",
          requirement_id: "req-core",
          severity: "important",
          observation: "No requirement carries a proof the critic verified",
          remediation: "Prove each requirement against a recorded command",
          revalidation: "bun test tests",
        },
      ]),
    ]);

    const raw = fileText(join(run, "reports", "critic-review.json"));
    expect(raw).not.toContain(criticToken);
    const report = JSON.parse(raw) as {
      critic_token_digest: string;
      token?: string;
      completion_review: { requirement_proofs: { status: string }[] };
    };
    expect(report.critic_token_digest).toBe(tokenDigest(criticToken));
    expect(report.token).toBeUndefined();
    // The critic proved nothing, so every requirement is recorded unproven rather than satisfied.
    expect(report.completion_review.requirement_proofs.map((proof) => proof.status)).not.toContain(
      "satisfied",
    );
  });
});

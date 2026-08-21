import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { loadRun, transact } from "../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { orphanEvidenceSha256 } from "../../orchestrating-long-tasks/scripts/src/workflow/orphan-evidence/digest.ts";
import type { WorkflowState } from "../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { cleanupRoots } from "../unit/cli/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../unit/cli/task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

// Already in the past relative to any real clock the CLI's systemClock could report, so seeding
// a lease with this expiry reads as expired the instant it is written.
const ALREADY_EXPIRED = "2000-01-01T00:00:00.000Z";

describe("orphan:dispose", () => {
  test("closes orphan evidence left behind by a submission against an expired lease", async () => {
    const { repo, run } = await setupCompiledRun("orphan-dispose-run", roots);

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
      "--lease-seconds",
      "5",
    ]);
    const workerToken = claim.token as string;

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

    // task:submit's orphan check (workflow/submission/submit.ts) compares the lease's expires_at
    // against the real clock, not anything injectable through the CLI. Seeding the projection
    // directly with an already-past expiry is equivalent to actually waiting out the 5-second
    // lease, without spending real wall-clock time doing it.
    transact(run, "test-fixture", "test-lease-forced-expiry", {}, (draft) => {
      const state = draft as unknown as WorkflowState;
      const task = state.tasks["task-core"];
      if (!task?.lease) {
        throw new Error("expected task-core to hold a lease before forcing its expiry");
      }
      task.lease.expires_at = ALREADY_EXPIRED;
    });

    const submit = await execute([
      "task:submit",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-core",
      "--token",
      workerToken,
      "--summary",
      "Core tests implemented",
      "--files-changed",
      "tests/unit/core/impl.ts",
    ]);
    expect(submit.orphaned).toBe(true);

    const orphan = loadRun(run).state.orphan_evidence[0] as Record<string, unknown>;
    const orphanSha = orphanEvidenceSha256(orphan);

    const doctorBefore = await execute(["doctor", "--run", run]);
    expect(doctorBefore.issues).toContain(`orphan evidence is open: ${orphanSha}`);

    const evidenceCommand = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--cwd",
      repo,
      "--",
      "echo",
      "orphan-triage",
    ]);

    const disposed = await execute([
      "orphan:dispose",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--orphan-sha256",
      orphanSha,
      "--disposition",
      "ignored_non_authoritative",
      "--rationale",
      "worker-core's lease expired before it submitted; the work was re-dispatched under a fresh lease",
      "--evidence",
      evidenceCommand.command_id as string,
    ]);
    expect(String(disposed.markdown)).toContain("### Orphan Evidence Dispositioned");
    expect((disposed.disposition as { disposition: string }).disposition).toBe(
      "ignored_non_authoritative",
    );

    const doctorAfter = await execute(["doctor", "--run", run]);
    expect(doctorAfter.issues).not.toContain(`orphan evidence is open: ${orphanSha}`);

    // A disposed orphan cannot be dispositioned twice.
    await expect(
      execute([
        "orphan:dispose",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--orphan-sha256",
        orphanSha,
        "--disposition",
        "rejected",
        "--rationale",
        "second attempt",
        "--evidence",
        evidenceCommand.command_id as string,
      ]),
    ).rejects.toThrow("orphan evidence is already dispositioned");
  });
});

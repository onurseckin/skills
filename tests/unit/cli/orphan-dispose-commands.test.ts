import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { orphanEvidenceSha256 } from "../../../orchestrating-long-tasks/scripts/src/workflow/orphan-evidence/digest.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

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

    await Bun.sleep(5_500);

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
    expect(
      (disposed.disposition as { disposition: string }).disposition,
    ).toBe("ignored_non_authoritative");

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
  }, 15_000);
});

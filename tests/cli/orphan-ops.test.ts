import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../olt/scripts/src/cli/execute.ts";
import { transact, loadRun } from "../../olt/scripts/src/engine/store/index.ts";
import { orphanEvidenceSha256 } from "../../olt/scripts/src/workflow/orphan-evidence/digest.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

// orphan-ops.ts's own command only reads and disposes recorded orphan_evidence; how that evidence
// got there (a stale/expired lease recovered mid-submit) is task-claim.ts's concern and is covered
// by that command's own tests. Seeding it directly here — the same technique already used for the
// plan:replan completion_critic-expiry test — isolates orphan:dispose's own branches without
// re-deriving a real lease expiry through the clock.
async function seedOrphanEvidence(run: string): Promise<string> {
  let sha = "";
  transact(run, "test-seed", "seed-orphan-evidence-for-test", {}, (state) => {
    const entry = {
      task_id: "task-core",
      agent_id: "worker-ghost",
      attempt: 1,
      reason: "expired_lease" as const,
      received_at: "2026-01-01T00:00:00.000Z",
      report_sha256: "0".repeat(64),
      report: { summary: "orphaned work" },
    };
    state.orphan_evidence ??= [];
    (state.orphan_evidence as unknown[]).push(entry);
    sha = orphanEvidenceSha256(entry);
  });
  return sha;
}

describe("orphan:dispose", () => {
  test("dispositions a recorded orphan with a rationale and cited evidence", async () => {
    const { run } = await setupCompiledRun("orphan-dispose-basic", roots);
    const sha = await seedOrphanEvidence(run);

    const disposed = await execute([
      "orphan:dispose",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--orphan-sha256",
      sha,
      "--disposition",
      "ignored_non_authoritative",
      "--rationale",
      "worker-ghost died before submitting; nothing depends on this evidence",
      "--evidence",
      "C-somecommand",
    ]);
    const disposition = disposed.disposition as { disposition: string; rationale: string };
    expect(disposition.disposition).toBe("ignored_non_authoritative");
    expect(String(disposed.markdown)).toContain(sha);

    const state = loadRun(run).state as unknown as {
      orphan_evidence_dispositions: { orphan_sha256: string }[];
    };
    expect(state.orphan_evidence_dispositions.some((d) => d.orphan_sha256 === sha)).toBe(true);
  });

  test("refuses to disposition an orphan sha256 the run never recorded", async () => {
    const { run } = await setupCompiledRun("orphan-dispose-missing", roots);
    await expect(
      execute([
        "orphan:dispose",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--orphan-sha256",
        "f".repeat(64),
        "--disposition",
        "rejected",
        "--rationale",
        "does not exist",
        "--evidence",
        "C-x",
      ]),
    ).rejects.toThrow(/orphan evidence does not exist/);
  });

  test("refuses a disposition that is not one of the terminal values", async () => {
    const { run } = await setupCompiledRun("orphan-dispose-bad-disposition", roots);
    const sha = await seedOrphanEvidence(run);
    await expect(
      execute([
        "orphan:dispose",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--orphan-sha256",
        sha,
        "--disposition",
        "shrugged_off",
        "--rationale",
        "whatever",
        "--evidence",
        "C-x",
      ]),
    ).rejects.toThrow(/orphan disposition is invalid/);
  });

  test("refuses dispositioning the same orphan twice", async () => {
    const { run } = await setupCompiledRun("orphan-dispose-twice", roots);
    const sha = await seedOrphanEvidence(run);
    const disposeArgs = [
      "orphan:dispose",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--orphan-sha256",
      sha,
      "--disposition",
      "superseded",
      "--rationale",
      "replaced by a fresh submission",
      "--evidence",
      "C-x",
    ];
    await execute(disposeArgs);
    await expect(execute(disposeArgs)).rejects.toThrow(/already dispositioned/);
  });
});

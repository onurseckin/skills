import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { requirementIds, setupReadyRun } from "./critic-run-fixture.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("CLI critic-ops commands", () => {
  test("critic:start and critic:review approve flow", async () => {
    const { repo, run } = await setupReadyRun("critic-approve-run", roots);

    const execInspect = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "critic-alpha",
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
      "critic-alpha",
      "--repository-command-ids",
      cmdId,
    ]);
    expect(start.token).toBeString();
    expect(String(start.markdown)).toContain("### Completeness Critic Session Initialized");
    const criticToken = start.token as string;

    const evidence = [{ kind: "command", reference: cmdId, observation: "gate covers it" }];
    const proofs = JSON.stringify(
      requirementIds(run).map((id) => ({ requirement_id: id, status: "satisfied", evidence })),
    );

    const review = await execute([
      "critic:review",
      "--run",
      run,
      "--critic",
      "critic-alpha",
      "--token",
      criticToken,
      "--decision",
      "approve",
      "--proofs",
      proofs,
      "--summary",
      "All requirements 100% verified with gate evidence",
    ]);
    expect(review.decision).toBe("approve");
    expect(String(review.markdown)).toContain("### Completeness Critic Sign-Off: APPROVED");
  });

  test("critic:review request_changes records findings", async () => {
    const { repo, run } = await setupReadyRun("critic-changes-run", roots);

    const execInspect = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "critic-beta",
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
      "critic-beta",
      "--repository-command-ids",
      cmdId,
    ]);
    const criticToken = start.token as string;

    const review = await execute([
      "critic:review",
      "--run",
      run,
      "--critic",
      "critic-beta",
      "--token",
      criticToken,
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
    expect(String(review.markdown)).toContain(
      "### Completeness Critic Sign-Off: CHANGES REQUESTED",
    );
  });

  test("request_changes without findings is refused rather than synthesized", async () => {
    const { repo, run } = await setupReadyRun("critic-no-findings", roots);
    const execInspect = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "critic-delta",
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
      "critic-delta",
      "--repository-command-ids",
      execInspect.command_id as string,
    ]);

    await expect(
      execute([
        "critic:review",
        "--run",
        run,
        "--critic",
        "critic-delta",
        "--token",
        start.token as string,
        "--decision",
        "request_changes",
        "--summary",
        "Something is wrong but I will not say what",
      ]),
    ).rejects.toThrow("a rejection must name the defects it found");
  });

  test("recorded integrity evidence is the harness's own capsule observation", async () => {
    const { repo, run } = await setupReadyRun("critic-integrity-evidence", roots);
    const execInspect = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "critic-epsilon",
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
      "critic-epsilon",
      "--repository-command-ids",
      cmdId,
    ]);
    const evidence = [{ kind: "command", reference: cmdId, observation: "gate covers it" }];
    const review = await execute([
      "critic:review",
      "--run",
      run,
      "--critic",
      "critic-epsilon",
      "--token",
      start.token as string,
      "--decision",
      "approve",
      "--proofs",
      JSON.stringify(
        requirementIds(run).map((id) => ({ requirement_id: id, status: "satisfied", evidence })),
      ),
      "--summary",
      "Whole diff verified against the run gate",
    ]);

    const recorded = review.completion_review as { integrity_evidence: Record<string, unknown>[] };
    expect(recorded.integrity_evidence).toHaveLength(1);
    expect(recorded.integrity_evidence[0]?.kind).toBe("capsule_integrity");
    expect(recorded.integrity_evidence[0]?.evidence_class).toBe("harness_observed");
    expect(recorded.integrity_evidence[0]?.status).toBe("passed");
    expect(recorded.integrity_evidence[0]?.issues).toEqual([]);
  });

  test("critic:reject records structured findings and integrates with plan:replan", async () => {
    const { repo, run } = await setupReadyRun("critic-reject-flow", roots);

    const execInspect = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "critic-gamma",
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
      "critic-gamma",
      "--repository-command-ids",
      cmdId,
    ]);
    const criticToken = start.token as string;

    const requirementId = requirementIds(run)[0];
    const findingsPayload = JSON.stringify([
      {
        id: "F-DRAWER-01",
        requirement_id: requirementId,
        severity: "critical",
        file_paths: ["src/components/EdgeDetailDrawer/EdgeDrawer.tsx"],
        observation: "Missing toggle callback causing TS2322",
        remediation: "Add onToggle prop",
        revalidation: "bun x tsc -b",
      },
      {
        id: "F-LAYOUT-01",
        requirement_id: requirementId,
        severity: "important",
        file_paths: ["src/engine/layout/hierarchical.ts"],
        observation: "Negative coordinate clamping omitted",
        remediation: "Clamp coordinates to zero",
        revalidation: "bun test tests",
      },
    ]);

    const reject = await execute([
      "critic:reject",
      "--run",
      run,
      "--critic",
      "critic-gamma",
      "--token",
      criticToken,
      "--findings",
      findingsPayload,
      "--summary",
      "Rejected with 2 defects found",
    ]);

    expect(reject.decision).toBe("request_changes");
    expect(reject.findings_count).toBe(2);
    expect(String(reject.markdown)).toContain("CHANGES REQUESTED (Findings Recorded)");

    // Coordinator now triggers plan:replan directly reading recorded findings
    const replan = await execute([
      "plan:replan",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--gate",
      "bun gate-t1.ts",
    ]);

    expect(replan.revision).toBe(2);
    expect(replan.repair_round).toBe(1);
    expect((replan.new_tasks as string[]).length).toBe(2);
    expect(String(replan.markdown)).toContain("### Plan Recompiled: Wave R1 (Graph Revision 2)");
  });

  test("--repository-command-ids widens the packet's evidence, not replaces it", async () => {
    const { repo, run } = await setupReadyRun("critic-repo-ids-widen", roots);

    // A bare inspection command, bound to no gate at all, so auto-discovery (scoped to run-gate
    // commands) could never find it on its own - this is the case the flag exists for.
    const bareInspect = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "critic-zeta",
      "--cwd",
      repo,
      "--",
      "echo",
      "bare-repository-inspection",
    ]);
    const bareId = bareInspect.command_id as string;

    const start = await execute([
      "critic:start",
      "--run",
      run,
      "--critic",
      "critic-zeta",
      "--repository-command-ids",
      bareId,
    ]);
    const packet = loadRun(run).state.packets?.[start.packet_id as string];
    const ids = packet?.repository_command_ids ?? [];
    expect(ids).toContain(bareId);
    // The auto-discovered mandatory-gate command must still be present: the flag widens the
    // evidence set, it never narrows it below what readiness already required.
    expect(ids.length).toBeGreaterThan(1);
  });

  test("critic:start refuses a repository command id that is not authoritative evidence", async () => {
    const { run } = await setupReadyRun("critic-repo-ids-bogus", roots);
    await expect(
      execute([
        "critic:start",
        "--run",
        run,
        "--critic",
        "critic-theta",
        "--repository-command-ids",
        "C-does-not-exist",
      ]),
    ).rejects.toThrow("not authoritative repository evidence");
  });
});

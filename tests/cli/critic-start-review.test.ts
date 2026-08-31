import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { criticReviewCommand } from "../../../olt/scripts/src/cli/commands/critic-ops.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { requirementIds } from "./critic-run-fixture.ts";
import { registerInspectionCommand, setupReadyRun } from "./critic-ready-fixture.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("CLI critic-ops commands", () => {
  test("critic:start and critic:review approve flow", async () => {
    const { repo, run } = await setupReadyRun("critic-approve-run", roots);

    // The critic's own repository-inspection command: authoritative, non-gate, observed by the
    // critic itself. Doubles as --repository-command-ids evidence and as the proof reference
    // below (criticReviewCommand only credits checks whose actor matches the reviewing critic).
    const cmdId = "C-INSPECT-ALPHA";
    registerInspectionCommand(run, repo, cmdId, "critic-alpha");

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

    const cmdId = "C-INSPECT-BETA";
    registerInspectionCommand(run, repo, cmdId, "critic-beta");

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
    const cmdId = "C-INSPECT-DELTA";
    registerInspectionCommand(run, repo, cmdId, "critic-delta");
    const start = await execute([
      "critic:start",
      "--run",
      run,
      "--critic",
      "critic-delta",
      "--repository-command-ids",
      cmdId,
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
    const cmdId = "C-INSPECT-EPSILON";
    registerInspectionCommand(run, repo, cmdId, "critic-epsilon");
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

    const cmdId = "C-INSPECT-GAMMA";
    registerInspectionCommand(run, repo, cmdId, "critic-gamma");

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
        revalidation: "bun gate-t1.ts",
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

    // Coordinator now triggers plan:replan directly reading recorded findings — no --gate flag,
    // proving each finding's own recorded `revalidation` command (fixed: plan-replan-findings.ts
    // used to read the never-written `revalidation_gate` name and silently drop it) resolves the
    // repair gate on its own. Both findings inherit task-1's own requirement (the single-task
    // fixture's only one), and task-1 is already "done" by the time the completeness critic can
    // even start (critic:start's own readiness gate demands every task be done first). Their
    // non-overlapping file paths partition into two disjoint repair tasks, each adding its own new
    // task-scoped gate under that shared requirement — which taskGates() (requirement-overlap
    // selection) now also attributes to task-1. guardPlanRevision tolerates that growth for a done
    // task (graph/plan-contract.ts's gateContractActive) while still freezing task-1's own contract,
    // so the repair tasks land as claimable work instead of a refusal a human has to work around.
    const replanned = await execute(["plan:replan", "--run", run, "--actor", "coordinator"]);
    expect(replanned.revision).toBe(2);
    const newTaskIds = replanned.new_tasks as string[];
    expect(newTaskIds).toHaveLength(2);
    expect(newTaskIds).toEqual(
      expect.arrayContaining([
        "repair-R1-src-components-EdgeDetailDrawer",
        "repair-R1-src-engine-layout",
      ]),
    );

    // Claimable, not merely present: queue:next must surface one of them, and queue:list must
    // show both ready — this is "visible in queue:next" without a human passing --gate by hand.
    const next = await execute(["queue:next", "--run", run]);
    expect(newTaskIds).toContain((next.task as { id: string }).id);

    const list = await execute(["queue:list", "--run", run]);
    const ready = (list.partitions as { ready: string[] }).ready;
    for (const id of newTaskIds) expect(ready).toContain(id);
  });

  test("--repository-command-ids widens the packet's evidence, not replaces it", async () => {
    const { repo, run } = await setupReadyRun("critic-repo-ids-widen", roots);

    // A bare inspection command, bound to no gate at all, so auto-discovery (scoped to run-gate
    // commands) could never find it on its own - this is the case the flag exists for.
    const bareId = "C-INSPECT-ZETA";
    registerInspectionCommand(run, repo, bareId, "critic-zeta", [
      "echo",
      "bare-repository-inspection",
    ]);

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

  test("critic:review rejects a decision that is neither approve nor request_changes", async () => {
    // criticReviewCommand checks --decision before it ever opens the run root, so this needs no
    // ready run, no critic:start, no capsule at all.
    await expect(
      criticReviewCommand({
        run: mkdtempSync(join(tmpdir(), "olt-test-")),
        critic: "critic-iota",
        token: "unused-token",
        decision: "abstain",
        summary: "Not a real decision",
      }),
    ).rejects.toThrow("--decision must be approve or request_changes");
  });

  test("critic:review refuses --findings on an approve decision", async () => {
    const { repo, run } = await setupReadyRun("critic-review-approve-findings", roots);
    const cmdId = "C-INSPECT-APPROVE-FINDINGS";
    registerInspectionCommand(run, repo, cmdId, "critic-kappa");
    const start = await execute([
      "critic:start",
      "--run",
      run,
      "--critic",
      "critic-kappa",
      "--repository-command-ids",
      cmdId,
    ]);
    await expect(
      execute([
        "critic:review",
        "--run",
        run,
        "--critic",
        "critic-kappa",
        "--token",
        start.token as string,
        "--decision",
        "approve",
        "--findings",
        "[]",
        "--summary",
        "Approve should never carry findings",
      ]),
    ).rejects.toThrow("--decision approve cannot carry findings");
  });

  test("critic:review rejects a request_changes whose --findings parses to an empty list", async () => {
    const { repo, run } = await setupReadyRun("critic-review-empty-findings", roots);
    const cmdId = "C-INSPECT-EMPTY-FINDINGS";
    registerInspectionCommand(run, repo, cmdId, "critic-lambda");
    const start = await execute([
      "critic:start",
      "--run",
      run,
      "--critic",
      "critic-lambda",
      "--repository-command-ids",
      cmdId,
    ]);
    await expect(
      execute([
        "critic:review",
        "--run",
        run,
        "--critic",
        "critic-lambda",
        "--token",
        start.token as string,
        "--decision",
        "request_changes",
        "--findings",
        "[]",
        "--summary",
        "No actual findings named",
      ]),
    ).rejects.toThrow("--decision request_changes requires at least one finding");
  });

  test("critic:review refuses when no completeness critic assignment is recorded", async () => {
    const { run } = await setupReadyRun("critic-review-no-assignment", roots);
    await expect(
      execute([
        "critic:review",
        "--run",
        run,
        "--critic",
        "critic-never-started",
        "--token",
        "fake-token",
        "--decision",
        "approve",
        "--summary",
        "No critic:start was ever run",
      ]),
    ).rejects.toThrow("no completeness critic assignment found");
  });

  test("critic:review --review loads the payload from a file, stamping its own measured integrity", async () => {
    const { repo, run } = await setupReadyRun("critic-review-file", roots);
    const cmdId = "C-INSPECT-REVIEW-FILE";
    registerInspectionCommand(run, repo, cmdId, "critic-file");
    const start = await execute([
      "critic:start",
      "--run",
      run,
      "--critic",
      "critic-file",
      "--repository-command-ids",
      cmdId,
    ]);
    const assignment = start.critic as {
      readiness_sha256: string;
      repository_binding: Record<string, unknown>;
    };
    const evidence = [{ kind: "command", reference: cmdId, observation: "gate covers it" }];
    const reviewRoot = await mkdtemp(join(tmpdir(), "harness-critic-review-file-"));
    roots.push(reviewRoot);
    const reviewPath = join(reviewRoot, "completion-review.json");
    await writeFile(
      reviewPath,
      JSON.stringify({
        graph_revision: 1,
        status: "clean",
        readiness_sha256: assignment.readiness_sha256,
        repository_binding: assignment.repository_binding,
        // The file asserts a clean capsule; critic:review measures its own integrity evidence
        // instead of trusting this declared one, which is exactly what this test checks.
        integrity_evidence: [{ kind: "capsule_integrity", status: "passed", issues: [] }],
        repository_command_ids: [cmdId],
        checks: [{ command_id: cmdId }],
        findings: [],
        unresolved_finding_ids: [],
        requirement_proofs: requirementIds(run).map((id) => ({
          requirement_id: id,
          status: "satisfied",
          evidence,
        })),
        residual_risks: [],
      }),
    );

    const review = await execute([
      "critic:review",
      "--run",
      run,
      "--critic",
      "critic-file",
      "--token",
      start.token as string,
      "--decision",
      "approve",
      "--review",
      reviewPath,
      "--summary",
      "Whole diff verified against the run gate",
    ]);
    expect(review.summary).toBe("Whole diff verified against the run gate");
    const recorded = review.completion_review as {
      critic_token: string;
      integrity_evidence: Record<string, unknown>[];
    };
    expect(recorded.integrity_evidence).toHaveLength(1);
    expect(recorded.integrity_evidence[0]).toMatchObject({
      kind: "capsule_integrity",
      evidence_class: "harness_observed",
      status: "passed",
    });
  });
});

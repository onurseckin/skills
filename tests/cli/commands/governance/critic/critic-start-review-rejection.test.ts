import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { criticReviewCommand } from "../../../../../olt/scripts/src/cli/commands/critic-ops.ts";
import { requirementIds } from "../../fixtures/critic-run-fixture.ts";
import { registerInspectionCommand, setupReadyRun } from "../../fixtures/critic-ready-fixture.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../../olt/scripts/src/runtime/session.ts";

const roots: string[] = [];
beforeEach(() => {
  setupVirtualCliFS();
  enableInMemoryAgentMetadata();
});
afterEach(async () => {
  disableInMemoryAgentMetadata();
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

describe("CLI critic-ops commands - Rejections, Findings and Validation", () => {
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

    const next = await execute(["queue:next", "--run", run]);
    expect(newTaskIds).toContain((next.task as { id: string }).id);

    const list = await execute(["queue:list", "--run", run]);
    const ready = (list.partitions as { ready: string[] }).ready;
    for (const id of newTaskIds) expect(ready).toContain(id);
  });

  test("critic:start refuses repository command id that is not authoritative evidence", async () => {
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

  test("critic:review rejects decision that is neither approve nor request_changes", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "olt-test-"));
    roots.push(tempDir);
    await expect(
      criticReviewCommand({
        run: tempDir,
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

  test("critic:review rejects request_changes whose --findings parses to empty list", async () => {
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
});

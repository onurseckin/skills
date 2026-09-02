import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { loadRun } from "../../../../../olt/scripts/src/engine/store/index.ts";
import { requirementIds } from "../../fixtures/critic-run-fixture.ts";
import { registerInspectionCommand, setupReadyRun } from "../../fixtures/critic-ready-fixture.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../../olt/scripts/src/runtime/session.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
beforeEach(() => {
  setupVirtualCliFS();
  enableInMemoryAgentMetadata();
});
afterEach(async () => {
  disableInMemoryAgentMetadata();
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
  roots.length = 0;
});

describe("CLI critic-ops commands - Approve and Review Flows", () => {
  test("critic:start and critic:review approve flow", async () => {
    const { repo, run } = await setupReadyRun("critic-approve-run", roots);
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

  test("recorded integrity evidence is harness capsule observation", async () => {
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

  test("--repository-command-ids widens packet evidence, not replaces it", async () => {
    const { repo, run } = await setupReadyRun("critic-repo-ids-widen", roots);
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
    expect(ids.length).toBeGreaterThan(1);
  });

  test("critic:review --review loads payload from file, stamping measured integrity", async () => {
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

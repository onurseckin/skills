import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { workflowView } from "../../../olt/scripts/src/reporting/workflow-view.ts";
import type {
  CompletionArtifactVerification,
  CompletionCriticAuthorization,
  CompletionRemediation,
  CompletionResult,
  CompletionReview,
  PacketRecord,
  RequirementRuntime,
  TaskRecord,
} from "../../../olt/scripts/src/workflow/types.ts";
import { commandRecord, repositoryBinding } from "../workflow/test-port.ts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function viewFixture() {
  const repo = await mkdtemp(join(tmpdir(), "harness-wfview-"));
  roots.push(repo);
  const runRoot = initRun(
    repo,
    "wfview-run",
    new TextEncoder().encode("Test workflow view"),
    "file",
    true,
  );
  return runRoot;
}

describe("reporting workflow view", () => {
  test("projects task validations, findings, gate results, and stale evidence", async () => {
    const runRoot = await viewFixture();
    const pastTime = new Date(Date.now() - 10_000).toISOString();

    // workflowView is a pure state-to-view projector; every input below is a typed WorkflowState
    // fixture (real domain types, not loose JSON), written through a single transact call because
    // workflowView only knows how to read a runRoot -- there is no lighter, non-capsule entry point
    // to hand it a state directly.
    const task1: TaskRecord = {
      id: "task-1",
      status: "leased",
      requirement_ids: ["R-1"],
      write_scope: ["src/**"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 1,
      lease: {
        agent_id: "agent-1",
        role: "implementer",
        attempt: 1,
        token_digest: "digest-1",
        issued_at: pastTime,
        expires_at: pastTime,
        heartbeat_at: pastTime,
        duration_seconds: 3600,
        write_scope: ["src/**"],
        resource_scope: [],
      },
      original_implementer: "agent-1",
      repair_assignee: "repair-1",
      findings: [
        {
          id: "F-2",
          requirement_id: "R-1",
          severity: "minor",
          observation: "already fixed",
          evidence: [],
          remediation: "n/a",
          revalidation: "n/a",
          status: "resolved",
        },
        {
          id: "F-1",
          requirement_id: "R-1",
          severity: "important",
          observation: "still open",
          evidence: [],
          remediation: "n/a",
          revalidation: "n/a",
          status: "open",
        },
      ],
      gate_results: [{ gate_id: "G-1", command_id: "C-1", status: "passed" }],
      report: { summary: "done" },
    };

    const task2: TaskRecord = {
      id: "task-2",
      status: "validating",
      requirement_ids: ["R-1"],
      dependencies: [],
      write_scope: ["src/**"],
      attempts: [],
      history: [],
      repair_round: 0,
      // No verdict: an open attempt whose deadline has passed is what "stale" means (B12.2 — a
      // domain that already recorded one is settled, however old its deadline, so it does not
      // count as stale evidence; see workflow-view.ts's own staleEvidence()).
      validations: [
        {
          validator_id: "val-1",
          domain: "code-quality",
          token_digest: "digest-2",
          attempt: 2,
          started_at: pastTime,
          deadline_at: pastTime,
        },
      ],
    };

    const requirement: RequirementRuntime = {
      id: "R-1",
      status: "planned",
      evidence: [],
      disposition: "needs_authority",
      authority_status: "granted",
      authority_history: [{ decision: "grant", actor: "coord" }],
    };

    // "preparing" (not "published") deliberately: a published packet must have a real bundle on
    // disk, which verifyIntegrity enforces on every loadRun -- and workflowView's packet
    // projection does not read status at all, so this is the honestly-typed choice, not a dodge.
    const packetImplementer: PacketRecord = {
      id: "P-1",
      status: "preparing",
      role: "implementer",
      agent_id: "agent-1",
      task_id: "task-1",
      attempt: 1,
      graph_revision: 1,
      markdown_path: "packets/P-1/packet.md",
      metadata_path: "packets/P-1/metadata.json",
      packet_sha256: "a".repeat(64),
      published_at: pastTime,
    };
    const packetValidator: PacketRecord = {
      id: "P-2",
      status: "preparing",
      role: "validator",
      agent_id: "val-1",
      task_id: "task-1",
      attempt: 1,
      graph_revision: 1,
      markdown_path: "packets/P-2/packet.md",
      metadata_path: "packets/P-2/metadata.json",
      packet_sha256: "b".repeat(64),
      published_at: pastTime,
    };

    const completionCritic: CompletionCriticAuthorization = {
      critic_id: "critic-1",
      token_digest: "digest",
      attempt: 1,
      status: "assigned",
      started_at: pastTime,
      deadline_at: pastTime,
      readiness_sha256: "sha-1",
      repository_binding: structuredClone(repositoryBinding),
      packet_id: "crit-pkt-1",
    };
    const completionCriticHistory: CompletionCriticAuthorization = {
      critic_id: "critic-0",
      token_digest: "digest-0",
      attempt: 0,
      status: "expired",
      started_at: pastTime,
      deadline_at: pastTime,
      readiness_sha256: "sha-0",
      repository_binding: structuredClone(repositoryBinding),
    };

    const completionReview: CompletionReview = {
      critic_id: "critic-1",
      packet_id: "crit-pkt-1",
      graph_revision: 1,
      readiness_sha256: "sha-1",
      repository_binding: structuredClone(repositoryBinding),
      summary: "All requirements verified",
      status: "clean",
      unresolved_finding_ids: [],
      findings: [],
      requirement_proofs: [],
      residual_risks: [],
      integrity_evidence: [{ status: "passed", issues: [] }],
      repository_command_ids: [],
      checks: [],
      reviewed_at: pastTime,
      review_sha256: "review-sha-1",
    };

    const completionRemediation: CompletionRemediation = {
      actor: "coordinator",
      review_sha256: "review-sha-1",
      resolutions: [{ finding_id: "F-1", method: "fixed", command_ids: ["C-1"] }],
      recorded_at: pastTime,
      remediation_sha256: "remediation-sha-1",
    };

    const completionVerification: CompletionArtifactVerification = {
      verified_at: pastTime,
      command_ids: ["C-1"],
      packets: [],
      repository_binding: structuredClone(repositoryBinding),
      verification_sha256: "verification-sha-1",
    };

    const completionResult: CompletionResult = {
      status: "complete",
      actor: "coordinator",
      completed_at: pastTime,
      graph_revision: 1,
      readiness_sha256: "sha-1",
      repository_binding: structuredClone(repositoryBinding),
      critic_review_sha256: "review-sha-1",
      artifact_verification_sha256: "verification-sha-1",
      mandatory_run_gate_commands: {},
    };

    transact(runRoot, "planner", "plan-applied", {}, (state) => {
      state.graph = { revision: 1, gates: [] };
      state.requirements = { requirements: [requirement] };
      state.tasks = { "task-1": task1, "task-2": task2 };
      state.commands = {
        "C-1": commandRecord("C-1", {
          actor: "worker",
          task_id: "task-1",
          gate_id: "G-1",
          exit_code: 0,
          fingerprint: "fp-1",
          assurance: "trusted_host_observed_v1",
          repository_before: structuredClone(repositoryBinding),
          repository_after: structuredClone(repositoryBinding),
        }),
      };
      state.packets = { "P-2": packetValidator, "P-1": packetImplementer };
      state.branches = [
        {
          id: "branch-1",
          parent_task_id: "task-1",
          parent_agent_id: "agent-1",
          status: "open",
          reason: "Sprouted repair",
          depth: 1,
          opened_at: pastTime,
          sub_tasks: [
            {
              id: "sub-1",
              label: "Fix linting",
              status: "open",
              agent_id: "agent-1",
              write_scope: ["src/index.ts"],
            },
          ],
        },
      ];
      state.completion_critic = completionCritic;
      state.completion_critic_history = [completionCriticHistory];
      state.completion_review = completionReview;
      state.completion_reviews = [completionReview];
      state.completion_remediations = [completionRemediation];
      state.completion_verification = completionVerification;
      state.completion_result = completionResult;
    });

    const view = workflowView(runRoot, new Date());
    expect(view.branches).toHaveLength(1);
    expect(view.tasks).toHaveLength(2);
    expect(view.tasks[0]).toMatchObject({
      id: "task-1",
      owner: "agent-1",
      role: "implementer",
      attempt: 1,
      original_implementer: "agent-1",
      repair_assignee: "repair-1",
      open_finding_ids: ["F-1"],
      report_recorded: true,
      repair_round: 1,
    });
    expect(view.tasks[1]).toMatchObject({
      id: "task-2",
      validation: [
        {
          validator_id: "val-1",
          domain: "code-quality",
          attempt: 2,
        },
      ],
    });

    expect(view.requirements[0]).toMatchObject({
      id: "R-1",
      disposition: "needs_authority",
      authority_status: "granted",
      authority_history: [{ decision: "grant", actor: "coord" }],
    });

    expect(view.commands[0]).toMatchObject({
      id: "C-1",
      assurance: "trusted_host_observed_v1",
    });

    expect(view.packets).toHaveLength(2);
    expect(view.packets[0].id).toBe("P-1");
    expect(view.packets[1].id).toBe("P-2");

    expect(view.completion_critic).toMatchObject({
      critic_id: "critic-1",
      packet_id: "crit-pkt-1",
    });
    expect(view.completion_critic_history).toHaveLength(1);
    expect(view.completion_review).toMatchObject({ status: "clean" });
    expect(view.completion_reviews).toHaveLength(1);
    expect(view.completion_remediations).toHaveLength(1);
    expect(view.completion_verification).toMatchObject({ verified_at: pastTime });
    expect(view.completion_result).toMatchObject({ status: "complete" });

    // Stale evidence contains expired lease, validation, and critic
    expect(view.stale_evidence).toContainEqual(
      expect.stringContaining("task task-1 lease expired"),
    );
    expect(view.stale_evidence).toContainEqual(
      expect.stringContaining("task task-2 code-quality validation expired"),
    );
    expect(view.stale_evidence).toContainEqual(
      expect.stringContaining("completion critic critic-1 expired"),
    );
  });

  test("renderDynamicDagView renders from raw Sugiyama nodes and string subtasks", async () => {
    const { renderDynamicDagView, renderBranchExpansionHierarchy } =
      await import("../../../olt/scripts/src/reporting/dag-view.ts");
    const subtaskLines = renderBranchExpansionHierarchy("p-1", ["subtask-str-1", "subtask-str-2"], {
      branchId: "b-dyn",
    });
    expect(subtaskLines.some((l) => l.includes("[subtask-str-1]"))).toBe(true);

    const nodes = [
      {
        id: "node-1",
        label: "Node 1",
        status: "ready",
        dependencies: [],
        writeScope: [],
        assignedAgent: null,
      },
    ];
    const edges: never[] = [];
    const report = renderDynamicDagView(nodes, edges);
    expect(report.renderedDag).toContain("node-1");
  });
});

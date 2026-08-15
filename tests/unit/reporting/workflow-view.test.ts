import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initRun, transact } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { workflowView } from "../../../orchestrating-long-tasks/scripts/src/reporting/workflow-view.ts";
import { repositoryBinding } from "../workflow/test-port.ts";

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
    const futureTime = new Date(Date.now() + 100_000).toISOString();

    transact(runRoot, "planner", "plan-applied", {}, (state) => {
      state.graph = { revision: 1, gates: [] };
      state.requirements = {
        requirements: [
          {
            id: "R-1",
            status: "planned",
            evidence: [],
            disposition: "needs_authority",
            authority_status: "granted",
            authority_history: [{ decision: "grant", actor: "coord" }],
          },
        ],
      };
      state.tasks = {
        "task-1": {
          id: "task-1",
          status: "leased",
          requirement_ids: ["R-1"],
          dependencies: [],
          write_scope: ["src/**"],
          lease: {
            agent_id: "agent-1",
            role: "implementer",
            attempt: 1,
            expires_at: pastTime,
            token_digest: "digest-1",
          },
          original_implementer: "agent-1",
          repair_assignee: "repair-1",
          findings: [
            { id: "F-2", status: "resolved" },
            { id: "F-1", status: "open" },
          ],
          gate_results: [{ gate_id: "G-1", passed: true }],
          report: { summary: "done" },
          repair_round: 1,
          history: [],
        },
        "task-2": {
          id: "task-2",
          status: "validating",
          requirement_ids: ["R-1"],
          dependencies: [],
          write_scope: ["src/**"],
          validation: {
            validator_id: "val-1",
            attempt: 2,
            deadline_at: pastTime,
            verdict: "pass",
          },
          history: [],
          repair_round: 0,
        },
      };
      state.commands = {
        "C-1": {
          id: "C-1",
          actor: "worker",
          status: "succeeded",
          task_id: "task-1",
          gate_id: "G-1",
          exit_code: 0,
          fingerprint: "fp-1",
          assurance: "trusted_host_observed_v1",
          repository_before: structuredClone(repositoryBinding),
          repository_after: structuredClone(repositoryBinding),
        },
      };
      state.packets = {
        "P-2": { id: "P-2", role: "validator", agent_id: "val-1", attempt: 1 },
        "P-1": { id: "P-1", role: "implementer", agent_id: "agent-1", attempt: 1 },
      };
      state.completion_critic = {
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
      state.completion_critic_history = [
        {
          critic_id: "critic-0",
          token_digest: "digest-0",
          attempt: 0,
          status: "expired",
          started_at: pastTime,
          deadline_at: pastTime,
          readiness_sha256: "sha-0",
          repository_binding: structuredClone(repositoryBinding),
        },
      ];
      state.completion_review = {
        status: "clean",
        verdict: "pass",
        findings: [],
        unresolved_finding_ids: [],
        checks: [],
        requirement_proofs: [],
        residual_risks: [],
        repository_command_ids: [],
        integrity_evidence: [{ status: "passed", issues: [] }],
      };
      state.completion_reviews = [
        {
          status: "clean",
          verdict: "pass",
          findings: [],
          unresolved_finding_ids: [],
          checks: [],
          requirement_proofs: [],
          residual_risks: [],
          repository_command_ids: [],
          integrity_evidence: [{ status: "passed", issues: [] }],
        },
      ];
      state.completion_remediations = [{ status: "remediated" }];
      state.completion_verification = { verified_at: pastTime };
      state.completion_result = { status: "complete" };
    });

    const view = workflowView(runRoot, new Date());
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
      validation: {
        validator_id: "val-1",
        attempt: 2,
        verdict: "pass",
      },
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
      expect.stringContaining("task task-2 validation expired"),
    );
    expect(view.stale_evidence).toContainEqual(
      expect.stringContaining("completion critic critic-1 expired"),
    );
  });
});

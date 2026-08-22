import { describe, expect, test } from "bun:test";
import {
  processCriticFeedbackLoop,
  generateRepairInstructions,
  evaluateRepairCycleStatus,
} from "../../../orchestrating-long-tasks/scripts/src/orchestrator/recursive-critic-feedback.ts";
import type { CompletionReview } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/types.ts";
import type { TaskRecord, WorkflowState } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { TestPort, repositoryBinding, workflowState } from "../workflow/test-port.ts";

describe("Orchestrator Recursive Critic Feedback Integration", () => {
  function createFindingsReview(): CompletionReview {
    return {
      critic_id: "critic-1",
      packet_id: "p-1",
      graph_revision: 1,
      readiness_sha256: "0".repeat(64),
      repository_binding: repositoryBinding,
      summary: "Adversarial test failure in database connector",
      status: "findings",
      unresolved_finding_ids: ["F-DB-1"],
      findings: [
        {
          id: "F-DB-1",
          requirement_id: "R-1",
          severity: "critical",
          observation: "Connection leak on retry in src/db/pool.ts",
          file_paths: ["src/db/pool.ts"],
          evidence: [],
          remediation: "Release connection in finally block",
          revalidation: "bun test tests/unit/db.test.ts",
        },
      ],
      requirement_proofs: [
        {
          requirement_id: "R-1",
          status: "unproven",
          evidence: [],
        },
      ],
      residual_risks: [],
      integrity_evidence: [],
      repository_command_ids: ["c-1"],
      checks: [{ command_id: "c-1" }],
      reviewed_at: new Date().toISOString(),
      review_sha256: "2".repeat(64),
    };
  }

  test("processCriticFeedbackLoop returns converged when review is clean", () => {
    const state = workflowState();
    const port = new TestPort(state);
    const cleanReview: CompletionReview = {
      ...createFindingsReview(),
      status: "clean",
      findings: [],
      unresolved_finding_ids: [],
      requirement_proofs: [{ requirement_id: "R-1", status: "satisfied", evidence: [] }],
    };

    const outcome = processCriticFeedbackLoop(port, "orchestrator", cleanReview);
    expect(outcome.isConverged).toBeTrue();
    expect(outcome.totalTasksInRepair).toBe(0);
    expect(outcome.repairInstructions.length).toBe(0);
  });

  test("processCriticFeedbackLoop generates structured repair instructions and defect synthesis", () => {
    const state = workflowState();
    state.tasks["T-1"]!.original_implementer = "worker-1";
    state.tasks["T-1"]!.status = "done";
    state.tasks["T-1"]!.write_scope = ["src/db/pool.ts"];
    state.tasks["T-1"]!.repair_round = 0;

    const port = new TestPort(state);
    const review = createFindingsReview();

    const outcome = processCriticFeedbackLoop(port, "orchestrator", review, {
      roundNumber: 2,
      runId: "run-123",
      originalPrompt: "Implement database connection pool",
    });

    expect(outcome.isConverged).toBeFalse();
    expect(outcome.totalTasksInRepair).toBe(1);
    expect(outcome.repairInstructions.length).toBe(1);

    const instruction = outcome.repairInstructions[0]!;
    expect(instruction.taskId).toBe("T-1");
    expect(instruction.repairAssignee).toBe("worker-1");
    expect(instruction.repairRound).toBe(1);
    expect(instruction.writeScope).toEqual(["src/db/pool.ts"]);
    expect(instruction.remediationInstructions).toContain("Connection leak on retry in src/db/pool.ts");
    expect(instruction.revalidationGates).toContain("bun test tests/unit/db.test.ts");

    expect(outcome.defectSynthesis).toBeDefined();
    expect(outcome.defectSynthesis?.synthesizedPrompt).toContain("Evolutionary Round 2 Refinement Directive");
  });

  test("evaluateRepairCycleStatus categorizes near-budget and exhausted tasks", () => {
    const state = workflowState();
    state.tasks["T-1"] = {
      id: "T-1",
      status: "changes_requested",
      repair_round: 2, // near budget for max 3
      requirement_ids: [],
      write_scope: [],
      dependencies: [],
      attempts: [],
      history: [],
    } as unknown as TaskRecord;

    state.tasks["T-2"] = {
      id: "T-2",
      status: "changes_requested",
      repair_round: 3, // exhausted for max 3
      requirement_ids: [],
      write_scope: [],
      dependencies: [],
      attempts: [],
      history: [],
    } as unknown as TaskRecord;

    state.tasks["T-3"] = {
      id: "T-3",
      status: "escalated",
      repair_round: 3,
      requirement_ids: [],
      write_scope: [],
      dependencies: [],
      attempts: [],
      history: [],
    } as unknown as TaskRecord;

    const report = evaluateRepairCycleStatus(state, 3);
    expect(report.changesRequestedCount).toBe(2);
    expect(report.escalatedCount).toBe(1);
    expect(report.nearBudgetTasks).toEqual(["T-1"]);
    expect(report.exhaustedTasks).toEqual(["T-2"]);
  });
});

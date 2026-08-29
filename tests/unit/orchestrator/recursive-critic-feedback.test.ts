import { describe, expect, test } from "bun:test";
import {
  processCriticFeedbackLoop,
  generateRepairInstructions,
  evaluateRepairCycleStatus,
} from "../../../olt/scripts/src/orchestrator/recursive-critic-feedback.ts";
import { MAX_REPAIR_ROUNDS } from "../../../olt/scripts/src/core/config/contracts.ts";
import type { Finding } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { TaskRepairSummary } from "../../../olt/scripts/src/workflow/completion/critic-feedback-loop.ts";
import type { CompletionReview } from "../../../olt/scripts/src/workflow/completion/types.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";
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
          status: "open",
        },
      ],
      requirement_proofs: [{ requirement_id: "R-1", status: "unproven", evidence: [] }],
      residual_risks: [],
      integrity_evidence: [],
      repository_command_ids: ["c-1"],
      checks: [{ command_id: "c-1" }],
      reviewed_at: new Date().toISOString(),
      review_sha256: "2".repeat(64),
    };
  }

  function createTask(id: string, status: TaskRecord["status"], repairRound = 0): TaskRecord {
    return {
      id,
      status,
      requirement_ids: ["R-1"],
      write_scope: ["src/db/pool.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: repairRound,
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
    expect(outcome.totalTasksEscalated).toBe(0);
    expect(outcome.repairInstructions.length).toBe(0);
    expect(outcome.routingResult.reviewedStatus).toBe("clean");
  });

  test("processCriticFeedbackLoop generates structured repair instructions and defect synthesis", () => {
    const state = workflowState();
    state.tasks["T-1"] = {
      ...createTask("T-1", "done", 0),
      original_implementer: "worker-1",
    };

    const port = new TestPort(state);
    const review = createFindingsReview();

    const outcome = processCriticFeedbackLoop(port, "orchestrator", review, {
      roundNumber: 2,
      runId: "run-123",
      originalPrompt: "Implement database connection pool",
      gateResults: [{ gate_id: "G-1", command_id: "c-1", status: "failed" }],
    });

    expect(outcome.isConverged).toBeFalse();
    expect(outcome.totalTasksInRepair).toBe(1);
    expect(outcome.repairInstructions.length).toBe(1);

    const instruction = outcome.repairInstructions[0];
    expect(instruction).toBeDefined();
    if (instruction) {
      expect(instruction.taskId).toBe("T-1");
      expect(instruction.repairAssignee).toBe("worker-1");
      expect(instruction.repairRound).toBe(1);
      expect(instruction.writeScope).toEqual(["src/db/pool.ts"]);
      expect(instruction.remediationInstructions).toContain(
        "Connection leak on retry in src/db/pool.ts",
      );
      expect(instruction.revalidationGates).toContain("bun test tests/unit/db.test.ts");
    }

    expect(outcome.defectSynthesis).toBeDefined();
    expect(outcome.defectSynthesis?.synthesizedPrompt).toContain(
      "Evolutionary Round 2 Refinement Directive",
    );
  });

  test("generateRepairInstructions skips non-changes_requested summaries and missing tasks", () => {
    const state = workflowState();
    state.tasks["T-1"] = {
      ...createTask("T-1", "changes_requested", 1),
      write_scope: ["src/lib.ts"],
      findings: [
        {
          id: "F-1",
          requirement_id: "R-1",
          severity: "low",
          observation: "Fix formatting",
          file_paths: ["src/lib.ts"],
          evidence: [],
          remediation: "Run linter",
          status: "open",
        },
        {
          id: "F-2",
          requirement_id: "R-1",
          severity: "low",
          observation: "Already fixed",
          file_paths: ["src/lib.ts"],
          evidence: [],
          remediation: "None",
          status: "closed",
        },
      ],
    };

    const summaries: readonly TaskRepairSummary[] = [
      { taskId: "T-1", repairAssignee: "worker-1", newStatus: "changes_requested", findingsCount: 1, priorStatus: "done", repairRound: 1 },
      { taskId: "T-2", repairAssignee: "worker-2", newStatus: "changes_requested", findingsCount: 1, priorStatus: "done", repairRound: 1 },
      { taskId: "T-1", repairAssignee: "worker-1", newStatus: "escalated", findingsCount: 1, priorStatus: "changes_requested", repairRound: 2 },
    ];

    const instructions = generateRepairInstructions(state, summaries);
    expect(instructions.length).toBe(1);
    expect(instructions[0]?.taskId).toBe("T-1");
    expect(instructions[0]?.findings.length).toBe(1);
    expect(instructions[0]?.findings[0]?.id).toBe("F-1");
    expect(instructions[0]?.revalidationGates).toEqual([]);
  });

  test("generateRepairInstructions handles revalidation gates and deduplicates them", () => {
    const openFindings: readonly Finding[] = [
      { id: "F-1", requirement_id: "R-1", severity: "medium", observation: "Issue 1", file_paths: ["src/a.ts"], evidence: [], remediation: "Fix 1", revalidation: "bun test test1.test.ts", status: "open" },
      { id: "F-2", requirement_id: "R-1", severity: "medium", observation: "Issue 2", file_paths: ["src/b.ts"], evidence: [], remediation: "Fix 2", revalidation: "bun test test1.test.ts", status: "open" },
      { id: "F-3", requirement_id: "R-1", severity: "medium", observation: "Issue 3", file_paths: ["src/c.ts"], evidence: [], remediation: "Fix 3", revalidation: "   ", status: "open" },
    ];

    const state = workflowState();
    state.tasks["T-1"] = {
      ...createTask("T-1", "changes_requested", 1),
      write_scope: ["src/a.ts"],
      findings: openFindings,
    };

    const summaries: readonly TaskRepairSummary[] = [
      { taskId: "T-1", repairAssignee: "worker-1", newStatus: "changes_requested", findingsCount: 3, priorStatus: "done", repairRound: 1 },
    ];

    const instructions = generateRepairInstructions(state, summaries);
    expect(instructions.length).toBe(1);
    expect(instructions[0]?.revalidationGates).toEqual(["bun test test1.test.ts"]);
    expect(instructions[0]?.remediationInstructions).toContain("Revalidation Gate:");
  });

  test("evaluateRepairCycleStatus categorizes near-budget and exhausted tasks", () => {
    const state = workflowState();
    state.tasks["T-1"] = createTask("T-1", "changes_requested", 2);
    state.tasks["T-2"] = createTask("T-2", "changes_requested", 3);
    state.tasks["T-3"] = createTask("T-3", "escalated", 3);
    state.tasks["T-4"] = createTask("T-4", "changes_requested", 0);
    state.tasks["T-5"] = createTask("T-5", "ready", 0);

    const report = evaluateRepairCycleStatus(state, 3);
    expect(report.changesRequestedCount).toBe(3);
    expect(report.escalatedCount).toBe(1);
    expect(report.nearBudgetTasks).toEqual(["T-1"]);
    expect(report.exhaustedTasks).toEqual(["T-2"]);
  });

  test("evaluateRepairCycleStatus defaults to MAX_REPAIR_ROUNDS constant", () => {
    const state = workflowState();
    state.tasks["T-1"] = createTask("T-1", "changes_requested", MAX_REPAIR_ROUNDS - 1);
    state.tasks["T-2"] = createTask("T-2", "changes_requested", MAX_REPAIR_ROUNDS);

    const report = evaluateRepairCycleStatus(state);
    expect(report.changesRequestedCount).toBe(2);
    expect(report.nearBudgetTasks).toEqual(["T-1"]);
    expect(report.exhaustedTasks).toEqual(["T-2"]);
  });
});

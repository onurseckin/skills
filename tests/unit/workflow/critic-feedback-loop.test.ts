import { describe, expect, test } from "bun:test";
import {
  generateStructuredFindingsFromCritic,
  isDeterministicFindingRepeat,
  trackTaskRepairBudget,
  routeCriticReviewFindings,
} from "../../../olt/scripts/src/workflow/completion/critic-feedback-loop.ts";
import type { Finding } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { CompletionReview } from "../../../olt/scripts/src/workflow/completion/types.ts";
import type { TaskRecord, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";
import { TestPort, repositoryBinding, workflowState } from "./test-port.ts";

describe("Closed-Loop Recursive Critic Feedback Mechanics", () => {
  function makeReview(
    findings: Partial<Finding>[] = [],
    status: "clean" | "findings" = "findings",
  ): CompletionReview {
    return {
      critic_id: "critic-agent-1",
      packet_id: "packet-1",
      graph_revision: 1,
      readiness_sha256: "0".repeat(64),
      repository_binding: repositoryBinding,
      summary: "Critic detected completeness issues",
      status,
      unresolved_finding_ids: findings.map((f) => f.id ?? "F-1"),
      findings: findings.map((f) => ({
        id: f.id ?? "F-1",
        requirement_id: f.requirement_id ?? "R-1",
        severity: (f.severity as "critical" | "important" | "minor") ?? "critical",
        observation: f.observation ?? "Defect observed",
        evidence: [],
        remediation: f.remediation ?? "Fix code",
        revalidation: f.revalidation ?? "bun test",
      })),
      requirement_proofs: [
        {
          requirement_id: "R-1",
          status: status === "clean" ? "satisfied" : "unproven",
          evidence: [],
        },
      ],
      residual_risks: [],
      integrity_evidence: [],
      repository_command_ids: ["cmd-1"],
      checks: [{ command_id: "cmd-1" }],
      reviewed_at: new Date().toISOString(),
      review_sha256: "1".repeat(64),
    };
  }

  test("generateStructuredFindingsFromCritic parses findings and unproven requirements", () => {
    const review = makeReview([
      { id: "CF-1", requirement_id: "R-1", severity: "critical", observation: "Missing UI test" },
    ]);
    const findings = generateStructuredFindingsFromCritic(review);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.id === "CF-1")).toBeTrue();
    expect(findings.some((f) => f.id === "UNPROVEN-REQ-R-1")).toBeTrue();
  });

  test("routeCriticReviewFindings does nothing if status is clean", () => {
    const state = workflowState();
    const port = new TestPort(state);
    const review = makeReview([], "clean");

    const result = routeCriticReviewFindings(port, "orchestrator", review);
    expect(result.reviewedStatus).toBe("clean");
    expect(result.totalFindingsRouted).toBe(0);
    expect(result.affectedTaskIds).toEqual([]);
    expect(port.events.length).toBe(0);
  });

  test("routeCriticReviewFindings transitions task to changes_requested and increments repair_round", () => {
    const state = workflowState();
    state.tasks["T-1"]!.original_implementer = "worker-implementer-1";
    state.tasks["T-1"]!.status = "done";
    state.tasks["T-1"]!.repair_round = 0;

    const port = new TestPort(state);
    const review = makeReview([
      { id: "CF-1", requirement_id: "R-1", observation: "Bug in src/module.ts" },
    ]);

    const result = routeCriticReviewFindings(port, "orchestrator", review, { maxRepairRounds: 3 });
    expect(result.reviewedStatus).toBe("findings");
    expect(result.totalFindingsRouted).toBeGreaterThanOrEqual(1);
    expect(result.changesRequestedTaskIds).toContain("T-1");
    expect(result.escalatedTaskIds.length).toBe(0);

    const updated = port.read();
    const task = updated.tasks["T-1"]!;
    expect(task.status).toBe("changes_requested");
    expect(task.repair_round).toBe(1);
    expect(task.repair_assignee).toBe("worker-implementer-1");
    expect(task.findings?.some((f) => f.id === "CF-1")).toBeTrue();
  });

  test("routeCriticReviewFindings escalates task when repair rounds budget is exhausted", () => {
    const state = workflowState();
    state.tasks["T-1"]!.original_implementer = "worker-implementer-1";
    state.tasks["T-1"]!.status = "changes_requested";
    state.tasks["T-1"]!.repair_round = 2; // Next round is 3, hitting maxRepairRounds = 3

    const port = new TestPort(state);
    const review = makeReview([
      { id: "CF-FINAL", requirement_id: "R-1", observation: "Still failing" },
    ]);

    const result = routeCriticReviewFindings(port, "orchestrator", review, { maxRepairRounds: 3 });
    expect(result.escalatedTaskIds).toContain("T-1");

    const updated = port.read();
    const task = updated.tasks["T-1"]!;
    expect(task.status).toBe("escalated");
    expect(task.repair_round).toBe(3);
  });

  test("isDeterministicFindingRepeat detects repeated defect", () => {
    const task = {
      findings: [
        {
          id: "F-OLD",
          requirement_id: "R-1",
          severity: "critical",
          observation: "Exact same memory leak in pool.ts",
          evidence: [],
          remediation: "Fix leak",
          revalidation: "",
          status: "open",
        },
      ],
    } as unknown as TaskRecord;

    const newFinding: Finding = {
      id: "F-NEW",
      requirement_id: "R-1",
      severity: "critical",
      observation: "Exact same memory leak in pool.ts",
      evidence: [],
      remediation: "Fix leak",
      revalidation: "",
      status: "open",
    };

    expect(isDeterministicFindingRepeat(task, newFinding)).toBeTrue();

    // False cases: empty findings, undefined findings, different observation
    const emptyTask = { findings: [] } as unknown as TaskRecord;
    expect(isDeterministicFindingRepeat(emptyTask, newFinding)).toBeFalse();

    const undefTask = {} as unknown as TaskRecord;
    expect(isDeterministicFindingRepeat(undefTask, newFinding)).toBeFalse();
  });

  test("generateStructuredFindingsFromCritic handles non-object inputs and missing finding fields", () => {
    expect(generateStructuredFindingsFromCritic(null)).toEqual([]);
    expect(generateStructuredFindingsFromCritic([])).toEqual([]);
    expect(generateStructuredFindingsFromCritic("not-an-object")).toEqual([]);

    const partialFindingsReview = {
      status: "findings",
      findings: [
        { id: "F-MIN", severity: "minor" },
        { id: "F-DEF", severity: "other" },
        { id: "   " }, // ignored whitespace id
      ],
    };
    const findings = generateStructuredFindingsFromCritic(partialFindingsReview);
    expect(findings).toHaveLength(2);
    expect(findings[0]!.severity).toBe("minor");
    expect(findings[0]!.observation).toBe("Critic defect detected");
    expect(findings[0]!.remediation).toBe("Remediate finding and verify with non-mocked tests");
    expect(findings[1]!.severity).toBe("important");
  });

  test("trackTaskRepairBudget accurately computes remaining repair capacity and detects repeated defects", () => {
    const task = {
      repair_round: 1,
      findings: [
        { id: "F-1" },
        { id: "F-1" }, // duplicate 1
        { id: "F-1" }, // duplicate 2 -> repeatCount >= 2
      ],
    } as unknown as TaskRecord;

    const budget = trackTaskRepairBudget(task, 3);
    expect(budget.repairRound).toBe(1);
    expect(budget.maxRepairRounds).toBe(3);
    expect(budget.remainingBudget).toBe(2);
    expect(budget.isExhausted).toBeFalse();
    expect(budget.deterministicDefectDetected).toBeTrue();

    // Default round when task.repair_round is undefined
    const defaultRoundTask = {} as unknown as TaskRecord;
    expect(trackTaskRepairBudget(defaultRoundTask).repairRound).toBe(0);
  });

  test("routeCriticReviewFindings matches tasks by write_scope or fallback status and escalates on deterministic repeat", () => {
    const state = workflowState();
    // T-1 has write_scope ["src/core/target.ts"], requirement_ids: ["R-DIFFERENT"]
    state.tasks["T-1"]!.requirement_ids = ["R-DIFFERENT"];
    state.tasks["T-1"]!.write_scope = ["src/core/target.ts"];
    state.tasks["T-1"]!.status = "validated";
    state.tasks["T-1"]!.findings = [
      {
        id: "F-EXISTING",
        requirement_id: "R-99",
        severity: "critical",
        observation: "duplicate observation in target",
        evidence: [],
        remediation: "fix it",
        revalidation: "",
        status: "open",
      },
    ];

    const port = new TestPort(state);
    const review = makeReview([
      {
        id: "F-NEW-SCOPE-MATCH",
        requirement_id: "R-99",
        observation: "duplicate observation in target",
        remediation: "fix in src/core/target.ts",
      },
    ]);

    const result = routeCriticReviewFindings(port, "orchestrator", review);
    expect(result.affectedTaskIds).toContain("T-1");
    // Since observation matches and status was open, it is deterministic -> escalated
    expect(result.escalatedTaskIds).toContain("T-1");
  });

  test("routeCriticReviewFindings fallback matches candidate tasks by active/done status when no scope matches", () => {
    const state = workflowState();
    state.tasks["T-1"]!.requirement_ids = ["R-OTHER"];
    state.tasks["T-1"]!.write_scope = ["src/other.ts"];
    state.tasks["T-1"]!.status = "changes_requested";

    const port = new TestPort(state);
    const review = makeReview([
      {
        id: "F-ORPHAN",
        requirement_id: "R-UNMAPPED",
        observation: "generic unmapped observation",
        remediation: "generic remediation",
      },
    ]);

    const result = routeCriticReviewFindings(port, "orchestrator", review);
    expect(result.affectedTaskIds).toContain("T-1");
  });
});

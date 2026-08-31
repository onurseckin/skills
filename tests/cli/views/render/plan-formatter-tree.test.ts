import { describe, expect, test } from "bun:test";
import type { AuditFinding, AuditNotEvaluated } from "../../../../olt/scripts/src/graph/plan-audit.ts";
import {
  formatAutoPartitionBrief,
  formatPlanApplyBrief,
  formatPlanAuditBrief,
  formatPlanClaimBrief,
  formatPlanReplanBrief,
  formatPlanReviewBrief,
  formatPlanValidateStartBrief,
} from "../../../../olt/scripts/src/cli/formatters/plan-formatter.ts";

describe("formatPlanReplanBrief", () => {
  test("names every repair task with its scope, findings count, and gate provenance", () => {
    const brief = formatPlanReplanBrief({
      revision: 4,
      repairRound: 2,
      newTasksCount: 2,
      repairTasks: [
        {
          id: "R-1",
          writeScope: ["src/a"],
          findingsCount: 2,
          gate: "bun test a",
          gateSource: "flag",
        },
        {
          id: "R-2",
          writeScope: ["src/b"],
          findingsCount: 1,
          gate: "bun test b",
          gateSource: "finding",
        },
        {
          id: "R-3",
          writeScope: ["src/c"],
          findingsCount: 1,
          gate: "bun test c",
          gateSource: "parent_task",
        },
      ],
      runId: "run-1",
    });

    expect(brief).toContain("### Plan Recompiled: Wave R2 (Graph Revision 4)");
    expect(brief).toContain("`R-1`, `R-2`, `R-3`");
    expect(brief).toContain("declared by `--gate`");
    expect(brief).toContain("declared by the findings");
    expect(brief).toContain("inherited from the planned task gating this scope");
  });

  test("no repair tasks reads None rather than an empty string", () => {
    const brief = formatPlanReplanBrief({
      revision: 1,
      repairRound: 1,
      newTasksCount: 0,
      repairTasks: [],
      runId: "run-1",
    });
    expect(brief).toContain("**Injected Repair Tasks**: 0 tasks (None)");
  });
});

describe("formatPlanClaimBrief", () => {
  test("names the agent, packet, and fixed planner write scope", () => {
    const brief = formatPlanClaimBrief({ runId: "run-1", agent: "planner-1", packetId: "P-1" });
    expect(brief).toContain("### Planner Packet Issued: run-1");
    expect(brief).toContain("**Agent**: `planner-1`");
    expect(brief).toContain("**Packet**: `P-1`");
    expect(brief).toContain("planning/requirements.json");
  });
});

describe("formatPlanApplyBrief", () => {
  test("confirms the applied revision and total task count", () => {
    const brief = formatPlanApplyBrief({ runId: "run-1", revision: 3, totalTasks: 5 });
    expect(brief).toContain("### Plan Applied: run-1 (Graph Revision 3)");
    expect(brief).toContain("**Total Tasks**: 5");
  });
});

describe("formatAutoPartitionBrief", () => {
  test("lists generated tasks and any gate breadth warnings", () => {
    const brief = formatAutoPartitionBrief({
      glob: "src/**/*.ts",
      groupBy: "file",
      taskIds: ["t1", "t2"],
      totalTasks: 2,
      breadthWarnings: ["t1's gate looks like the whole suite"],
    });

    expect(brief).toContain("### Auto-Partitioned: 2 tasks from `src/**/*.ts`");
    expect(brief).toContain("one task per file");
    expect(brief).toContain("`t1`, `t2`");
    expect(brief).toContain("⚠️ **Gate breadth**: t1's gate looks like the whole suite");
  });

  test("directory grouping with no warnings omits the gate breadth section", () => {
    const brief = formatAutoPartitionBrief({
      glob: "src/*",
      groupBy: "directory",
      taskIds: ["t1"],
      totalTasks: 1,
      breadthWarnings: [],
    });
    expect(brief).toContain("one task per directory");
    expect(brief).not.toContain("Gate breadth");
  });
});

describe("formatPlanAuditBrief", () => {
  function finding(overrides: Partial<AuditFinding> = {}): AuditFinding {
    return {
      invariant: "A1-granularity",
      severity: "blocking",
      message: "task t1 is too coarse",
      task_ids: ["t1"],
      evidence_class: "derived",
      ...overrides,
    };
  }

  test("a clean audit reports zero findings and clears plan:compile", () => {
    const brief = formatPlanAuditBrief({
      runId: "run-1",
      revision: 1,
      findings: [],
      notEvaluated: [],
    });
    expect(brief).toContain("**Findings**: 0 (0 blocking, 0 advisory)");
    expect(brief).toContain("no invariant violations found");
    expect(brief).toContain("no blocking invariant is outstanding");
  });

  test("marks blocking and advisory findings distinctly and demands an override to seal", () => {
    const notEvaluated: AuditNotEvaluated[] = [
      { invariant: "A6-whole-suite-gate", reason: "no gate recorded" },
    ];
    const brief = formatPlanAuditBrief({
      runId: "run-1",
      revision: 2,
      findings: [
        finding(),
        finding({ invariant: "A5-straggler", severity: "advisory", message: "one task lags" }),
      ],
      notEvaluated,
    });

    expect(brief).toContain("**Findings**: 2 (1 blocking, 1 advisory)");
    expect(brief).toContain("🛑 [BLOCKING] `A1-granularity`: task t1 is too coarse");
    expect(brief).toContain("⚠️ [ADVISORY] `A5-straggler`: one task lags");
    expect(brief).toContain("ℹ️ [NOT EVALUATED] `A6-whole-suite-gate`: no gate recorded");
    expect(brief).toContain("--accept-audit <id>:<reason>");
  });
});

describe("formatPlanValidateStartBrief", () => {
  test("carries the bearer token warning and the four review questions", () => {
    const brief = formatPlanValidateStartBrief({
      runId: "run-1",
      validator: "val-1",
      token: "tok_v",
      graphRevision: 2,
      totalTasks: 4,
    });

    expect(brief).toContain("### Plan Validation Opened: run-1 (Graph Revision 2)");
    expect(brief).toContain("never log or persist it");
    expect(brief).toContain("4 compiled tasks");
    expect(brief).toContain("plan:review --status approved");
  });
});

describe("formatPlanReviewBrief", () => {
  test("an approval clears every task to claim under this revision", () => {
    const brief = formatPlanReviewBrief({
      runId: "run-1",
      validator: "val-1",
      status: "approved",
      graphRevision: 2,
      findingsCount: 0,
      summary: "matches the prompt",
      dependencyEdgesReviewed: 1,
      gateIdsReviewed: 2,
    });

    expect(brief).toContain("### Plan Validation Approved: run-1 (Graph Revision 2)");
    expect(brief).toContain("implementers and repairers may now claim tasks");
    expect(brief).toContain("proceed to Phase 2 continuous dispatch.");
    expect(brief).toContain("**Coverage**: 1 dependency edge(s) and 2 gate(s) named");
  });

  test("changes requested blocks every claim against this revision until a fresh compile", () => {
    const brief = formatPlanReviewBrief({
      runId: "run-1",
      validator: "val-1",
      status: "changes_requested",
      graphRevision: 2,
      findingsCount: 3,
      summary: "dependency edge unjustified",
      dependencyEdgesReviewed: 0,
      gateIdsReviewed: 1,
    });

    expect(brief).toContain("### Plan Validation Rejected: run-1 (Graph Revision 2)");
    expect(brief).toContain(
      "**Findings**: 3 — every implementer and repairer claim against graph revision 2 is refused",
    );
    expect(brief).toContain("replan (plan:add / plan:compile)");
  });
});

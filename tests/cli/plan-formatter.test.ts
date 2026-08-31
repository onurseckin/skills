import { describe, expect, test } from "bun:test";
import type { AuditFinding, AuditNotEvaluated } from "../../olt/scripts/src/graph/plan-audit.ts";
import {
  formatAutoPartitionBrief,
  formatCapsuleInitBrief,
  formatPlanApplyBrief,
  formatPlanAuditBrief,
  formatPlanClaimBrief,
  formatPlanCompileBrief,
  formatPlanEnhanceBrief,
  formatPlanReplanBrief,
  formatPlanReviewBrief,
  formatPlanStatusBrief,
  formatPlanValidateStartBrief,
  formatTaskRegisteredBrief,
} from "../../olt/scripts/src/cli/formatters/plan-formatter.ts";

describe("formatPlanStatusBrief with declared dependencies", () => {
  test("names a task's dependencies in its row rather than reporting None", () => {
    const brief = formatPlanStatusBrief("run-1", [
      { id: "t2", label: "T2", writeScope: ["src/b"], gate: "bun test b", deps: ["t1"] },
    ]);
    expect(brief).toContain("| `t2` | T2 | `src/b` | `bun test b` | `t1` |");
  });
});

describe("formatTaskRegisteredBrief with declared dependencies", () => {
  test("names every dependency rather than reporting parallel-readiness", () => {
    const brief = formatTaskRegisteredBrief({
      taskId: "task-2",
      label: "Task Two",
      writeScope: ["src/b"],
      gateCmd: "bun test b",
      deps: ["task-1", "task-0"],
      totalTasks: 2,
      requirementLines: [12, 13],
    });

    expect(brief).toContain("**Dependencies**: `task-1`, `task-0`");
    expect(brief).toContain("Declared prompt lines 12, 13");
  });
});

describe("formatCapsuleInitBrief", () => {
  test("names a supplied runtime pin instead of admitting none was given", () => {
    const brief = formatCapsuleInitBrief({
      runId: "run-1",
      runRoot: ".olt/capsules/run-1",
      promptSha256: "abc123",
      promptBytes: 500,
      assurance: "source-verified",
      bunVersion: "1.3.0",
      runtimePin: { sha256: "def456", files: 12 },
    });

    expect(brief).toContain("Runtime Pin**: `def456` (12 files, see `runtime/`)");
    expect(brief).toContain("Runtime: Bun 1.3.0");
  });
});

describe("formatPlanEnhanceBrief", () => {
  test("reports every count and whether a brief summary was present", () => {
    const brief = formatPlanEnhanceBrief({
      runId: "run-1",
      markdownPath: "plan.md",
      jsonPath: "plan.json",
      markdownSha256: "abc",
      promptSha256: "def",
      revision: 2,
      summaryPresent: true,
      counts: { observations: 3, todos: 2, risks: 1, openQuestions: 4, sources: 5 },
    });

    expect(brief).toContain("### Enhanced Plan Recorded: run-1 (revision 2)");
    expect(brief).toContain("**Brief**: reported | **To-dos**: 2 | **Observations**: 3");
    expect(brief).toContain("**Risks**: 1 | **Open Questions**: 4 | **Sources Read**: 5");
  });

  test("admits when no brief summary was reported", () => {
    const brief = formatPlanEnhanceBrief({
      runId: "run-1",
      markdownPath: "plan.md",
      jsonPath: "plan.json",
      markdownSha256: "abc",
      promptSha256: "def",
      revision: 1,
      summaryPresent: false,
      counts: { observations: 0, todos: 0, risks: 0, openQuestions: 0, sources: 0 },
    });

    expect(brief).toContain("**Brief**: not reported");
  });
});

describe("formatPlanCompileBrief edge cases", () => {
  test("names an empty topology as no eligible wave", () => {
    const brief = formatPlanCompileBrief({
      revision: 1,
      totalTasks: 0,
      topology: { revision: 1, maxParallel: 0, waves: [] },
      topologyDeclaration: { independentRoots: 0, edgeCount: 0 },
      collisions: 0,
      requirementsCount: 0,
      runId: "run-1",
    });

    expect(brief).toContain("**Waves**: none — the scheduler could make no task eligible");
  });

  test("flags tasks that never became eligible for any wave", () => {
    const brief = formatPlanCompileBrief({
      revision: 1,
      totalTasks: 3,
      topology: { revision: 1, maxParallel: 1, waves: [{ wave: 1, taskIds: ["t1"] }] },
      topologyDeclaration: { independentRoots: 1, edgeCount: 0 },
      collisions: 0,
      requirementsCount: 3,
      runId: "run-1",
    });

    expect(brief).toContain("2 task(s) never became eligible and carry no wave");
  });

  test("renders advisories, prompt-binding warnings, audit overrides, and not-evaluated notes", () => {
    const brief = formatPlanCompileBrief({
      revision: 1,
      totalTasks: 1,
      topology: { revision: 1, maxParallel: 1, waves: [{ wave: 1, taskIds: ["t1"] }] },
      topologyDeclaration: { independentRoots: 1, edgeCount: 0 },
      collisions: 0,
      requirementsCount: 1,
      runId: "run-1",
      advisories: ["scope looks broad"],
      warnings: ["task t1 has no requirement lines"],
      auditAccepted: [{ invariant: "A1-granularity", reason: "acceptable for this repo" }],
      auditNotEvaluated: ["A6-whole-suite-gate: no gate command recorded"],
    });

    expect(brief).toContain("⚠️ [ADVISORY]: scope looks broad");
    expect(brief).toContain("⚠️ [PROMPT BINDING]: task t1 has no requirement lines");
    expect(brief).toContain(
      "✅ [AUDIT OVERRIDE]: A1-granularity accepted — acceptable for this repo",
    );
    expect(brief).toContain(
      "ℹ️ [AUDIT NOT EVALUATED]: A6-whole-suite-gate: no gate command recorded",
    );
  });

  test("a single-lane wave is described in the singular", () => {
    const brief = formatPlanCompileBrief({
      revision: 1,
      totalTasks: 1,
      topology: { revision: 1, maxParallel: 1, waves: [{ wave: 1, taskIds: ["t1"] }] },
      topologyDeclaration: { independentRoots: 1, edgeCount: 0 },
      collisions: 0,
      requirementsCount: 1,
      runId: "run-1",
    });
    expect(brief).toContain("(1 parallel lane)");
  });

  test("an empty wave's task list reads None rather than an empty string", () => {
    const brief = formatPlanCompileBrief({
      revision: 1,
      totalTasks: 0,
      topology: { revision: 1, maxParallel: 1, waves: [{ wave: 1, taskIds: [] }] },
      topologyDeclaration: { independentRoots: 0, edgeCount: 0 },
      collisions: 0,
      requirementsCount: 0,
      runId: "run-1",
    });
    expect(brief).toContain("**Wave 1 (Ready Now)**: None (0 parallel lanes)");
  });
});

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

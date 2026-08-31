import { describe, expect, test } from "bun:test";
import {
  formatCapsuleInitBrief,
  formatPlanCompileBrief,
  formatPlanEnhanceBrief,
  formatPlanStatusBrief,
  formatTaskRegisteredBrief,
} from "../../../../olt/scripts/src/cli/formatters/plan-formatter.ts";

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

import { afterAll, describe, expect, test } from "bun:test";
import {
  compileUnifiedHighLeveragePlan,
  detectCapsuleContext,
  expandDynamicPlanUnified,
} from "../../../olt/scripts/src/graph/unified-plan.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { cleanupFixtureRoots, fixtureRepo } from "../audit/plan-audit-fixture.ts";

const roots: string[] = [];
afterAll(() => cleanupFixtureRoots(roots));

describe("unified-plan: detectCapsuleContext", () => {
  test("extracts prompt and state correctly from in-memory context object", () => {
    const memoryContext = {
      prompt: "Feature A\n\nFeature B",
      state: {
        revision: 3,
        tasks: {},
      },
    };

    const ctx = detectCapsuleContext(memoryContext, "/test/repo");
    expect(ctx.prompt).toBe("Feature A\n\nFeature B");
    expect(ctx.runState.revision).toBe(3);
    expect(ctx.repoRoot).toBe("/test/repo");
  });

  test("returns empty defaults when context is null or empty", () => {
    const ctx = detectCapsuleContext(undefined);
    expect(ctx.prompt).toBe("");
    expect(ctx.runState).toEqual({});
    expect(ctx.repoRoot).toBe(".");
  });
});

describe("unified-plan: compileUnifiedHighLeveragePlan", () => {
  test("compiles atomic high-leverage plan with requirements, decoupling, and topology", () => {
    const repo = fixtureRepo(roots);
    const prompt = "Task One\n\nTask Two\n\nTask Three";
    const tasks = [
      {
        id: "task-1",
        label: "Task 1",
        writeScope: ["src/feature-1.ts"],
        gate: "bun test tests/unit/feature-1.test.ts",
        requirementLines: [1],
      },
      {
        id: "task-2",
        label: "Task 2",
        writeScope: ["src/feature-2.ts"],
        gate: "bun test tests/unit/feature-2.test.ts",
        requirementLines: [3],
      },
      {
        id: "task-3",
        label: "Task 3",
        writeScope: ["src/feature-3.ts"],
        gate: "bun test tests/unit/feature-3.test.ts",
        requirementLines: [5],
      },
    ];

    const result = compileUnifiedHighLeveragePlan({
      tasks,
      prompt,
      completionGate: "bun test tests/unit",
      repoRoot: repo,
      autoDecouple: true,
    });

    expect(result.graphDocument.revision).toBe(1);
    expect(result.requirementsDocument.requirements).toHaveLength(3);
    expect(result.bypassDiagnostic.hasBypass).toBe(false);
    expect(result.topology.waves).toHaveLength(1);
    expect(result.topology.waves[0]!.tasks).toHaveLength(3);
    expect(result.topology.metrics.parallelismFactor).toBe(3);
  });

  test("blocks compilation on unaccepted blocking audit finding (e.g. A3-gate-discrimination)", () => {
    const repo = fixtureRepo(roots);
    const tasks = [
      {
        id: "task-a",
        label: "Task A",
        writeScope: ["src/a.ts"],
        gate: "bun test tests/common.test.ts",
      },
      {
        id: "task-b",
        label: "Task B",
        writeScope: ["src/b.ts"],
        gate: "bun test tests/common.test.ts",
      },
    ];

    expect(() =>
      compileUnifiedHighLeveragePlan({
        tasks,
        completionGate: "bun test tests/unit",
        repoRoot: repo,
        autoDecouple: false,
      }),
    ).toThrow(HarnessError);
  });

  test("allows audit override when valid acceptAudit entry is provided", () => {
    const repo = fixtureRepo(roots);
    const tasks = [
      {
        id: "task-a",
        label: "Task A",
        writeScope: ["src/a.ts"],
        gate: "bun test tests/common.test.ts",
      },
      {
        id: "task-b",
        label: "Task B",
        writeScope: ["src/b.ts"],
        gate: "bun test tests/common.test.ts",
      },
    ];

    const result = compileUnifiedHighLeveragePlan({
      tasks,
      completionGate: "bun test tests/unit",
      repoRoot: repo,
      autoDecouple: false,
      acceptAudit: {
        "A3-gate-discrimination": "Both tasks share common integration test fixture",
      },
    });

    expect(result.graphDocument.revision).toBe(1);
    expect(
      result.warnings.some((w) =>
        w.includes("[AUDIT OVERRIDE ACCEPTED]: Invariant A3-gate-discrimination"),
      ),
    ).toBe(true);
  });

  test("rejects plan with illegal transitive bypass edge", () => {
    const repo = fixtureRepo(roots);
    const tasks = [
      {
        id: "task-1",
        label: "Task 1",
        writeScope: ["src/t1.ts"],
        gate: "bun test tests/t1.test.ts",
        deps: [],
      },
      {
        id: "task-2",
        label: "Task 2",
        writeScope: ["src/t2.ts"],
        gate: "bun test tests/t2.test.ts",
        deps: ["task-1"],
      },
      {
        id: "task-3",
        label: "Task 3",
        writeScope: ["src/t3.ts"],
        gate: "bun test tests/t3.test.ts",
        deps: ["task-2", "task-1"],
      },
    ];

    expect(() =>
      compileUnifiedHighLeveragePlan({
        tasks,
        completionGate: "bun test tests/unit",
        repoRoot: repo,
        autoDecouple: false,
        strictBypassCheck: true,
      }),
    ).toThrow(HarnessError);
  });
});

describe("unified-plan: expandDynamicPlanUnified", () => {
  test("re-compiles executable topology and metrics after dynamic expansion", () => {
    const repo = fixtureRepo(roots);
    const initial = compileUnifiedHighLeveragePlan({
      tasks: [
        {
          id: "task-init",
          label: "Initial Task",
          writeScope: ["src/init"],
          gate: "bun test tests/init.test.ts",
        },
      ],
      completionGate: "bun test tests/unit",
      repoRoot: repo,
      autoDecouple: false,
    });

    const expanded = expandDynamicPlanUnified(
      initial.graphDocument,
      {
        wider: [
          {
            newTasks: [
              {
                id: "task-admitted",
                label: "Admitted Parallel Task",
                writeScope: ["src/admitted"],
                gate: "bun test tests/admitted.test.ts",
                deps: ["task-init"],
              },
            ],
          },
        ],
      },
      initial.requirementsDocument,
      { repoRoot: repo },
    );

    expect(expanded.topology.order.length).toBeGreaterThan(1);
    expect(expanded.topology.metrics.totalWork).toBeGreaterThan(1);
    expect(expanded.bypassDiagnostic.hasBypass).toBe(false);
  });
});

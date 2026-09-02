import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  compileUnifiedHighLeveragePlan,
  detectCapsuleContext,
  expandDynamicPlanUnified,
} from "../../../olt/scripts/src/graph/unified-plan.ts";
import { cleanupFixtureRoots, fixtureRepo } from "../audit/plan-audit-fixture.ts";

const roots: string[] = [];
afterAll(() => cleanupFixtureRoots(roots));

describe("unified-plan coverage suite", () => {
  it("detects capsule context from filesystem files with standalone reqs and graph", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "capsule-ctx-"));
    roots.push(tempDir);
    writeFileSync(join(tempDir, "prompt.md"), "Feature prompt\n");
    writeFileSync(join(tempDir, "state.json"), JSON.stringify({ revision: 1 }));
    writeFileSync(join(tempDir, "requirements.json"), JSON.stringify({ reqs: [] }));
    writeFileSync(join(tempDir, "graph.json"), JSON.stringify({ nodes: [] }));

    const ctx = detectCapsuleContext(tempDir, "/mock/repo");
    expect(ctx.prompt).toContain("Feature prompt");
    expect(ctx.requirementsDocument).toEqual({ reqs: [] });
    expect(ctx.graphDocument).toEqual({ nodes: [] });

    const badTemp = mkdtempSync(join(tmpdir(), "capsule-bad-"));
    roots.push(badTemp);
    writeFileSync(join(badTemp, "state.json"), "{bad-json");
    expect(detectCapsuleContext(badTemp).runState).toEqual({});

    const recCtx = detectCapsuleContext({
      runState: { requirements: { id: "r1" }, graph: { id: "g1" } },
      repoRoot: "/custom/root",
    });
    expect(recCtx.repoRoot).toBe("/custom/root");
  });

  it("throws INVALID_ARGUMENT when completionGate or tasks are empty", () => {
    const repo = fixtureRepo(roots);
    expect(() =>
      compileUnifiedHighLeveragePlan({
        tasks: [],
        completionGate: "bun test tests/unit",
        repoRoot: repo,
      }),
    ).toThrow(HarnessError);
    expect(() =>
      compileUnifiedHighLeveragePlan({
        tasks: [{ id: "t1", label: "T1", writeScope: ["a.ts"], gate: "bun test tests/a.test.ts" }],
        completionGate: "   ",
        repoRoot: repo,
      }),
    ).toThrow(HarnessError);
  });

  it("compiles plan with prompt parsing, acceptAudit override, and bypass failure", () => {
    const repo = fixtureRepo(roots);
    const compiled = compileUnifiedHighLeveragePlan({
      prompt: "First Task\n\nSecond Task",
      tasks: [
        {
          id: "task-1",
          label: "Task 1",
          writeScope: ["src/a.ts"],
          gate: "bun test tests/common.test.ts",
          requirementLines: [1],
        },
        {
          id: "task-2",
          label: "Task 2",
          writeScope: ["src/b.ts"],
          gate: "bun test tests/common.test.ts",
          requirementLines: [3],
        },
      ],
      completionGate: "bun test tests/unit",
      repoRoot: repo,
      autoDecouple: false,
      acceptAudit: { "A3-gate-discrimination": "shared integration suite" },
    });
    expect(compiled.graphDocument.revision).toBe(1);
    expect(compiled.warnings.some((w) => w.includes("A3-gate-discrimination"))).toBe(true);

    expect(() =>
      compileUnifiedHighLeveragePlan({
        tasks: [
          { id: "task-1", label: "T1", writeScope: ["src/a.ts"], gate: "bun test tests/a.test.ts" },
          {
            id: "task-2",
            label: "T2",
            writeScope: ["src/a.ts"],
            gate: "bun test tests/b.test.ts",
            deps: ["task-1"],
          },
          {
            id: "task-3",
            label: "T3",
            writeScope: ["src/a.ts"],
            gate: "bun test tests/c.test.ts",
            deps: ["task-2", "task-1"],
          },
        ],
        completionGate: "bun test tests/unit",
        repoRoot: repo,
        strictBypassCheck: true,
      }),
    ).toThrow(HarnessError);
  });

  it("compiles plan without prompt or requirementsDocument using synthetic requirements", () => {
    const repo = fixtureRepo(roots);
    const result = compileUnifiedHighLeveragePlan({
      tasks: [
        {
          id: "task-alpha",
          label: "Alpha",
          goal: "Deliver alpha",
          writeScope: ["src/s.ts"],
          gate: "bun test tests/a.test.ts",
          priority: 80,
          effort: 3,
        },
        {
          id: "task-beta",
          label: "Beta",
          writeScope: ["src/s.ts"],
          gate: ["bun", "test", "tests/b.test.ts"],
          deps: ["task-alpha"],
        },
      ],
      completionGate: ["bun", "test", "tests/unit"],
      repoRoot: repo,
      autoDecouple: true,
    });
    expect(result.requirementsDocument.requirements).toHaveLength(2);
    expect(result.topology.order).toEqual(["task-alpha", "task-beta"]);
  });

  it("handles strictBypassCheck false when transitive bypass exists", () => {
    const repo = fixtureRepo(roots);
    const result = compileUnifiedHighLeveragePlan({
      tasks: [
        { id: "task-1", label: "T1", writeScope: ["src/s.ts"], gate: "bun test tests/1.test.ts" },
        {
          id: "task-2",
          label: "T2",
          writeScope: ["src/s.ts"],
          gate: "bun test tests/2.test.ts",
          deps: ["task-1"],
        },
        {
          id: "task-3",
          label: "T3",
          writeScope: ["src/s.ts"],
          gate: "bun test tests/3.test.ts",
          deps: ["task-2", "task-1"],
        },
      ],
      completionGate: "bun test tests/all.test.ts",
      repoRoot: repo,
      autoDecouple: false,
      strictBypassCheck: false,
    });
    expect(result.bypassDiagnostic.hasBypass).toBe(true);
    expect(result.cognitiveGuidance.length).toBeGreaterThan(0);
  });

  it("expands dynamic plan without requirementsDocument fallback and array gates", () => {
    const repo = fixtureRepo(roots);
    const initialGraph = {
      nodes: [
        { id: "task-1", type: "task", write_scope: ["src/1.ts"], effort: 1 },
        { id: "task-2", type: "task", write_scope: ["src/2.ts"], effort: 2 },
      ],
      edges: [{ source: "task-2", target: "task-1", type: "depends_on" }],
      gates: [
        { id: "gate-1", scope: "task", command: ["bun", "test", "tests/1.test.ts"] },
        { id: "gate-2", scope: "task", command: "bun test tests/2.test.ts" },
      ],
      revision: 1,
    };

    const expanded = expandDynamicPlanUnified(
      initialGraph,
      {
        wider: [
          {
            newTasks: [
              {
                id: "task-3",
                label: "Task 3",
                writeScope: ["src/3.ts"],
                gate: "bun test tests/3.test.ts",
                deps: ["task-1"],
              },
            ],
          },
        ],
      },
      undefined,
      {
        repoRoot: repo,
        prompt: "Expansion prompt",
        runState: { phase: "executing" },
        maxLanes: 10,
      },
    );
    expect(expanded.requirementsDocument).toBeDefined();
    expect(expanded.topology.order.length).toBeGreaterThanOrEqual(3);
  });
});

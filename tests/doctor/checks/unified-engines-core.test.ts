import { describe, expect, test } from "bun:test";
import {
  checkPlanningDag,
  checkAstPurity,
  checkAntiMockMutation,
  checkAntiBatchingIsolation,
} from "../../../olt/scripts/src/reporting/doctor.ts";

export const unifiedEnginesCoreSuiteName =
  "Unified Master Doctor - Core Engines (DAG, AST, Anti-Mock, Anti-Batching)";

describe(unifiedEnginesCoreSuiteName, () => {
  describe("Engine 1: checkPlanningDag", () => {
    test("passes cleanly on valid DAG with correct dependencies", () => {
      const result = checkPlanningDag({
        tasks: {
          "task-1": { id: "task-1", dependencies: [] },
          "task-2": { id: "task-2", dependencies: ["task-1"] },
          "task-3": { id: "task-3", dependencies: ["task-2"] },
        },
      });
      expect(result.passed).toBe(true);
      expect(result.findings.filter((f) => f.severity === "ERROR")).toHaveLength(0);
    });

    test("detects dependency cycles via Tarjan algorithm", () => {
      const result = checkPlanningDag({
        tasks: {
          "task-1": { id: "task-1", dependencies: ["task-3"] },
          "task-2": { id: "task-2", dependencies: ["task-1"] },
          "task-3": { id: "task-3", dependencies: ["task-2"] },
        },
      });
      expect(result.passed).toBe(false);
      const cycleFinding = result.findings.find((f) => f.code === "PLANNING_DAG_CYCLE_DETECTED");
      expect(cycleFinding).toBeDefined();
      expect(cycleFinding?.severity).toBe("ERROR");
      expect(cycleFinding?.message).toContain("task-");
    });

    test("detects self-loop cycle", () => {
      const result = checkPlanningDag({
        tasks: {
          "task-self": { id: "task-self", dependencies: ["task-self"] },
        },
      });
      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.code === "PLANNING_DAG_CYCLE_DETECTED")).toBe(true);
    });

    test("detects missing dependency links", () => {
      const result = checkPlanningDag({
        tasks: {
          "task-1": { id: "task-1", dependencies: ["task-nonexistent"] },
        },
      });
      expect(result.passed).toBe(false);
      const missing = result.findings.find((f) => f.code === "PLANNING_DAG_MISSING_DEPENDENCY");
      expect(missing).toBeDefined();
      expect(missing?.severity).toBe("ERROR");
      expect(missing?.message).toContain("task-nonexistent");
    });

    test("flags orphan/unreachable tasks with warning", () => {
      const result = checkPlanningDag({
        tasks: {
          "task-1": { id: "task-1", dependencies: [] },
          "task-2": { id: "task-2", dependencies: ["task-1"] },
          "task-orphan": { id: "task-orphan", dependencies: [] },
        },
      });
      const orphan = result.findings.find((f) => f.code === "PLANNING_DAG_ORPHAN_TASK");
      expect(orphan).toBeDefined();
      expect(orphan?.severity).toBe("WARN");
    });
  });

  describe("Engine 2: checkAstPurity", () => {
    test("passes cleanly when code is pure without any suppressions", () => {
      const result = checkAstPurity({
        fileContents: {
          "src/clean.ts": `
            export function add(a: number, b: number): number {
              return a + b;
            }
          `,
        },
      });
      expect(result.passed).toBe(true);
      expect(result.findings).toHaveLength(0);
    });

    test("flags @ts-ignore and @ts-expect-error as ERROR", () => {
      const result = checkAstPurity({
        fileContents: {
          "src/dirty.ts": `
            // @ts-ignore
            const x = 1;
            // @ts-expect-error
            const y = 2;
          `,
        },
      });
      expect(result.passed).toBe(false);
      expect(result.findings).toHaveLength(2);
      expect(result.findings[0]?.severity).toBe("ERROR");
      expect(result.findings[0]?.message).toContain("@ts-ignore");
      expect(result.findings[1]?.message).toContain("@ts-expect-error");
    });

    test("flags : any, as any, and <any> as ERROR", () => {
      const result = checkAstPurity({
        fileContents: {
          "src/any-usage.ts": `
            let item: any = 123;
            const casted = item as any;
            const generic = <any>item;
          `,
        },
      });
      expect(result.passed).toBe(false);
      expect(result.findings.length).toBeGreaterThanOrEqual(3);
      expect(result.findings.every((f) => f.severity === "ERROR")).toBe(true);
    });
  });

  describe("Engine 3: checkAntiMockMutation", () => {
    test("passes cleanly on proper tests with system verification", () => {
      const result = checkAntiMockMutation({
        fileContents: {
          "tests/valid.test.ts": `
            test("adds numbers correctly", () => {
              const sum = add(2, 3);
              expect(sum).toBe(5);
            });
          `,
        },
      });
      expect(result.passed).toBe(true);
      expect(result.findings).toHaveLength(0);
    });

    test("flags empty test body as ERROR", () => {
      const result = checkAntiMockMutation({
        fileContents: {
          "tests/empty.test.ts": `
            test("empty test body", () => {});
            it("async empty test", async () => {});
          `,
        },
      });
      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.code === "ANTI_MOCK_EMPTY_TEST_BODY")).toBe(true);
      expect(result.findings.every((f) => f.severity === "ERROR")).toBe(true);
    });

    test("flags trivial true assertions as ERROR", () => {
      const result = checkAntiMockMutation({
        fileContents: {
          "tests/trivial.test.ts": `
            test("trivial check", () => {
              expect(true).toBe(true);
              expect(true).toBeTruthy();
              expect(1).toBe(1);
            });
          `,
        },
      });
      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.code === "ANTI_MOCK_TRIVIAL_ASSERTION")).toBe(true);
      expect(result.findings.every((f) => f.severity === "ERROR")).toBe(true);
    });

    test("flags counterfactual lack of falsifiability as ERROR", () => {
      const result = checkAntiMockMutation({
        counterfactualRecords: [
          {
            name: "falsification-check-1",
            passed: true,
            falsified: false,
            baselinePassed: true,
            message: "Mutated test did not fail",
          },
        ],
      });
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "COUNTERFACTUAL_NOT_FALSIFIABLE");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
    });
  });

  describe("Engine 4: checkAntiBatchingIsolation", () => {
    test("passes cleanly on 1:1 task-to-agent leases with disjoint write scopes", () => {
      const result = checkAntiBatchingIsolation({
        tasks: {
          "task-1": {
            id: "task-1",
            status: "in_progress",
            assigned_agent: "agent-1",
            write_scope: ["src/moduleA/**"],
          },
          "task-2": {
            id: "task-2",
            status: "in_progress",
            assigned_agent: "agent-2",
            write_scope: ["src/moduleB/**"],
          },
        },
      });
      expect(result.passed).toBe(true);
      expect(result.findings).toHaveLength(0);
    });

    test("flags single agent holding active leases across multiple concurrent tasks", () => {
      const result = checkAntiBatchingIsolation({
        tasks: {
          "task-1": {
            id: "task-1",
            status: "in_progress",
            assigned_agent: "agent-overworked",
            write_scope: ["src/moduleA.ts"],
          },
          "task-2": {
            id: "task-2",
            status: "in_progress",
            assigned_agent: "agent-overworked",
            write_scope: ["src/moduleB.ts"],
          },
        },
      });
      expect(result.passed).toBe(false);
      const finding = result.findings.find(
        (f) => f.code === "ANTI_BATCHING_MULTIPLE_ACTIVE_LEASES",
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain("agent-overworked");
    });

    test("flags overlapping write scopes across concurrent active tasks", () => {
      const result = checkAntiBatchingIsolation({
        tasks: {
          "task-1": {
            id: "task-1",
            status: "in_progress",
            assigned_agent: "agent-1",
            write_scope: ["src/shared/utils.ts"],
          },
          "task-2": {
            id: "task-2",
            status: "in_progress",
            assigned_agent: "agent-2",
            write_scope: ["src/shared/**"],
          },
        },
      });
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "ANTI_BATCHING_WRITE_SCOPE_COLLISION");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain("task-1");
      expect(finding?.message).toContain("task-2");
    });
  });
});

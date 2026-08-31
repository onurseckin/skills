import { describe, expect, test } from "bun:test";
import {
  checkPlanningDag,
  checkAstPurity,
  checkAntiMockMutation,
  checkAntiBatchingIsolation,
  checkDualChannelUi,
  checkCognitiveValidatorCommandLock,
  checkRoleBoundaryInterlock,
  checkPushbackQuotas,
  MIN_ADVERSARIAL_PROBES,
  MANDATORY_COGNITIVE_PUSHBACKS,
} from "../../../olt/scripts/src/reporting/doctor.ts";

describe("Unified Master Doctor - 8 Check Engines", () => {
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

  describe("Engine 5: checkDualChannelUi", () => {
    test("passes cleanly on high-contrast WCAG AA compliant theme pairs", () => {
      const result = checkDualChannelUi({
        themeElements: [
          {
            selector: "main.text",
            name: "Main Text",
            theme: "light",
            foregroundColor: "#000000",
            backgroundColor: "#ffffff",
            isLargeText: false,
          },
          {
            selector: "main.text",
            name: "Main Text",
            theme: "dark",
            foregroundColor: "#ffffff",
            backgroundColor: "#000000",
            isLargeText: false,
          },
        ],
      });
      expect(result.passed).toBe(true);
      expect(result.findings).toHaveLength(0);
    });

    test("detects low-contrast theme pairs failing WCAG AA", () => {
      const result = checkDualChannelUi({
        themeElements: [
          {
            selector: "failing.text",
            name: "Failing Text",
            theme: "light",
            foregroundColor: "#777777",
            backgroundColor: "#888888",
            isLargeText: false,
          },
        ],
      });
      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.code === "DUAL_CHANNEL_CONTRAST_DEFECT")).toBe(true);
    });

    test("flags missing terminal ASCII or ANSI channels when required", () => {
      const result = checkDualChannelUi({
        asciiChannelSample: "",
        ansiChannelSample: "\x1b[32mOK\x1b[0m",
      });
      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.code === "TERMINAL_ASCII_CHANNEL_MISSING")).toBe(true);
    });
  });

  describe("Engine 6: checkCognitiveValidatorCommandLock", () => {
    test("allows implementers to execute commands but blocks validator/critic roles", () => {
      const cleanResult = checkCognitiveValidatorCommandLock({
        grants: [{ id: "agent-impl", role: "implementer" }],
        commands: {
          cmd1: { id: "cmd1", agent_id: "agent-impl", command: "bun test" },
        },
      });
      expect(cleanResult.passed).toBe(true);
      expect(cleanResult.findings).toHaveLength(0);

      const violationResult = checkCognitiveValidatorCommandLock({
        grants: [
          { id: "agent-val", role: "validator" },
          { id: "agent-critic", role: "completeness-critic" },
        ],
        commands: {
          cmd1: { id: "cmd1", agent_id: "agent-val", command: "bun test" },
          cmd2: { id: "cmd2", agent_id: "agent-critic", command: "ls -la" },
        },
      });
      expect(violationResult.passed).toBe(false);
      expect(violationResult.findings).toHaveLength(2);
      expect(violationResult.findings.every((f) => f.severity === "ERROR")).toBe(true);
      expect(violationResult.findings[0]?.code).toBe("COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION");
    });
  });

  describe("Engine 7: checkRoleBoundaryInterlock", () => {
    test("detects supervisor zero-file-edit rule violations", () => {
      const result = checkRoleBoundaryInterlock({
        grants: [
          {
            id: "orch-1",
            role: "orchestrator",
            tools_used: ["write_to_file", "replace_file_content"],
          },
        ],
      });
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "ROLE_BOUNDARY_SUPERVISOR_CODE_EDIT");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain("orch-1");
    });

    test("detects implementer planning graph mutations and self-approvals", () => {
      const result = checkRoleBoundaryInterlock({
        grants: [{ id: "impl-1", role: "implementer" }],
        events: [
          {
            name: "plan-brainstormed",
            actor: "impl-1",
            payload: { role: "implementer" },
          },
          {
            name: "task-satisfied",
            actor: "impl-1",
            payload: {
              task_id: "task-1",
              implementer_id: "impl-1",
              role: "implementer",
            },
          },
        ],
      });
      expect(result.passed).toBe(false);
      expect(
        result.findings.some((f) => f.code === "ROLE_BOUNDARY_IMPLEMENTER_PLAN_MUTATION"),
      ).toBe(true);
      expect(
        result.findings.some((f) => f.code === "ROLE_BOUNDARY_IMPLEMENTER_SELF_APPROVAL"),
      ).toBe(true);
    });
  });

  describe("Engine 8: checkPushbackQuotas", () => {
    test("enforces MIN_ADVERSARIAL_PROBES = 5 and MANDATORY_COGNITIVE_PUSHBACKS = 5", () => {
      expect(MIN_ADVERSARIAL_PROBES).toBe(5);
      expect(MANDATORY_COGNITIVE_PUSHBACKS).toBe(5);

      const passedResult = checkPushbackQuotas({
        tasks: {
          "task-done": {
            id: "task-done",
            status: "satisfied",
            adversarial_probes: [1, 2, 3, 4, 5],
            cognitive_pushbacks: [1, 2, 3, 4, 5],
          },
        },
      });
      expect(passedResult.passed).toBe(true);
      expect(passedResult.findings.filter((f) => f.severity === "ERROR")).toHaveLength(0);

      const failedResult = checkPushbackQuotas({
        tasks: {
          "task-deficit": {
            id: "task-deficit",
            status: "satisfied",
            adversarial_probes: [1, 2],
            cognitive_pushbacks: [1, 2, 3],
          },
        },
      });
      expect(failedResult.passed).toBe(false);
      expect(
        failedResult.findings.some((f) => f.code === "PUSHBACK_QUOTA_ADVERSARIAL_PROBES_DEFICIT"),
      ).toBe(true);
      expect(
        failedResult.findings.some((f) => f.code === "PUSHBACK_QUOTA_COGNITIVE_PUSHBACKS_DEFICIT"),
      ).toBe(true);
    });
  });
});

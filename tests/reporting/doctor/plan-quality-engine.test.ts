import { describe, expect, test } from "bun:test";
import {
  checkPlanQualityAndAgentUtilization,
  type PlanQualityCheckOptions,
} from "../../../olt/scripts/src/reporting/doctor/plan-quality-engine.ts";
import { generateRemedialGuidance } from "../../../olt/scripts/src/reporting/doctor/guidance.ts";
import { collectDiagnosticEngines } from "../../../olt/scripts/src/reporting/doctor/diagnostic-collector.ts";

export const planQualityEngineSuiteName = "Doctor Plan Quality & Planning Agent Utilization Engine";

function createPassingPlan(): PlanQualityCheckOptions {
  const prompt = "Detailed user problem specification and acceptance criteria. ".repeat(15);
  const desc =
    "Comprehensive implementation specification covering requirements, error handling, invariants, and tests.".padEnd(
      120,
      ".",
    );
  return {
    state: {
      prompt,
      tasks: {
        "task-1": {
          id: "task-1",
          description: desc,
          requirementLines: [1, 2],
          write_scope: ["olt/scripts/src/subsystem_a/file1.ts"],
        },
        "task-2": {
          id: "task-2",
          description: desc,
          requirementLines: [3, 4],
          write_scope: ["olt/scripts/src/subsystem_a/file2.ts"],
        },
      },
      plan_review: { status: "approved", validator_id: "val-1" },
      epistemic: { confidenceScore: 0.95 },
    },
    events: [
      { name: "plan:enhance", actor: "planner-1" },
      { name: "plan:brainstorm", actor: "planner-1" },
      { name: "plan:review", actor: "val-1", status: "approved" },
    ],
  };
}

describe(planQualityEngineSuiteName, () => {
  describe("Empty Run & Initial State", () => {
    test("passes cleanly with no findings on empty options", () => {
      const res = checkPlanQualityAndAgentUtilization({});
      expect(res.passed).toBe(true);
      expect(res.findings).toHaveLength(0);
    });

    test("passes cleanly when state is null or tasks object is empty", () => {
      expect(checkPlanQualityAndAgentUtilization({ state: null }).passed).toBe(true);
      expect(checkPlanQualityAndAgentUtilization({ state: { tasks: {} } }).passed).toBe(true);
      expect(checkPlanQualityAndAgentUtilization({ state: { tasks: [] } }).passed).toBe(true);
    });
  });

  describe("Clean Passing Plan", () => {
    test("passes cleanly when all 6 quality & utilization criteria are satisfied", () => {
      const res = checkPlanQualityAndAgentUtilization(createPassingPlan());
      expect(res.passed).toBe(true);
      expect(res.findings).toHaveLength(0);
    });
  });

  describe("Flaw 1: SHALLOW_PLAN_CONTEXT_FLAW", () => {
    test("flags ERROR when prompt is under 500 characters", () => {
      const plan = createPassingPlan();
      (plan.state as Record<string, unknown>).prompt = "Short prompt context";
      const res = checkPlanQualityAndAgentUtilization(plan);
      expect(res.passed).toBe(false);
      const f = res.findings.find((x) => x.code === "SHALLOW_PLAN_CONTEXT_FLAW");
      expect(f).toBeDefined();
      expect(f?.severity).toBe("ERROR");
    });

    test("flags ERROR when any task description is under 100 characters", () => {
      const plan = createPassingPlan();
      const tasks = (plan.state as Record<string, unknown>).tasks as Record<
        string,
        Record<string, unknown>
      >;
      tasks["task-1"]!.description = "Trivial short description";
      const res = checkPlanQualityAndAgentUtilization(plan);
      expect(res.passed).toBe(false);
      const f = res.findings.find((x) => x.code === "SHALLOW_PLAN_CONTEXT_FLAW");
      expect(f).toBeDefined();
      expect(f?.severity).toBe("ERROR");
    });

    test("flags ERROR when plan has zero line coordinate mappings", () => {
      const plan = createPassingPlan();
      const tasks = (plan.state as Record<string, unknown>).tasks as Record<
        string,
        Record<string, unknown>
      >;
      delete tasks["task-1"]!.requirementLines;
      delete tasks["task-2"]!.requirementLines;
      const res = checkPlanQualityAndAgentUtilization(plan);
      expect(res.passed).toBe(false);
      const f = res.findings.find((x) => x.code === "SHALLOW_PLAN_CONTEXT_FLAW");
      expect(f).toBeDefined();
      expect(f?.severity).toBe("ERROR");
    });
  });

  describe("Flaw 2: UNUTILIZED_PLANNING_AGENTS_FLAW", () => {
    test("flags ERROR when plan compiled without planner session or plan:enhance", () => {
      const plan = createPassingPlan();
      (plan as { events: unknown[] }).events = [
        { name: "plan:brainstorm", actor: "coordinator" },
        { name: "plan:review", actor: "val-1", status: "approved" },
      ];
      const res = checkPlanQualityAndAgentUtilization(plan);
      expect(res.passed).toBe(false);
      const f = res.findings.find((x) => x.code === "UNUTILIZED_PLANNING_AGENTS_FLAW");
      expect(f).toBeDefined();
      expect(f?.severity).toBe("ERROR");
    });
  });

  describe("Flaw 3: MISSING_EIGHT_VECTOR_EXPANSION_FLAW", () => {
    test("flags ERROR when plan lacks plan:brainstorm events", () => {
      const plan = createPassingPlan();
      (plan as { events: unknown[] }).events = [
        { name: "plan:enhance", actor: "planner-1" },
        { name: "plan:review", actor: "val-1", status: "approved" },
      ];
      const res = checkPlanQualityAndAgentUtilization(plan);
      expect(res.passed).toBe(false);
      const f = res.findings.find((x) => x.code === "MISSING_EIGHT_VECTOR_EXPANSION_FLAW");
      expect(f).toBeDefined();
      expect(f?.severity).toBe("ERROR");
    });
  });

  describe("Flaw 4: MISSING_PLAN_VALIDATOR_AUDIT", () => {
    test("flags ERROR when plan lacks approved plan:review from validator", () => {
      const plan = createPassingPlan();
      delete (plan.state as Record<string, unknown>).plan_review;
      (plan as { events: unknown[] }).events = [
        { name: "plan:enhance", actor: "planner-1" },
        { name: "plan:brainstorm", actor: "planner-1" },
      ];
      const res = checkPlanQualityAndAgentUtilization(plan);
      expect(res.passed).toBe(false);
      const f = res.findings.find((x) => x.code === "MISSING_PLAN_VALIDATOR_AUDIT");
      expect(f).toBeDefined();
      expect(f?.severity).toBe("ERROR");
    });
  });

  describe("Flaw 5: EPISTEMIC_CONFIDENCE_DEFICIT", () => {
    test("flags WARN when epistemic confidence score is below 0.85 threshold", () => {
      const plan = createPassingPlan();
      (plan.state as Record<string, unknown>).epistemic = { confidenceScore: 0.75 };
      const res = checkPlanQualityAndAgentUtilization(plan);
      expect(res.passed).toBe(true);
      const f = res.findings.find((x) => x.code === "EPISTEMIC_CONFIDENCE_DEFICIT");
      expect(f).toBeDefined();
      expect(f?.severity).toBe("WARN");
    });
  });

  describe("Flaw 6: PLAN_GRANULARITY_VIOLATION", () => {
    test("flags ERROR when plan spans > 2 subsystems", () => {
      const plan = createPassingPlan();
      const tasks = (plan.state as Record<string, unknown>).tasks as Record<
        string,
        Record<string, unknown>
      >;
      tasks["task-1"]!.targetSubsystems = ["subsystem-a", "subsystem-b", "subsystem-c"];
      const res = checkPlanQualityAndAgentUtilization(plan);
      expect(res.passed).toBe(false);
      const f = res.findings.find((x) => x.code === "PLAN_GRANULARITY_VIOLATION");
      expect(f).toBeDefined();
      expect(f?.severity).toBe("ERROR");
    });

    test("flags ERROR when plan exceeds 6 tasks", () => {
      const plan = createPassingPlan();
      const tasks = (plan.state as Record<string, unknown>).tasks as Record<
        string,
        Record<string, unknown>
      >;
      for (let i = 3; i <= 7; i++) {
        tasks[`task-${i}`] = { ...tasks["task-1"], id: `task-${i}` };
      }
      const res = checkPlanQualityAndAgentUtilization(plan);
      expect(res.passed).toBe(false);
      const f = res.findings.find((x) => x.code === "PLAN_GRANULARITY_VIOLATION");
      expect(f).toBeDefined();
      expect(f?.severity).toBe("ERROR");
    });

    test("flags ERROR when a task exceeds 3 files", () => {
      const plan = createPassingPlan();
      const tasks = (plan.state as Record<string, unknown>).tasks as Record<
        string,
        Record<string, unknown>
      >;
      tasks["task-1"]!.files = ["a.ts", "b.ts", "c.ts", "d.ts"];
      const res = checkPlanQualityAndAgentUtilization(plan);
      expect(res.passed).toBe(false);
      const f = res.findings.find((x) => x.code === "PLAN_GRANULARITY_VIOLATION");
      expect(f).toBeDefined();
      expect(f?.severity).toBe("ERROR");
    });
  });

  describe("Doctor Remedial Guidance Generation", () => {
    test("maps all 6 finding codes to deterministic remediation commands", () => {
      const codes = [
        "SHALLOW_PLAN_CONTEXT_FLAW",
        "UNUTILIZED_PLANNING_AGENTS_FLAW",
        "MISSING_EIGHT_VECTOR_EXPANSION_FLAW",
        "MISSING_PLAN_VALIDATOR_AUDIT",
        "EPISTEMIC_CONFIDENCE_DEFICIT",
        "PLAN_GRANULARITY_VIOLATION",
      ] as const;

      const findings = codes.map((code) => ({
        code,
        severity: (code === "EPISTEMIC_CONFIDENCE_DEFICIT" ? "WARN" : "ERROR") as "ERROR" | "WARN",
        engine: "checkPlanQualityAndAgentUtilization",
        message: `Defect triggered for ${code}`,
      }));

      const res = generateRemedialGuidance({
        runRoot: "/tmp/capsules/test-run",
        findings,
      });

      expect(res.remedialActions).toHaveLength(6);
      expect(res.guidanceSummary).toHaveLength(6);

      const actionMap = new Map(res.remedialActions.map((a) => [a.issueCode, a.command]));
      expect(actionMap.get("SHALLOW_PLAN_CONTEXT_FLAW")).toContain(
        "plan:enhance --run /tmp/capsules/test-run --deepen-context",
      );
      expect(actionMap.get("UNUTILIZED_PLANNING_AGENTS_FLAW")).toContain(
        "plan:enhance --run /tmp/capsules/test-run --actor planner",
      );
      expect(actionMap.get("MISSING_EIGHT_VECTOR_EXPANSION_FLAW")).toContain(
        "plan:brainstorm --run /tmp/capsules/test-run --actor planner",
      );
      expect(actionMap.get("MISSING_PLAN_VALIDATOR_AUDIT")).toContain(
        "plan:validate-start --run /tmp/capsules/test-run --validator val-1",
      );
      expect(actionMap.get("EPISTEMIC_CONFIDENCE_DEFICIT")).toContain(
        "plan:enhance --run /tmp/capsules/test-run --deepen-context",
      );
      expect(actionMap.get("PLAN_GRANULARITY_VIOLATION")).toContain(
        "plan:replan --run /tmp/capsules/test-run --actor coordinator",
      );
    });
  });

  describe("Diagnostic Collector Integration", () => {
    test("collectDiagnosticEngines aggregates checkPlanQualityAndAgentUtilization", () => {
      const plan = createPassingPlan();
      const coll = collectDiagnosticEngines({
        state: plan.state,
        events: plan.events,
      });
      expect(coll.engineResults.checkPlanQualityAndAgentUtilization).toBeDefined();
      expect(coll.engineResults.checkPlanQualityAndAgentUtilization.passed).toBe(true);
    });
  });
});

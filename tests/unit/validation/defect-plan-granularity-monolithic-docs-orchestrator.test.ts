import { describe, expect, test } from "bun:test";
import {
  assertPlanGranularityCompliance,
  auditPlanningDirectoryForMonolithicPlans,
  createPlanGranularityDefectEntry,
  decomposeMonolithicPlan,
  DEFECT_REF,
  DOCUMENTATION_ORCHESTRATOR_DECOMPOSED_PLANS,
  extractPlanMarkdown,
  MAX_PLAN_TASK_COUNT,
  MAX_SUBSYSTEMS_PER_PLAN,
  MONOLITHIC_PLAN_DEFECT,
  type PlanDescriptor,
  PlanGranularityViolationError,
  validatePlanGranularity,
} from "../../../olt/scripts/src/validation/defect-plan-granularity-monolithic-docs-orchestrator.ts";

describe("Task 1.13: defect-plan-granularity-monolithic-docs-orchestrator", () => {
  test("1. defect constants are strictly defined", () => {
    expect(DEFECT_REF).toBe("defect-plan-granularity-monolithic-docs-orchestrator");
    expect(MONOLITHIC_PLAN_DEFECT).toBe("MONOLITHIC_PLAN_DEFECT");
    expect(MAX_PLAN_TASK_COUNT).toBe(15);
    expect(MAX_SUBSYSTEMS_PER_PLAN).toBe(3);
    expect(DOCUMENTATION_ORCHESTRATOR_DECOMPOSED_PLANS.length).toBe(4);
  });

  test("2. decomposed sub-plans adhere to granularity limits (<= 15 tasks, <= 3 subsystems)", () => {
    for (const subPlan of DOCUMENTATION_ORCHESTRATOR_DECOMPOSED_PLANS) {
      const validation = validatePlanGranularity(subPlan);
      expect(validation.valid).toBe(true);
      expect(validation.violations.length).toBe(0);
      expect(subPlan.subsystems.length).toBeLessThanOrEqual(MAX_SUBSYSTEMS_PER_PLAN);
      expect(subPlan.tasks.length).toBeLessThanOrEqual(MAX_PLAN_TASK_COUNT);
      expect(subPlan.tasks.length).toBeGreaterThan(0);
    }
  });

  test("3. PlanGranularityViolationError constructs with correct metadata and prototype", () => {
    const err = new PlanGranularityViolationError("Monolithic plan error", [], "plan-abc");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PlanGranularityViolationError);
    expect(err.name).toBe("PlanGranularityViolationError");
    expect(err.code).toBe(MONOLITHIC_PLAN_DEFECT);
    expect(err.defectRef).toBe(DEFECT_REF);
    expect(err.planId).toBe("plan-abc");
    expect(err.message).toBe("Monolithic plan error");
  });

  test("4. extractPlanMarkdown parses markdown headings, tracking IDs, subsystems, and tasks", () => {
    const md = [
      "# Sample Engine Plan",
      "> **Tracking ID:** `fb-sample-engine`",
      "> **Target Subsystems:** `olt/scripts/src/docs/`, `olt/agents/`",
      "### Task 1.1: First Task",
      "### Task 1.2: Second Task",
      "- **Task 1.3:** Third Task",
    ].join("\n");

    const desc = extractPlanMarkdown(md, "fallback-id");
    expect(desc.id).toBe("fb-sample-engine");
    expect(desc.title).toBe("Sample Engine Plan");
    expect(desc.subsystems).toEqual(["olt/scripts/src/docs/", "olt/agents/"]);
    expect(desc.tasks.length).toBe(3);
  });

  test("5. validatePlanGranularity approves compliant plans", () => {
    const plan: PlanDescriptor = {
      id: "atomic-subplan",
      title: "Atomic Sub-Plan",
      subsystems: ["olt/agents/", "olt/scripts/src/docs/"],
      tasks: [
        { id: "Task 1.1", description: "First sub-task" },
        { id: "Task 1.2", description: "Second sub-task" },
      ],
    };
    const res = validatePlanGranularity(plan);
    expect(res.valid).toBe(true);
    expect(res.taskCount).toBe(2);
    expect(res.subsystemCount).toBe(2);
    expect(res.violations).toEqual([]);
    expect(res.defectRef).toBe(DEFECT_REF);
  });

  test("6. validatePlanGranularity flags task count exceeding MAX_PLAN_TASK_COUNT (15)", () => {
    const tasks = Array.from({ length: 16 }, (_, i) => ({
      id: `Task 1.${i + 1}`,
      description: `Task ${i + 1}`,
    }));
    const plan: PlanDescriptor = {
      id: "huge-task-plan",
      title: "Huge Task Plan",
      subsystems: ["olt/scripts/src/docs/"],
      tasks,
    };
    const res = validatePlanGranularity(plan);
    expect(res.valid).toBe(false);
    expect(res.violations.some((v) => v.rule === "MAX_TASKS_EXCEEDED")).toBe(true);
    expect(res.taskCount).toBe(16);
  });

  test("7. validatePlanGranularity flags subsystem count exceeding MAX_SUBSYSTEMS_PER_PLAN (3)", () => {
    const plan: PlanDescriptor = {
      id: "multi-subsystem-plan",
      title: "Multi Subsystem Plan",
      subsystems: ["sub/a", "sub/b", "sub/c", "sub/d", "sub/e"],
      tasks: [{ id: "Task 1.1", description: "Single task" }],
    };
    const res = validatePlanGranularity(plan);
    expect(res.valid).toBe(false);
    expect(res.violations.some((v) => v.rule === "MAX_SUBSYSTEMS_EXCEEDED")).toBe(true);
    expect(res.subsystemCount).toBe(5);
  });

  test("8. validatePlanGranularity detects both task and subsystem violations on monolithic plans", () => {
    const tasks = Array.from({ length: 20 }, (_, i) => ({
      id: `Task ${i + 1}`,
      description: `Task desc ${i + 1}`,
    }));
    const plan: PlanDescriptor = {
      id: "monolithic-mega-plan",
      title: "Monolithic Mega Plan",
      subsystems: ["sub/1", "sub/2", "sub/3", "sub/4"],
      tasks,
    };
    const res = validatePlanGranularity(plan);
    expect(res.valid).toBe(false);
    expect(res.violations.length).toBe(2);
    expect(res.violations.some((v) => v.rule === "MAX_TASKS_EXCEEDED")).toBe(true);
    expect(res.violations.some((v) => v.rule === "MAX_SUBSYSTEMS_EXCEEDED")).toBe(true);
  });

  test("9. validatePlanGranularity identifies empty plans when allowEmpty is not set", () => {
    const plan: PlanDescriptor = {
      id: "empty-plan",
      title: "Empty Plan",
      subsystems: ["sub/1"],
      tasks: [],
    };
    const res = validatePlanGranularity(plan);
    expect(res.valid).toBe(false);
    expect(res.violations.some((v) => v.rule === "EMPTY_PLAN")).toBe(true);

    const allowed = validatePlanGranularity(plan, { allowEmpty: true });
    expect(allowed.valid).toBe(true);
  });

  test("10. decomposeMonolithicPlan splits monolithic plans into compliant sub-plans", () => {
    const tasks = Array.from({ length: 20 }, (_, i) => ({
      id: `Task ${i + 1}`,
      description: `Task desc ${i + 1}`,
    }));
    const monolithic: PlanDescriptor = {
      id: "docs-monolith",
      title: "Docs Orchestrator Monolith",
      subsystems: [
        "olt/agents/",
        "olt/references/",
        "olt/scripts/src/docs/",
        "olt/scripts/src/cli/",
        "olt/scripts/src/policy/",
      ],
      tasks,
    };

    const decomposed = decomposeMonolithicPlan(monolithic);
    expect(decomposed.length).toBeGreaterThan(1);
    for (const subPlan of decomposed) {
      const v = validatePlanGranularity(subPlan);
      expect(v.valid).toBe(true);
      expect(subPlan.tasks.length).toBeLessThanOrEqual(MAX_PLAN_TASK_COUNT);
      expect(subPlan.subsystems.length).toBeLessThanOrEqual(MAX_SUBSYSTEMS_PER_PLAN);
    }
  });

  test("11. decomposeMonolithicPlan returns compliant plan unmodified", () => {
    const compliant: PlanDescriptor = {
      id: "already-atomic",
      title: "Already Atomic",
      subsystems: ["olt/agents/"],
      tasks: [{ id: "Task 1.1", description: "Doc task" }],
    };
    const result = decomposeMonolithicPlan(compliant);
    expect(result.length).toBe(1);
    expect(result[0]?.id).toBe("already-atomic");
  });

  test("12. assertPlanGranularityCompliance passes on compliant plans and throws on violations", () => {
    const validPlan: PlanDescriptor = {
      id: "valid-plan",
      title: "Valid Plan",
      subsystems: ["olt/agents/"],
      tasks: [{ id: "Task 1.1", description: "Task desc" }],
    };
    expect(() => assertPlanGranularityCompliance(validPlan)).not.toThrow();

    const invalidPlan: PlanDescriptor = {
      id: "invalid-plan",
      title: "Invalid Plan",
      subsystems: ["sub/1", "sub/2", "sub/3", "sub/4", "sub/5"],
      tasks: [{ id: "Task 1.1", description: "Task desc" }],
    };
    expect(() => assertPlanGranularityCompliance(invalidPlan)).toThrow(
      PlanGranularityViolationError,
    );
  });

  test("13. auditPlanningDirectoryForMonolithicPlans scans planning directories", () => {
    const audit = auditPlanningDirectoryForMonolithicPlans("docs/planning", { recursive: true });
    expect(audit.auditedPlans).toBeGreaterThan(0);
    expect(audit.defectRef).toBe(DEFECT_REF);
    expect(Array.isArray(audit.results)).toBe(true);
  });

  test("14. createPlanGranularityDefectEntry creates standard DefectEntry with correct metadata", () => {
    const defect = createPlanGranularityDefectEntry({
      planId: "docs-orchestrator",
      status: "resolved",
      severity: "high",
    });

    expect(defect.domain).toBe("planning-governance");
    expect(defect.error_code).toBe(MONOLITHIC_PLAN_DEFECT);
    expect(defect.status).toBe("resolved");
    expect(defect.severity).toBe("high");
    expect(defect.type).toBe("MODULARITY_VIOLATION");
    expect(defect.category).toBe("modularity_violation");
    expect(defect.title).toContain("docs-orchestrator");
    expect(defect.remediation).toContain("atomic sub-plans");
  });
});

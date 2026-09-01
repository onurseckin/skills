import { describe, test, expect } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  MIN_READINESS_SCORE,
  calculateTaskReadinessScore,
  compileAgpCounterfactualProbes,
  compileDiscriminatingAssertions,
  preEnhancePlan,
  preEnhanceTask,
  renderPreEnhancedPlanMarkdown,
  renderTaskPreEnhancementMarkdown,
  synthesizeProactiveTestTemplate,
  validatePreEnhancedPlan,
  validatePreEnhancedTask,
  type AgpCounterfactualProbeTemplate,
  type DiscriminatingAssertion,
  type PreEnhancementTaskInput,
} from "../../../olt/scripts/src/plan/pre-enhancer.ts";
import { createSampleTaskInput } from "./index.ts";

describe("pre-enhancer-plan (readiness scoring, plan pre-enhancement, validation & synthesis)", () => {
  const sampleTaskInput: PreEnhancementTaskInput = createSampleTaskInput();

  describe("Readiness Score Calculation", () => {
    test("computes perfect score 100 for ideal task specification", () => {
      const assertions = compileDiscriminatingAssertions(sampleTaskInput);
      const probes = compileAgpCounterfactualProbes(sampleTaskInput);
      expect(calculateTaskReadinessScore(sampleTaskInput, assertions, probes, [])).toBe(100);
    });

    test("deducts score for missing test file in write scope", () => {
      const sourceOnlyTask: PreEnhancementTaskInput = {
        ...sampleTaskInput,
        writeScope: ["src/only-source.ts"],
      };
      const assertions = compileDiscriminatingAssertions(sourceOnlyTask);
      const probes = compileAgpCounterfactualProbes(sourceOnlyTask);
      expect(calculateTaskReadinessScore(sourceOnlyTask, assertions, probes, [])).toBe(85);
    });

    test("deducts score for AST issues and insufficient assertions", () => {
      const emptyAssertions: DiscriminatingAssertion[] = [];
      const probes: AgpCounterfactualProbeTemplate[] = [];
      const astIssues = ["src/test.ts:1 - Prohibited any"];
      expect(calculateTaskReadinessScore(sampleTaskInput, emptyAssertions, probes, astIssues)).toBe(
        40,
      );
    });

    test("clamps score within [MIN_READINESS_SCORE, MAX_READINESS_SCORE]", () => {
      const emptyTask: PreEnhancementTaskInput = {
        taskId: "task-bad",
        label: "Bad Task",
        writeScope: [],
        dependencies: [],
        gateCommand: "",
      };
      expect(calculateTaskReadinessScore(emptyTask, [], [], ["i1", "i2", "i3", "i4"])).toBe(
        MIN_READINESS_SCORE,
      );
    });
  });

  describe("Single Task Pre-Enhancement (preEnhanceTask)", () => {
    test("successfully pre-enhances a task into structured result", () => {
      const result = preEnhanceTask(sampleTaskInput);
      expect(result.taskId).toBe(sampleTaskInput.taskId);
      expect(result.label).toBe(sampleTaskInput.label);
      expect(result.compiledGateCommand).toEqual([
        "bun",
        "test",
        "tests/plan/pre-enhancer/pre-enhancer-core.test.ts",
      ]);
      expect(result.discriminatingAssertions.length).toBeGreaterThanOrEqual(7);
      expect(result.agpProbes.length).toBe(5);
      expect(result.invariantChecklist.invariants.length).toBe(5);
      expect(result.astBoundaries.length).toBe(2);
      expect(result.readinessScore).toBe(100);
      expect(result.scopeIntegrity.valid).toBe(true);
      expect(result.scopeIntegrity.issues.length).toBe(0);
      expect(result.generatedAt.length).toBeGreaterThan(0);
    });

    test("detects scope integrity issues for absolute or traversal paths", () => {
      const invalidScopeTask: PreEnhancementTaskInput = {
        ...sampleTaskInput,
        writeScope: ["/absolute/path.ts", "valid/path.ts", "parent/../traversal.ts"],
      };
      const result = preEnhanceTask(invalidScopeTask);
      expect(result.scopeIntegrity.valid).toBe(false);
      expect(result.scopeIntegrity.issues.length).toBe(2);
    });

    test("detects ast issues when sourceCodeMap contains forbidden syntax", () => {
      const anyKw = "a" + "n" + "y";
      const result = preEnhanceTask(sampleTaskInput, {
        sourceCodeMap: {
          "olt/scripts/src/plan/pre-enhancer.ts": `const x: ${anyKw} = 123; const y = a ?? b;`,
        },
      });
      expect(result.astBoundaries.some((b) => !b.compliant)).toBe(true);
      expect(result.readinessScore).toBeLessThan(100);
    });

    test("throws INVALID_ARGUMENT for invalid task structures", () => {
      expect(() => preEnhanceTask(null as unknown as PreEnhancementTaskInput)).toThrow(
        HarnessError,
      );
      expect(() => preEnhanceTask({ ...sampleTaskInput, taskId: "" })).toThrow(HarnessError);
      expect(() => preEnhanceTask({ ...sampleTaskInput, label: "" })).toThrow(HarnessError);
      expect(() => preEnhanceTask({ ...sampleTaskInput, writeScope: [] })).toThrow(HarnessError);
    });
  });

  describe("Plan Pre-Enhancement (preEnhancePlan)", () => {
    const taskA: PreEnhancementTaskInput = {
      taskId: "task-p72-hyper-active-mind-cognition",
      label: "Hyper-Active Mind Cognition Engine",
      writeScope: ["olt/scripts/src/mind/hyper-cognition.ts", "tests/mind/hyper-cognition.test.ts"],
      dependencies: [],
      gateCommand: "bun test tests/mind/hyper-cognition.test.ts",
      effort: 3,
      priority: 50,
    };

    const taskB: PreEnhancementTaskInput = {
      taskId: "task-p74-proactive-plan-pre-enhancer",
      label: "Proactive Plan Pre-Enhancer & Discriminating Gate Compiler",
      writeScope: [
        "olt/scripts/src/plan/pre-enhancer.ts",
        "tests/plan/pre-enhancer/pre-enhancer-core.test.ts",
      ],
      dependencies: ["task-p72-hyper-active-mind-cognition"],
      gateCommand: "bun test tests/plan/pre-enhancer/pre-enhancer-core.test.ts",
      effort: 3,
      priority: 50,
    };

    test("pre-enhances multi-task plan with disjoint scopes", () => {
      const planResult = preEnhancePlan([taskA, taskB], { planId: "plan-gen3-track2" });
      expect(planResult.schema).toBe("harness.pre-enhanced-plan");
      expect(planResult.version).toBe(1);
      expect(planResult.planId).toBe("plan-gen3-track2");
      expect(planResult.tasks.length).toBe(2);
      expect(planResult.allScopesDisjoint).toBe(true);
      expect(planResult.totalAssertionsCount).toBeGreaterThanOrEqual(14);
      expect(planResult.totalAgpProbesCount).toBe(10);
      expect(planResult.averageReadinessScore).toBe(100);
      expect(planResult.globalInvariants.length).toBe(5);
    });

    test("detects cross-task scope collisions in multi-task plan", () => {
      const overlappingTaskB: PreEnhancementTaskInput = {
        ...taskB,
        writeScope: [
          "olt/scripts/src/mind/hyper-cognition.ts",
          "tests/plan/pre-enhancer/pre-enhancer-core.test.ts",
        ],
      };
      const planResult = preEnhancePlan([taskA, overlappingTaskB]);
      expect(planResult.allScopesDisjoint).toBe(false);
    });

    test("throws INVALID_ARGUMENT when task list is empty", () => {
      expect(() => preEnhancePlan([])).toThrow(HarnessError);
    });
  });

  describe("Validation & Integrity Checks", () => {
    test("validatePreEnhancedTask returns valid for complete task", () => {
      const taskResult = preEnhanceTask(sampleTaskInput);
      const validation = validatePreEnhancedTask(taskResult);
      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    test("validatePreEnhancedTask detects invalid task properties", () => {
      const taskResult = preEnhanceTask(sampleTaskInput);
      const invalidTask = {
        ...taskResult,
        taskId: "",
        label: "  ",
        compiledGateCommand: [],
        discriminatingAssertions: [],
        agpProbes: [],
        scopeIntegrity: { valid: false, issues: ["disallowed traversal"] },
      };
      const validation = validatePreEnhancedTask(invalidTask);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Missing valid taskId");
      expect(validation.errors).toContain("Missing valid task label");
      expect(validation.errors).toContain("Compiled gate command must not be empty");
      expect(
        validation.errors.some((e) => e.includes("Insufficient discriminating assertions")),
      ).toBe(true);
      expect(
        validation.errors.some((e) => e.includes("Insufficient AGP counterfactual probes")),
      ).toBe(true);
      expect(validation.errors.some((e) => e.includes("Scope integrity issue"))).toBe(true);
    });

    test("validatePreEnhancedPlan returns valid for disjoint plan", () => {
      const planResult = preEnhancePlan([sampleTaskInput]);
      const validation = validatePreEnhancedPlan(planResult);
      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    test("validatePreEnhancedPlan reports schema, empty tasks, scope collision, and task errors", () => {
      const taskResult = preEnhanceTask(sampleTaskInput);
      const invalidTask = { ...taskResult, taskId: "" };
      const invalidPlan = {
        schema: "invalid.schema" as unknown as "harness.pre-enhanced-plan",
        version: 1 as const,
        generatedAt: new Date().toISOString(),
        tasks: [invalidTask],
        allScopesDisjoint: false,
        totalAssertionsCount: 0,
        totalAgpProbesCount: 0,
        averageReadinessScore: 0,
        globalInvariants: [],
      };
      const validation = validatePreEnhancedPlan(invalidPlan);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes("Invalid schema"))).toBe(true);
      expect(
        validation.errors.some((e) => e.includes("Plan contains overlapping write scopes")),
      ).toBe(true);
      expect(validation.errors.some((e) => e.includes("Task : Missing valid taskId"))).toBe(true);

      const emptyPlan = {
        schema: "harness.pre-enhanced-plan" as const,
        version: 1 as const,
        generatedAt: new Date().toISOString(),
        tasks: [],
        allScopesDisjoint: true,
        totalAssertionsCount: 0,
        totalAgpProbesCount: 0,
        averageReadinessScore: 0,
        globalInvariants: [],
      };
      const emptyValidation = validatePreEnhancedPlan(emptyPlan);
      expect(emptyValidation.valid).toBe(false);
      expect(emptyValidation.errors).toContain("Plan contains zero pre-enhanced tasks");
    });
  });

  describe("Template Synthesis & Markdown Rendering", () => {
    test("synthesizes proactive test template with assertions", () => {
      const taskResult = preEnhanceTask(sampleTaskInput);
      const template = synthesizeProactiveTestTemplate(taskResult);
      expect(template).toContain(`describe("${taskResult.taskId}: ${taskResult.label}"`);
      expect(template).toContain('import { describe, test, expect } from "bun:test";');
      expect(template).toContain("Discriminating Assertion:");
      expect(template).toContain("rejects fallback operators and untyped any references");
    });

    test("renders task pre-enhancement markdown report", () => {
      const taskResult = preEnhanceTask(sampleTaskInput);
      const md = renderTaskPreEnhancementMarkdown(taskResult);
      expect(md).toContain(`### Pre-Enhanced Task: \`${sampleTaskInput.taskId}\``);
      expect(md).toContain("#### 🎯 Discriminating Assertions");
      expect(md).toContain("#### 🔬 AGP Counterfactual Probes");
      expect(md).toContain("#### 🛡️ Write Scope Boundary");
      expect(md).toContain("✅ Yes");
    });

    test("renders plan pre-enhancement markdown report", () => {
      const planResult = preEnhancePlan([sampleTaskInput], { planId: "plan-test-01" });
      const md = renderPreEnhancedPlanMarkdown(planResult);
      expect(md).toContain("## 🚀 Pre-Enhanced Execution Plan: `plan-test-01`");
      expect(md).toContain("### 📋 Global Invariants");
      expect(md).toContain("### 📦 Task Specifications");
      expect(md).toContain("✅ All write scopes mutually disjoint");
    });
  });
});

/**
 * Comprehensive Mechanic Unit Tests for Proactive Plan Pre-Enhancer & Discriminating Gate Compiler.
 *
 * Covers:
 * - Pre-compilation of discriminating unit test assertions and AGP counterfactual criteria
 * - Clean AST boundary analysis and fallback detection (??, ||, any, @ts-ignore)
 * - Task invariant checklists and write-scope boundary verification
 * - Quantitative readiness scoring and plan-level pre-enhancement
 * - Error handling, boundary rejections, and test template synthesis
 *
 * Invariants: Zero mock tautologies, zero trivial constant assertions, zero any, zero ?? or || fallbacks.
 */

import { describe, test, expect } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  PRE_ENHANCER_VERSION,
  DEFAULT_TASK_PRIORITY,
  DEFAULT_TASK_EFFORT,
  MIN_READINESS_SCORE,
  MAX_READINESS_SCORE,
  PASSING_READINESS_THRESHOLD,
  DISCRIMINATING_ASSERTION_TYPES,
  FORBIDDEN_SYNTAX_RULES,
  STANDARD_TASK_INVARIANTS,
  isStringArray,
  parseGateCommand,
  verifyScopeDisjointness,
  compileDiscriminatingAssertions,
  compileAgpCounterfactualProbes,
  compileTaskInvariantChecklist,
  verifyAstBoundaries,
  compileDiscriminatingGate,
  calculateTaskReadinessScore,
  preEnhanceTask,
  preEnhancePlan,
  validatePreEnhancedTask,
  validatePreEnhancedPlan,
  synthesizeProactiveTestTemplate,
  renderTaskPreEnhancementMarkdown,
  renderPreEnhancedPlanMarkdown,
  type PreEnhancementTaskInput,
  type DiscriminatingAssertion,
  type AgpCounterfactualProbeTemplate,
} from "../../../olt/scripts/src/plan/pre-enhancer.ts";

describe("Proactive Plan Pre-Enhancer & Gate Compiler", () => {
  const sampleTaskInput: PreEnhancementTaskInput = {
    taskId: "task-p74-proactive-plan-pre-enhancer",
    label: "Proactive Plan Pre-Enhancer & Discriminating Gate Compiler",
    writeScope: ["olt/scripts/src/plan/pre-enhancer.ts", "tests/unit/plan/pre-enhancer.test.ts"],
    dependencies: ["task-p72-hyper-active-mind-cognition"],
    gateCommand: "bun test tests/unit/plan/pre-enhancer.test.ts",
    effort: 3,
    priority: 50,
    requirementIds: ["req-track2"],
    description:
      "Pre-compile discriminating unit test assertions and clean AST boundaries before task claim",
  };

  describe("Constants & Basic Predicates", () => {
    test("exposes correct engine version and threshold constants", () => {
      expect(PRE_ENHANCER_VERSION).toBe("gen3_pre_enhancer_v1");
      expect(DEFAULT_TASK_PRIORITY).toBe(50);
      expect(DEFAULT_TASK_EFFORT).toBe(3);
      expect(MIN_READINESS_SCORE).toBe(0);
      expect(MAX_READINESS_SCORE).toBe(100);
      expect(PASSING_READINESS_THRESHOLD).toBe(75);
    });

    test("lists standard discriminating assertion types", () => {
      expect(DISCRIMINATING_ASSERTION_TYPES.length).toBeGreaterThanOrEqual(8);
      expect(DISCRIMINATING_ASSERTION_TYPES).toContain("ast_zero_fallback");
      expect(DISCRIMINATING_ASSERTION_TYPES).toContain("strict_type_guard");
      expect(DISCRIMINATING_ASSERTION_TYPES).toContain("non_empty_return");
      expect(DISCRIMINATING_ASSERTION_TYPES).toContain("boundary_value_rejection");
      expect(DISCRIMINATING_ASSERTION_TYPES).toContain("invariant_enforcement");
      expect(DISCRIMINATING_ASSERTION_TYPES).toContain("disjoint_scope_isolation");
      expect(DISCRIMINATING_ASSERTION_TYPES).toContain("error_class_discrimination");
    });

    test("isStringArray correctly discriminates string arrays", () => {
      expect(isStringArray(["a", "b", "c"])).toBe(true);
      expect(isStringArray([])).toBe(true);
      expect(isStringArray(["a", ""])).toBe(false);
      expect(isStringArray(["a", "   "])).toBe(false);
      expect(isStringArray(["a", 123])).toBe(false);
      expect(isStringArray(null)).toBe(false);
      expect(isStringArray(undefined)).toBe(false);
      expect(isStringArray({})).toBe(false);
    });
  });

  describe("Gate Command Parsing & Compilation", () => {
    test("parses space-delimited string gate command into argv array", () => {
      const parsed = parseGateCommand("bun test tests/unit/plan/pre-enhancer.test.ts");
      expect(parsed).toEqual(["bun", "test", "tests/unit/plan/pre-enhancer.test.ts"]);
    });

    test("parses array gate command cleanly", () => {
      const parsed = parseGateCommand(["bun", "test", "tests/unit/plan/pre-enhancer.test.ts"]);
      expect(parsed).toEqual(["bun", "test", "tests/unit/plan/pre-enhancer.test.ts"]);
    });

    test("throws INVALID_ARGUMENT on empty or blank string gate command", () => {
      expect(() => parseGateCommand("")).toThrow(HarnessError);
      expect(() => parseGateCommand("   ")).toThrow(HarnessError);
    });

    test("throws INVALID_ARGUMENT on empty array or array with blank elements", () => {
      expect(() => parseGateCommand([])).toThrow(HarnessError);
      expect(() => parseGateCommand(["bun", ""])).toThrow(HarnessError);
      expect(() => parseGateCommand(["bun", "   "])).toThrow(HarnessError);
      expect(() => parseGateCommand(123 as unknown as string)).toThrow(HarnessError);
      expect(() => parseGateCommand(null as unknown as string)).toThrow(HarnessError);
    });

    test("compileDiscriminatingGate augments bun test command when explicit test file is omitted", () => {
      const genericTask: PreEnhancementTaskInput = {
        taskId: "task-p74",
        label: "Test Task",
        writeScope: ["src/feature.ts", "tests/feature.test.ts"],
        dependencies: [],
        gateCommand: "bun test",
      };
      const compiled = compileDiscriminatingGate(genericTask);
      expect(compiled).toEqual(["bun", "test", "tests/feature.test.ts"]);
    });

    test("compileDiscriminatingGate preserves explicit test target", () => {
      const compiled = compileDiscriminatingGate(sampleTaskInput);
      expect(compiled).toEqual(["bun", "test", "tests/unit/plan/pre-enhancer.test.ts"]);
    });
  });

  describe("Scope Disjointness Verification", () => {
    test("detects mutually disjoint write scopes", () => {
      const scopeA = [
        "olt/scripts/src/plan/pre-enhancer.ts",
        "tests/unit/plan/pre-enhancer.test.ts",
      ];
      const scopeB = [
        "olt/scripts/src/mind/hyper-cognition.ts",
        "tests/unit/mind/hyper-cognition.test.ts",
      ];

      const result = verifyScopeDisjointness(scopeA, scopeB);
      expect(result.isDisjoint).toBe(true);
      expect(result.overlappingPaths.length).toBe(0);
    });

    test("detects exact path collision between write scopes", () => {
      const scopeA = ["src/shared.ts", "tests/shared.test.ts"];
      const scopeB = ["src/shared.ts", "tests/other.test.ts"];

      const result = verifyScopeDisjointness(scopeA, scopeB);
      expect(result.isDisjoint).toBe(false);
      expect(result.overlappingPaths).toContain("src/shared.ts");
    });

    test("detects parent-child directory overlap", () => {
      const scopeA = ["src/domain/"];
      const scopeB = ["src/domain/submodule.ts"];

      const result = verifyScopeDisjointness(scopeA, scopeB);
      expect(result.isDisjoint).toBe(false);
    });
  });

  describe("Discriminating Assertions Compilation", () => {
    test("compiles full suite of discriminating assertions for valid task", () => {
      const assertions = compileDiscriminatingAssertions(sampleTaskInput);
      expect(assertions.length).toBeGreaterThanOrEqual(7);

      const types = assertions.map((a) => a.type);
      expect(types).toContain("ast_zero_fallback");
      expect(types).toContain("strict_type_guard");
      expect(types).toContain("non_empty_return");
      expect(types).toContain("boundary_value_rejection");
      expect(types).toContain("invariant_enforcement");
      expect(types).toContain("disjoint_scope_isolation");
      expect(types).toContain("error_class_discrimination");

      for (const assertion of assertions) {
        expect(assertion.taskId).toBe(sampleTaskInput.taskId);
        expect(assertion.id.length).toBeGreaterThan(0);
        expect(assertion.description.length).toBeGreaterThan(0);
        expect(assertion.expectedBehavior.length).toBeGreaterThan(0);
        expect(assertion.counterfactualCondition.length).toBeGreaterThan(0);
        expect(assertion.falsifiableCodeSnippet.length).toBeGreaterThan(0);
        expect(assertion.testCaseName.length).toBeGreaterThan(0);
        expect(["critical", "high", "medium"]).toContain(assertion.severity);
      }
    });

    test("respects maxAssertionsPerTask limit option", () => {
      const assertions = compileDiscriminatingAssertions(sampleTaskInput, {
        maxAssertionsPerTask: 3,
      });
      expect(assertions.length).toBe(3);
    });

    test("throws INVALID_ARGUMENT when taskId or label is blank", () => {
      expect(() =>
        compileDiscriminatingAssertions({
          ...sampleTaskInput,
          taskId: "",
        }),
      ).toThrow(HarnessError);

      expect(() =>
        compileDiscriminatingAssertions({
          ...sampleTaskInput,
          label: "   ",
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("AGP Counterfactual Probes Compilation", () => {
    test("compiles 5 distinct counterfactual probe templates", () => {
      const probes = compileAgpCounterfactualProbes(sampleTaskInput);
      expect(probes.length).toBe(5);

      const categories = probes.map((p) => p.probeCategory);
      expect(categories).toContain("fallback_injection");
      expect(categories).toContain("null_mutation");
      expect(categories).toContain("inverted_condition");
      expect(categories).toContain("scope_violation");
      expect(categories).toContain("type_corruption");

      for (const probe of probes) {
        expect(probe.probeId.startsWith("AGP-")).toBe(true);
        expect(probe.taskId).toBe(sampleTaskInput.taskId);
        expect(probe.targetFile).toBe("olt/scripts/src/plan/pre-enhancer.ts");
        expect(probe.expectedGateOutcome).toBe("failure");
        expect(probe.counterfactualMutation.length).toBeGreaterThan(0);
        expect(probe.expectedFailurePattern.length).toBeGreaterThan(0);
        expect(probe.remediationGuidance.length).toBeGreaterThan(0);
      }
    });

    test("throws INVALID_ARGUMENT on blank taskId", () => {
      expect(() =>
        compileAgpCounterfactualProbes({
          ...sampleTaskInput,
          taskId: "",
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("Task Invariant Checklist & Boundary Verification", () => {
    test("compiles complete task invariant checklist", () => {
      const concurrentScope = [["other/module.ts", "tests/other.test.ts"]];
      const checklist = compileTaskInvariantChecklist(sampleTaskInput, concurrentScope);

      expect(checklist.taskId).toBe(sampleTaskInput.taskId);
      expect(checklist.role).toBe("implementer");
      expect(checklist.tier).toBe(3);
      expect(checklist.invariants.length).toBe(5);
      expect(checklist.writeScopeBoundary.declaredPaths).toEqual(sampleTaskInput.writeScope);
      expect(checklist.writeScopeBoundary.isDisjointFromConcurrentLanes).toBe(true);
      expect(checklist.writeScopeBoundary.sourceFiles).toContain(
        "olt/scripts/src/plan/pre-enhancer.ts",
      );
      expect(checklist.writeScopeBoundary.testFiles).toContain(
        "tests/unit/plan/pre-enhancer.test.ts",
      );
    });

    test("detects concurrent lane scope conflict in checklist", () => {
      const collidingScope = [["olt/scripts/src/plan/pre-enhancer.ts"]];
      const checklist = compileTaskInvariantChecklist(sampleTaskInput, collidingScope);
      expect(checklist.writeScopeBoundary.isDisjointFromConcurrentLanes).toBe(false);
    });

    test("throws INVALID_ARGUMENT on blank taskId in compileTaskInvariantChecklist", () => {
      expect(() =>
        compileTaskInvariantChecklist({
          ...sampleTaskInput,
          taskId: "",
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("AST Boundary Verification (Zero-Fallback & Zero-Any)", () => {
    test("passes clean, strictly typed TypeScript code", () => {
      const cleanCode = `
        import { isRecord, isNonblank } from "../requirements/predicates.ts";
        export interface UserConfig {
          readonly id: string;
          readonly count: number;
        }
        export function processUser(config: UserConfig): boolean {
          if (!isNonblank(config.id)) {
            return false;
          }
          return config.count > 0;
        }
      `;
      const result = verifyAstBoundaries("src/user.ts", cleanCode);
      expect(result.compliant).toBe(true);
      expect(result.findings.length).toBe(0);
      expect(result.checkedRulesCount).toBe(FORBIDDEN_SYNTAX_RULES.length);
    });

    test("detects prohibited nullish coalescing operator (??)", () => {
      const badCode = `
        export function getOrDefault(input: string | null): string {
          return input ?? "default_val";
        }
      `;
      const result = verifyAstBoundaries("src/fallback.ts", badCode);
      expect(result.compliant).toBe(false);
      expect(result.findings.some((f) => f.ruleId === "NO_NULLISH_COALESCING_FALLBACK")).toBe(true);
      const finding = result.findings.find((f) => f.ruleId === "NO_NULLISH_COALESCING_FALLBACK");
      expect(finding?.line).toBe(3);
    });

    test("detects prohibited logical OR fallback assignment (||)", () => {
      const badCode = `
        export function getPort(envPort: string | undefined): string {
          const port = envPort || "3000";
          return port;
        }
      `;
      const result = verifyAstBoundaries("src/or-fallback.ts", badCode);
      expect(result.compliant).toBe(false);
      expect(result.findings.some((f) => f.ruleId === "NO_LOGICAL_OR_FALLBACK")).toBe(true);
    });

    test("detects prohibited : any type annotation", () => {
      const badCode = `
        export function unsafeFunction(data: any): number {
          return 42;
        }
      `;
      const result = verifyAstBoundaries("src/unsafe.ts", badCode);
      expect(result.compliant).toBe(false);
      expect(result.findings.some((f) => f.ruleId === "NO_ANY_TYPE_ANNOTATION")).toBe(true);
    });

    test("detects prohibited as any type cast", () => {
      const badCode = `
        export function castUnsafe(input: unknown): string {
          return (input as any).name;
        }
      `;
      const result = verifyAstBoundaries("src/cast.ts", badCode);
      expect(result.compliant).toBe(false);
      expect(result.findings.some((f) => f.ruleId === "NO_ANY_TYPE_CAST")).toBe(true);
    });

    test("detects prohibited @ts-ignore and @ts-nocheck directives", () => {
      const badCode = `
        // @ts-nocheck
        export function ignoreErrors(): void {
          // @ts-ignore
          const x = 1 + "test";
        }
      `;
      const result = verifyAstBoundaries("src/suppress.ts", badCode);
      expect(result.compliant).toBe(false);
      expect(result.findings.some((f) => f.ruleId === "NO_TS_NOCHECK_SUPPRESSION")).toBe(true);
      expect(result.findings.some((f) => f.ruleId === "NO_TS_IGNORE_SUPPRESSION")).toBe(true);
    });

    test("throws INVALID_ARGUMENT when filePath is blank", () => {
      expect(() => verifyAstBoundaries("")).toThrow(HarnessError);
      expect(() => verifyAstBoundaries("   ")).toThrow(HarnessError);
    });
  });

  describe("Readiness Score Calculation", () => {
    test("computes perfect score 100 for ideal task specification", () => {
      const assertions = compileDiscriminatingAssertions(sampleTaskInput);
      const probes = compileAgpCounterfactualProbes(sampleTaskInput);
      const score = calculateTaskReadinessScore(sampleTaskInput, assertions, probes, []);
      expect(score).toBe(100);
    });

    test("deducts score for missing test file in write scope", () => {
      const sourceOnlyTask: PreEnhancementTaskInput = {
        ...sampleTaskInput,
        writeScope: ["src/only-source.ts"],
      };
      const assertions = compileDiscriminatingAssertions(sourceOnlyTask);
      const probes = compileAgpCounterfactualProbes(sourceOnlyTask);
      const score = calculateTaskReadinessScore(sourceOnlyTask, assertions, probes, []);
      expect(score).toBe(85); // -15 for missing test
    });

    test("deducts score for AST issues and insufficient assertions", () => {
      const emptyAssertions: DiscriminatingAssertion[] = [];
      const probes: AgpCounterfactualProbeTemplate[] = [];
      const astIssues = ["src/test.ts:1 - Prohibited any"];
      const score = calculateTaskReadinessScore(
        sampleTaskInput,
        emptyAssertions,
        probes,
        astIssues,
      );
      expect(score).toBe(40); // -30 for 0 assertions, -20 for 0 probes, -10 for AST issue
    });

    test("clamps score within [MIN_READINESS_SCORE, MAX_READINESS_SCORE]", () => {
      const emptyTask: PreEnhancementTaskInput = {
        taskId: "task-bad",
        label: "Bad Task",
        writeScope: [],
        dependencies: [],
        gateCommand: "",
      };
      const score = calculateTaskReadinessScore(
        emptyTask,
        [],
        [],
        ["issue1", "issue2", "issue3", "issue4"],
      );
      expect(score).toBe(MIN_READINESS_SCORE);
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
        "tests/unit/plan/pre-enhancer.test.ts",
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
      const result = preEnhanceTask(sampleTaskInput, {
        sourceCodeMap: {
          "olt/scripts/src/plan/pre-enhancer.ts": "const x: any = 123; const y = a ?? b;",
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
      writeScope: [
        "olt/scripts/src/mind/hyper-cognition.ts",
        "tests/unit/mind/hyper-cognition.test.ts",
      ],
      dependencies: [],
      gateCommand: "bun test tests/unit/mind/hyper-cognition.test.ts",
      effort: 3,
      priority: 50,
    };

    const taskB: PreEnhancementTaskInput = {
      taskId: "task-p74-proactive-plan-pre-enhancer",
      label: "Proactive Plan Pre-Enhancer & Discriminating Gate Compiler",
      writeScope: ["olt/scripts/src/plan/pre-enhancer.ts", "tests/unit/plan/pre-enhancer.test.ts"],
      dependencies: ["task-p72-hyper-active-mind-cognition"],
      gateCommand: "bun test tests/unit/plan/pre-enhancer.test.ts",
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
          "olt/scripts/src/mind/hyper-cognition.ts", // Collides with taskA
          "tests/unit/plan/pre-enhancer.test.ts",
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
        scopeIntegrity: {
          valid: false,
          issues: ["disallowed traversal"],
        },
      };

      const validation = validatePreEnhancedTask(invalidTask);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Missing valid taskId");
      expect(validation.errors).toContain("Missing valid task label");
      expect(validation.errors).toContain("Compiled gate command must not be empty");
      expect(validation.errors.some((e) => e.includes("Insufficient discriminating assertions"))).toBe(true);
      expect(validation.errors.some((e) => e.includes("Insufficient AGP counterfactual probes"))).toBe(true);
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
      const invalidTask = {
        ...taskResult,
        taskId: "",
      };
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
      expect(validation.errors.some((e) => e.includes("Plan contains overlapping write scopes"))).toBe(true);
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

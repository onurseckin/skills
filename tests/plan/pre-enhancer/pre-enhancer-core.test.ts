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
  isStringArray,
  parseGateCommand,
  verifyScopeDisjointness,
  compileDiscriminatingAssertions,
  compileAgpCounterfactualProbes,
  compileTaskInvariantChecklist,
  compileDiscriminatingGate,
  type PreEnhancementTaskInput,
} from "../../../olt/scripts/src/plan/pre-enhancer.ts";
import { createSampleTaskInput, PRE_ENHANCER_SUITES } from "./index.ts";

describe("pre-enhancer-core (constants, gate compilation, assertions, AGP probes & invariants)", () => {
  const sampleTaskInput: PreEnhancementTaskInput = createSampleTaskInput();

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
      const parsed = parseGateCommand("bun test tests/plan/pre-enhancer/pre-enhancer-core.test.ts");
      expect(parsed).toEqual(["bun", "test", "tests/plan/pre-enhancer/pre-enhancer-core.test.ts"]);
    });

    test("parses array gate command cleanly", () => {
      const parsed = parseGateCommand(["bun", "test", "tests/plan/pre-enhancer/pre-enhancer-core.test.ts"]);
      expect(parsed).toEqual(["bun", "test", "tests/plan/pre-enhancer/pre-enhancer-core.test.ts"]);
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
      expect(compiled).toEqual(["bun", "test", "tests/plan/pre-enhancer/pre-enhancer-core.test.ts"]);
    });
  });

  describe("Scope Disjointness Verification", () => {
    test("detects mutually disjoint write scopes", () => {
      const scopeA = [
        "olt/scripts/src/plan/pre-enhancer.ts",
        "tests/plan/pre-enhancer/pre-enhancer-core.test.ts",
      ];
      const scopeB = [
        "olt/scripts/src/mind/hyper-cognition.ts",
        "tests/mind/hyper-cognition.test.ts",
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
        "tests/plan/pre-enhancer/pre-enhancer-core.test.ts",
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

    test("validates facade suites", () => {
      expect(PRE_ENHANCER_SUITES.length).toBe(3);
    });
  });
});

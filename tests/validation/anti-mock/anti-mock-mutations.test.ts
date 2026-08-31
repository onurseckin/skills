import { describe, expect, test } from "bun:test";
import {
  AntiMockEngine,
  checkAssertionFloor,
  evaluateAntiMock,
  formatAntiMockReport,
  generateMutants,
  lintTestAst,
  runMutationGate,
} from "../../../olt/scripts/src/validation/index.ts";
import type {
  AntiMockDiagnosticReport,
  AntiMockEvaluationInput,
  MutantRecord,
  MutationTestRunOutcome,
} from "../../../olt/scripts/src/validation/anti-mock/index.ts";



describe("Pillar 3: Mutation Gate Engine", () => {
  test("generates mutations across boolean, arithmetic, return, comparison, and function body types", () => {
    const code = `
      export function calculateDiscount(price: number, isVip: boolean): number {
        if (price > 100 && isVip === true) {
          return price * 0.8;
        }
        if (!isVip) {
          return price;
        }
        return price - 10;
      }
      export function getGreeting(name: string): string {
        return "Hello " + name;
      }
    `;

    const mutants = generateMutants(code);
    expect(mutants.length).toBeGreaterThan(5);

    const mutationTypes = new Set(mutants.map((m) => m.mutationType));
    expect(mutationTypes.has("invert_boolean")).toBe(true);
    expect(mutationTypes.has("comparison_mutation")).toBe(true);
    expect(mutationTypes.has("logical_operator_mutation")).toBe(true);
    expect(mutationTypes.has("arithmetic_mutation")).toBe(true);
    expect(mutationTypes.has("flip_return_value")).toBe(true);
    expect(mutationTypes.has("strip_function_body")).toBe(true);
    expect(mutationTypes.has("string_literal_mutation")).toBe(true);

    for (const mutant of mutants) {
      expect(mutant.id).toMatch(/^mutant-\d+$/);
      expect(mutant.line).toBeGreaterThan(0);
      expect(mutant.column).toBeGreaterThan(0);
      expect(mutant.mutatedSource).not.toBe(code);
    }
  });

  test("generates comparison, logical, arithmetic, and return flip edge cases", () => {
    const code = `
      "use strict";
      export function evaluateLogic(a: number, b: number, flag: boolean): boolean {
        if (a !== b || a <= b || a >= b || a == b || a != b || a > b) {
          return false;
        }
        const x = (a / b) % 2;
        if (flag) {
          return true;
        }
        return false;
      }
      export function getNumber(): number {
        return 0;
      }
      export function getOtherNumber(): number {
        return 42;
      }
      export function emptyStr(): string {
        return "";
      }
      export function bareReturn(): void {
        return;
      }
    `;
    const mutants = generateMutants(code);
    expect(mutants.length).toBeGreaterThan(10);
    const descriptions = mutants.map((m) => m.description);
    expect(descriptions.some((d) => d.includes("!=="))).toBe(true);
    expect(descriptions.some((d) => d.includes("|| to &&"))).toBe(true);
    expect(descriptions.some((d) => d.includes("/ to *"))).toBe(true);
    expect(descriptions.some((d) => d.includes("% to *"))).toBe(true);
    expect(descriptions.some((d) => d.includes("Flip return false to return true"))).toBe(true);
    expect(descriptions.some((d) => d.includes("Flip bare return to return true"))).toBe(true);
    expect(descriptions.some((d) => d.includes("Flip return 0 to return 1"))).toBe(true);
    expect(descriptions.some((d) => d.includes("Flip return 42 to return 0"))).toBe(true);
  });

  test("skips import/export declarations, require calls, and object keys during string mutation", () => {
    const code = `
      import { helper } from "./helper.ts";
      const config = { "api-key": "secret123" };
      const mod = require("module");
      export const title = "App";
    `;
    const mutants = generateMutants(code, { mutationTypes: ["string_literal_mutation"] });
    const originalTexts = mutants.map((m) => m.originalText);
    expect(originalTexts).toContain('"secret123"');
    expect(originalTexts).toContain('"App"');
    expect(originalTexts).not.toContain('"./helper.ts"');
    expect(originalTexts).not.toContain('"module"');
    expect(originalTexts).not.toContain('"api-key"');
  });

  test("passes mutation gate when all mutants are killed by the test runner", async () => {
    const implementationCode = `
      export function add(a: number, b: number): number {
        return a + b;
      }
    `;

    const runner = (mutatedSource: string, mutant: MutantRecord): MutationTestRunOutcome => {
      if (mutatedSource.includes("return a - b;") || mutant.mutationType === "flip_return_value") {
        return { passed: false, error: "Assertion error: expected 5 got -1" };
      }
      return { passed: false, exitCode: 1 };
    };

    const result = await runMutationGate(implementationCode, runner);
    expect(result.passed).toBe(true);
    expect(result.killedMutants).toBe(result.totalMutants);
    expect(result.survivedMutants).toBe(0);
    expect(result.mutationScore).toBe(100);
    expect(result.violations).toHaveLength(0);
  });

  test("fails mutation gate when mutants survive due to blind spots in tests", async () => {
    const implementationCode = `
      export function compute(val: number): boolean {
        if (val > 0) {
          return true;
        }
        return false;
      }
    `;

    const runner = (mutatedSource: string, mutant: MutantRecord): MutationTestRunOutcome => {
      if (mutant.description.includes("return true to return false")) {
        return { passed: false, exitCode: 1 };
      }
      return { passed: true, exitCode: 0 };
    };

    const result = await runMutationGate(implementationCode, runner, { minMutationScore: 100 });
    expect(result.passed).toBe(false);
    expect(result.survivedMutants).toBeGreaterThan(0);
    expect(result.mutationScore).toBeLessThan(100);
    expect(result.violations.length).toBe(result.survivedMutants);
    expect(result.violations[0]?.message).toContain(
      "survived: test suite passed without detecting intentional defect",
    );
  });

  test("supports maxMutants limit and non-strict survival mode", async () => {
    const code = `
      export function isPositive(x: number): boolean {
        if (x > 0) return true;
        return false;
      }
    `;
    const limitedMutants = generateMutants(code, { maxMutants: 2 });
    expect(limitedMutants.length).toBe(2);

    const runner = (src: string, m: MutantRecord): MutationTestRunOutcome => {
      if (m.id === "mutant-1") return { passed: false, exitCode: 1 };
      return { passed: true, exitCode: 0 };
    };

    const relaxedResult = await runMutationGate(code, runner, {
      minMutationScore: 50,
      strictZeroSurvival: false,
      maxMutants: 2,
    });
    expect(relaxedResult.passed).toBe(true);
    expect(relaxedResult.mutationScore).toBe(50);
  });

  test("handles runner errors gracefully", async () => {
    const code = `export function foo(): boolean { return true; }`;
    const throwingRunner = (): MutationTestRunOutcome => {
      throw new Error("Runner exploded");
    };
    const result = await runMutationGate(code, throwingRunner);
    expect(result.passed).toBe(false);
    expect(result.erroredMutants).toBe(result.totalMutants);
    expect(result.mutantResults[0]?.status).toBe("error");
    expect(result.mutantResults[0]?.details).toContain("Runner exploded");
  });

  test("handles code with 0 candidates gracefully", async () => {
    const code = `// Empty code with no mutations`;
    const runner = (): MutationTestRunOutcome => ({ passed: true });
    const result = await runMutationGate(code, runner);
    expect(result.passed).toBe(true);
    expect(result.totalMutants).toBe(0);
    expect(result.mutationScore).toBe(100);
  });
});



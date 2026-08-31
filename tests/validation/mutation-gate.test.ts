import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  generateMutants,
  runMutationGate,
  type MutantRecord,
  type MutationGateResult,
  type MutationTestRunner,
} from "../../../olt/scripts/src/validation/mutation-gate/index.ts";

describe("Mutation Gate & AST Mutators", () => {
  describe("1. Boolean and Unary Mutations", () => {
    it("generates inverted boolean keywords", () => {
      const code = `const isReady = true; const isDone = false;`;
      const mutants = generateMutants(code, { mutationTypes: ["invert_boolean"] });
      expect(mutants.length).toBe(2);

      const trueMutant = mutants.find((m) => m.originalText === "true");
      expect(trueMutant).toBeDefined();
      expect(trueMutant?.mutatedText).toBe("false");

      const falseMutant = mutants.find((m) => m.originalText === "false");
      expect(falseMutant).toBeDefined();
      expect(falseMutant?.mutatedText).toBe("true");
    });

    it("generates inverted unary NOT mutations", () => {
      const code = `const isInvalid = !isValid;`;
      const mutants = generateMutants(code, { mutationTypes: ["invert_boolean"] });
      expect(mutants.length).toBe(1);
      expect(mutants[0]?.originalText).toBe("!isValid");
      expect(mutants[0]?.mutatedText).toBe("isValid");
    });
  });

  describe("2. Binary Operator Mutations (Comparison, Logical, Arithmetic)", () => {
    it("mutates comparison and equality operators", () => {
      const code = `
        const a = (x === 1);
        const b = (y !== 2);
        const c = (z < 3);
        const d = (w >= 4);
      `;
      const mutants = generateMutants(code, { mutationTypes: ["comparison_mutation"] });
      expect(mutants.length).toBe(4);

      expect(mutants.some((m) => m.originalText === "===" && m.mutatedText === "!==")).toBe(true);
      expect(mutants.some((m) => m.originalText === "!==" && m.mutatedText === "===")).toBe(true);
      expect(mutants.some((m) => m.originalText === "<" && m.mutatedText === ">=")).toBe(true);
      expect(mutants.some((m) => m.originalText === ">=" && m.mutatedText === "<")).toBe(true);
    });

    it("mutates logical operators", () => {
      const code = `const valid = isA && isB || isC;`;
      const mutants = generateMutants(code, { mutationTypes: ["logical_operator_mutation"] });
      expect(mutants.length).toBe(2);
      expect(mutants.some((m) => m.originalText === "&&" && m.mutatedText === "||")).toBe(true);
      expect(mutants.some((m) => m.originalText === "||" && m.mutatedText === "&&")).toBe(true);
    });

    it("mutates arithmetic operators", () => {
      const code = `const val = a + b - c * d / e % f;`;
      const mutants = generateMutants(code, { mutationTypes: ["arithmetic_mutation"] });
      expect(mutants.length).toBe(5);
      expect(mutants.some((m) => m.originalText === "+" && m.mutatedText === "-")).toBe(true);
      expect(mutants.some((m) => m.originalText === "-" && m.mutatedText === "+")).toBe(true);
      expect(mutants.some((m) => m.originalText === "*" && m.mutatedText === "/")).toBe(true);
      expect(mutants.some((m) => m.originalText === "/" && m.mutatedText === "*")).toBe(true);
      expect(mutants.some((m) => m.originalText === "%" && m.mutatedText === "*")).toBe(true);
    });
  });

  describe("3. Return Value and Function Body Mutations", () => {
    it("flips return values", () => {
      const code = `
        function getNumber() { return 42; }
        function getString() { return "hello"; }
        function getVoid() { return; }
      `;
      const mutants = generateMutants(code, { mutationTypes: ["flip_return_value"] });
      expect(mutants.length).toBe(3);
      expect(mutants.some((m) => m.mutatedText === "return 0;")).toBe(true);
      expect(mutants.some((m) => m.mutatedText === 'return "";')).toBe(true);
      expect(mutants.some((m) => m.mutatedText === "return true;")).toBe(true);
    });

    it("strips function bodies", () => {
      const code = `function calculateTotal(items: number[]) { const sum = items.reduce((a, b) => a + b, 0); return sum; }`;
      const mutants = generateMutants(code, { mutationTypes: ["strip_function_body"] });
      expect(mutants.length).toBeGreaterThanOrEqual(1);
      expect(mutants.some((m) => m.mutatedText === "{ return undefined; }")).toBe(true);
    });
  });

  describe("4. String Literal and Filtering Controls", () => {
    it("mutates string literals while skipping imports and non-computed object keys", () => {
      const code = `
        import { foo } from "./module";
        const message = "hello world";
        const obj = { key: "value" };
      `;
      const mutants = generateMutants(code, { mutationTypes: ["string_literal_mutation"] });
      expect(mutants.length).toBe(2); // "hello world" and "value" (not "./module" or "key")
      expect(mutants.every((m) => m.originalText !== "./module")).toBe(true);
    });

    it("respects maxMutants option limit", () => {
      const code = `
        const a = 1 + 2 + 3 + 4 + 5 + 6;
      `;
      const mutants = generateMutants(code, { maxMutants: 2 });
      expect(mutants.length).toBe(2);
    });
  });

  describe("5. Mutation Gate Runner Execution", () => {
    it("passes when all mutants are killed by test runner", async () => {
      const source = `export function add(a: number, b: number): number { return a + b; }`;
      const testRunner: MutationTestRunner = async (
        mutatedSource: string,
        mutant: MutantRecord,
      ) => {
        // Test suite kills the mutant if arithmetic operator was mutated from + to -
        if (
          mutant.mutationType === "arithmetic_mutation" ||
          mutant.mutationType === "flip_return_value"
        ) {
          return { passed: false, exitCode: 1, error: "Assertion failed" };
        }
        return { passed: false, exitCode: 1 };
      };

      const result: MutationGateResult = await runMutationGate(source, testRunner);
      expect(result.passed).toBe(true);
      expect(result.killedMutants).toBe(result.totalMutants);
      expect(result.survivedMutants).toBe(0);
      expect(result.mutationScore).toBe(100);
      expect(result.violations.length).toBe(0);
    });

    it("fails when any mutant survives", async () => {
      const source = `export function isPositive(n: number): boolean { return n > 0; }`;
      const testRunner: MutationTestRunner = async (
        _mutatedSource: string,
        mutant: MutantRecord,
      ) => {
        // Test runner fails to detect return value flip (mutant survives)
        if (mutant.mutationType === "flip_return_value") {
          return { passed: true, exitCode: 0 };
        }
        return { passed: false, exitCode: 1 };
      };

      const result: MutationGateResult = await runMutationGate(source, testRunner);
      expect(result.passed).toBe(false);
      expect(result.survivedMutants).toBeGreaterThan(0);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it("segregates compilation and syntax errors from test assertion kills", async () => {
      const source = `export function compute(x: number): number { return x * 2; }`;
      const testRunner: MutationTestRunner = async (
        _mutatedSource: string,
        mutant: MutantRecord,
      ) => {
        // Returns syntax/compilation error for arithmetic mutant
        if (mutant.mutationType === "arithmetic_mutation") {
          return {
            passed: false,
            exitCode: 1,
            error: "SyntaxError: Unexpected token",
            isCompilationError: true,
          };
        }
        return { passed: false, exitCode: 1, error: "Assertion failed: expected 4 got 0" };
      };

      const result = await runMutationGate(source, testRunner);
      expect(result.passed).toBe(false);
      expect(result.erroredMutants).toBeGreaterThan(0);
      const errResult = result.mutantResults.find((r) => r.status === "error");
      expect(errResult).toBeDefined();
      expect(errResult?.details).toContain("SyntaxError");
    });

    it("handles source code with 0 mutants", async () => {
      const source = `// Just comments`;
      const testRunner: MutationTestRunner = async () => ({ passed: true });
      const result = await runMutationGate(source, testRunner);
      expect(result.passed).toBe(true);
      expect(result.totalMutants).toBe(0);
      expect(result.mutationScore).toBe(100);
    });
  });

  describe("6. Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
    it("verifies zero TypeScript any and zero suppressions across mutation-gate source and test files", () => {
      const filesToAudit = [
        resolve(import.meta.dir, "../../../olt/scripts/src/validation/mutation-gate/types.ts"),
        resolve(
          import.meta.dir,
          "../../../olt/scripts/src/validation/mutation-gate/candidate-visitors.ts",
        ),
        resolve(
          import.meta.dir,
          "../../../olt/scripts/src/validation/mutation-gate/expression-mutators.ts",
        ),
        resolve(
          import.meta.dir,
          "../../../olt/scripts/src/validation/mutation-gate/statement-mutators.ts",
        ),
        resolve(
          import.meta.dir,
          "../../../olt/scripts/src/validation/mutation-gate/ast-mutators.ts",
        ),
        resolve(import.meta.dir, "../../../olt/scripts/src/validation/mutation-gate/runner.ts"),
        resolve(import.meta.dir, "../../../olt/scripts/src/validation/mutation-gate/index.ts"),
        resolve(import.meta.dir, "mutation-gate.test.ts"),
      ];

      const anyPattern = /:\s*any\b|as\s+any\b|<any>/;
      const suppressionPattern = new RegExp(
        [
          "@ts" + "-ignore",
          "@ts" + "-expect-error",
          "@ts" + "-nocheck",
          "eslint" + "-disable",
          "oxlint" + "-disable",
        ].join("|"),
      );

      for (const filePath of filesToAudit) {
        expect(existsSync(filePath)).toBe(true);
        const content = readFileSync(filePath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;

          expect(anyPattern.test(line)).toBe(false);
          expect(suppressionPattern.test(line)).toBe(false);
        }
      }
    });
  });
});

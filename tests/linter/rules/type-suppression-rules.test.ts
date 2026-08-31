import { describe, expect, it } from "bun:test";
import { lintSourceCode } from "../../../olt/scripts/src/linter/ast/index.ts";

export const typeSuppressionRulesSuiteName = "AST Type Safety & Compiler Suppression Rules (any, @ts-ignore)";

describe(typeSuppressionRulesSuiteName, () => {
  describe("Any Type Annotation Rule", () => {
    it("detects 'any' type in variable declarations", () => {
      const code = "const payload: any = JSON.parse(raw);";
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.any_type).toBe(1);

      const violation = result.violations[0];
      expect(violation !== undefined).toBe(true);
      if (violation !== undefined) {
        expect(violation.rule).toBe("any_type");
        expect(violation.message).toContain("Prohibited 'any' type annotation");
      }
    });

    it("detects 'any' type in function parameter and return type", () => {
      const code = "function process(item: any): any { return item; }";
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.any_type).toBe(2);
    });

    it("detects 'any' in type arguments and type casts", () => {
      const code = `
        const map = new Map<string, any>();
        const obj = (data as any).property;
        const cast = <any>value;
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.any_type).toBe(3);
    });

    it("passes clean strictly-typed code with unknown and type guards", () => {
      const code = `
        function handle(data: unknown): string {
          if (typeof data === "string") {
            return data;
          }
          return "";
        }
      `;
      const result = lintSourceCode(code, "clean.ts");

      expect(result.valid).toBe(true);
      expect(result.summaryByRule.any_type).toBe(0);
    });
  });

  describe("Compiler Suppression Directive Rule", () => {
    it("detects @ts-ignore in single-line comments", () => {
      const code = `
        // @ts-ignore
        const value = badCall();
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.compiler_suppression).toBe(1);

      const violation = result.violations[0];
      expect(violation !== undefined).toBe(true);
      if (violation !== undefined) {
        expect(violation.rule).toBe("compiler_suppression");
        expect(violation.message).toContain("@ts-ignore");
      }
    });

    it("detects @ts-nocheck, @ts-expect-error, and eslint-disable in comments", () => {
      const code = `
        /* @ts-nocheck */
        // @ts-expect-error: expected type mismatch
        // eslint-disable-next-line
        const x = 1;
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.compiler_suppression).toBe(3);
    });

    it("does not flag ordinary documentation comments", () => {
      const code = `
        /**
         * Normal method documentation.
         * Explains function behavior clearly.
         */
        export function computeScore(input: number): number {
          return input * 2;
        }
      `;
      const result = lintSourceCode(code, "clean.ts");

      expect(result.valid).toBe(true);
      expect(result.summaryByRule.compiler_suppression).toBe(0);
    });
  });
});

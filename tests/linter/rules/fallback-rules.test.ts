import { describe, expect, it } from "bun:test";
import { lintSourceCode } from "../../../olt/scripts/src/linter/ast/index.ts";

export const fallbackRulesSuiteName = "AST Fallback & Coalescing Rules (??, ||, !)";

describe(fallbackRulesSuiteName, () => {
  describe("Nullish Coalescing (??) Rule", () => {
    it("detects nullish coalescing operator in variable assignments", () => {
      const code = "const value = input ?? 'default_val';";
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.totalViolations).toBe(1);
      expect(result.summaryByRule.nullish_coalescing).toBe(1);

      const violation = result.violations[0];
      expect(violation !== undefined).toBe(true);
      if (violation !== undefined) {
        expect(violation.rule).toBe("nullish_coalescing");
        expect(violation.line).toBe(1);
        expect(violation.message).toContain("Prohibited nullish coalescing operator (??)");
        expect(violation.snippet).toContain("input ?? 'default_val'");
      }
    });

    it("detects chained nullish coalescing expressions", () => {
      const code = "const res = a ?? b ?? c;";
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.nullish_coalescing).toBe(2);
    });

    it("passes clean explicit branching code without nullish coalescing", () => {
      const code = `
        let value = 'default_val';
        if (input !== undefined && input !== null) {
          value = input;
        }
      `;
      const result = lintSourceCode(code, "clean.ts");

      expect(result.valid).toBe(true);
      expect(result.totalViolations).toBe(0);
      expect(result.summaryByRule.nullish_coalescing).toBe(0);
    });
  });

  describe("Logical OR (||) Rule", () => {
    it("detects logical OR fallback assignments", () => {
      const code = "const name = userName || 'guest';";
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.totalViolations).toBe(1);
      expect(result.summaryByRule.logical_or_fallback).toBe(1);

      const violation = result.violations[0];
      expect(violation !== undefined).toBe(true);
      if (violation !== undefined) {
        expect(violation.rule).toBe("logical_or_fallback");
        expect(violation.message).toContain("Prohibited logical OR operator (||)");
      }
    });

    it("detects logical OR in conditionals", () => {
      const code = `
        if (isA || isB) {
          doWork();
        }
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.logical_or_fallback).toBe(1);
    });

    it("passes clean explicit if-else without logical OR", () => {
      const code = `
        let active = false;
        if (isA) {
          active = true;
        } else if (isB) {
          active = true;
        }
      `;
      const result = lintSourceCode(code, "clean.ts");

      expect(result.valid).toBe(true);
      expect(result.totalViolations).toBe(0);
      expect(result.summaryByRule.logical_or_fallback).toBe(0);
    });
  });

  describe("Non-Null Assertion (!) Rule", () => {
    it("detects non-null assertion on property access", () => {
      const code = "const name = user!.profile.name;";
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.non_null_assertion).toBe(1);

      const violation = result.violations[0];
      expect(violation !== undefined).toBe(true);
      if (violation !== undefined) {
        expect(violation.rule).toBe("non_null_assertion");
        expect(violation.message).toContain("Prohibited non-null assertion operator (!)");
      }
    });

    it("detects non-null assertion on map.get calls and array lookups", () => {
      const code = `
        const item = map.get("key")!;
        const first = list![0];
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.non_null_assertion).toBe(2);
    });

    it("passes clean explicit undefined check instead of non-null assertion", () => {
      const code = `
        const item = map.get("key");
        if (item !== undefined && item !== null) {
          useItem(item);
        }
      `;
      const result = lintSourceCode(code, "clean.ts");

      expect(result.valid).toBe(true);
      expect(result.totalViolations).toBe(0);
      expect(result.summaryByRule.non_null_assertion).toBe(0);
    });
  });
});

import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertZeroFallbackCompliance,
  lintFile,
} from "../../../olt/scripts/src/linter/ast/index.ts";

export const complianceGuardSuiteName =
  "AST Zero-Fallback Assertion Guards & Self Compliance Invariants";

describe(complianceGuardSuiteName, () => {
  describe("assertZeroFallbackCompliance Assertion Guard", () => {
    it("does not throw on fully compliant source code", () => {
      const cleanCode = `
        export function safeGet(map: Map<string, number>, key: string): number {
          const val = map.get(key);
          if (val !== undefined && val !== null) {
            return val;
          }
          return 0;
        }
      `;
      expect(() => assertZeroFallbackCompliance(cleanCode)).not.toThrow();
    });

    it("throws HarnessError INTEGRITY on non-compliant code", () => {
      const badCode = "export const x = a || 10;";
      expect(() => assertZeroFallbackCompliance(badCode)).toThrow();

      try {
        assertZeroFallbackCompliance(badCode);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        if (err instanceof HarnessError) {
          expect(err.code).toBe("INTEGRITY");
          expect(err.message).toContain("Zero-fallback compliance check failed");
        }
      }
    });
  });

  describe("Self-Compliance Invariant Verification", () => {
    it("ast/index.ts itself is 100% compliant with zero fallback and no violations", () => {
      const linterPath = join(process.cwd(), "olt/scripts/src/linter/ast/index.ts");
      const result = lintFile(linterPath);

      expect(result.valid).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.totalViolations).toBe(0);
      expect(result.violations).toEqual([]);
    });
  });
});

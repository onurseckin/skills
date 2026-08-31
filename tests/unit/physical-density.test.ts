import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  validateDensityBudgets,
  validateZeroCommentsInCode,
} from "../../olt/scripts/src/validation/coding-conventions.ts";

describe("Physical Density and Zero-Comment Invariant Tests", () => {
  describe("validateZeroCommentsInCode", () => {
    it("detects single-line, multi-line, and docblock comments", () => {
      const singleLine = "const a = 1;\n// single line comment\nconst b = 2;";
      const res1 = validateZeroCommentsInCode(singleLine, "src/a.ts");
      expect(res1.valid).toBe(false);
      expect(res1.violations.length).toBe(1);
      expect(res1.violations[0]?.type).toBe("single-line");
      expect(res1.violations[0]?.line).toBe(2);

      const multiLine = "const a = 1;\n/* block comment */\nconst b = 2;";
      const res2 = validateZeroCommentsInCode(multiLine, "src/b.ts");
      expect(res2.valid).toBe(false);
      expect(res2.violations.length).toBe(1);
      expect(res2.violations[0]?.type).toBe("multi-line");

      const docBlock = "/**\n * Doc comment\n */\nfunction foo(): void {}";
      const res3 = validateZeroCommentsInCode(docBlock, "src/c.ts");
      expect(res3.valid).toBe(false);
      expect(res3.violations.length).toBe(1);
    });
  });

  describe("validateDensityBudgets", () => {
    it("validates line count budgets per file", () => {
      const overBudget = Array.from({ length: 500 }, (_, i) => `const x${i} = ${i};`).join("\n");
      const res1 = validateDensityBudgets({
        files: [{ path: "src/heavy.ts", content: overBudget }],
        directories: [],
      });
      expect(res1.valid).toBe(false);
      expect(res1.fileViolations.length).toBe(1);
      expect(res1.fileViolations[0]?.lineCount).toBe(500);
      expect(res1.fileViolations[0]?.limit).toBe(300);

      const underBudget = Array.from({ length: 150 }, (_, i) => `const y${i} = ${i};`).join("\n");
      const res2 = validateDensityBudgets({
        files: [{ path: "src/light.ts", content: underBudget }],
        directories: [],
      });
      expect(res2.valid).toBe(true);
      expect(res2.fileViolations.length).toBe(0);
    });
  });
});

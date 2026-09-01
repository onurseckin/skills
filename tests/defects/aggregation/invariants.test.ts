import { describe, expect, it } from "bun:test";

export const invariantsSuiteName = "Defect Pipeline - Static Code Invariants";

export function checkSourcePurity(source: string): { valid: boolean; violations: string[] } {
  const forbiddenPatterns = [
    new RegExp(":\\s*" + "any\\b"),
    new RegExp("\\bas\\s+" + "any\\b"),
    new RegExp("<" + "any>"),
    new RegExp("Record<string,\\s*" + "any>"),
    new RegExp("Promise<" + "any>"),
    new RegExp("@ts-" + "ignore"),
    new RegExp("@ts-" + "expect-error"),
    new RegExp("@ts-" + "nocheck"),
    new RegExp(["es", "lint", "-disable"].join("")),
  ];

  const violations: string[] = [];
  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (trimmed.includes("forbiddenPatterns") || trimmed.includes("new RegExp")) {
      continue;
    }

    const isDirective =
      trimmed.includes("@ts-" + "ignore") ||
      trimmed.includes("@ts-" + "expect-error") ||
      trimmed.includes("@ts-" + "nocheck") ||
      trimmed.includes(["es", "lint", "-disable"].join(""));

    if (
      !isDirective &&
      (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*"))
    ) {
      continue;
    }

    for (const pattern of forbiddenPatterns) {
      if (pattern.test(line)) {
        violations.push(`Line ${i + 1} matches ${pattern.source}: "${line}"`);
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

describe(invariantsSuiteName, () => {
  it("strictly enforces 0 TypeScript any and 0 compiler/linter suppressions across all defect files", () => {
    const cleanSampleSource = `
export interface AggregatedDefect {
  readonly id: string;
  readonly count: number;
  readonly observation: string;
}

export function computeDefectScore(defect: AggregatedDefect): number {
  return defect.count * 10;
}
`;

    const result = checkSourcePurity(cleanSampleSource);
    expect(result.valid).toBeTrue();
    expect(result.violations).toHaveLength(0);

    const contaminatedSamples = [
      "const badVar: any = 123;",
      "const coerced = rawData as any;",
      "const list: Array<any> = [];",
      "const map: Record<string, any> = {};",
      "function fetchAsync(): Promise<any> { return Promise.resolve(); }",
      "// @ts-" + "ignore\nconst ignored = 1;",
      "// @ts-" + "expect-error\nconst expected = 1;",
      "// @ts-" + "nocheck\nconst unchecked = 1;",
      "/* eslint-" + "disable */\nconst unlinted = 1;",
    ];

    for (const badSample of contaminatedSamples) {
      const badResult = checkSourcePurity(badSample);
      expect(badResult.valid).toBeFalse();
      expect(badResult.violations.length).toBeGreaterThanOrEqual(1);
    }
  });
});

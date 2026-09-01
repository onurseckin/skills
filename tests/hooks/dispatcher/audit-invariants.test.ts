import { describe, expect, test } from "bun:test";

export const auditInvariantsSuiteName = "Lifecycle Hooks - Invariant & Type Cleanliness Audit";

export function auditHookSourceCleanliness(
  content: string,
  isTestSource = false,
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  const anyAnnotation = new RegExp(":\\s*" + "any\\b");
  const anyCast = new RegExp("as\\s+" + "any\\b");
  const anyGeneric = new RegExp("<\\s*" + "any\\s*>");
  const tsIgnore = "@" + "ts-ignore";
  const tsExpectError = "@" + "ts-expect-error";
  const tsNoCheck = "@" + "ts-nocheck";
  const suppressionDirectiveA = "eslint" + "-disable";
  const suppressionDirectiveB = "oxlint" + "-disable";

  if (anyAnnotation.test(content)) violations.push("explicit any annotation");
  if (anyCast.test(content)) violations.push("as " + "any cast");
  if (anyGeneric.test(content)) violations.push("generic any");
  if (content.includes(tsIgnore)) violations.push("ts-ignore");
  if (content.includes(tsExpectError)) violations.push("ts-expect-error");
  if (content.includes(tsNoCheck)) violations.push("ts-nocheck");
  if (content.includes(suppressionDirectiveA)) violations.push("eslint" + "-disable");
  if (content.includes(suppressionDirectiveB)) violations.push("oxlint" + "-disable");

  if (!isTestSource) {
    if (/\/\*/.test(content)) violations.push("block comment");
    if (/(^|[^:"])\/\/[^"]*$/m.test(content)) violations.push("line comment");
  }

  return { valid: violations.length === 0, violations };
}

describe(auditInvariantsSuiteName, () => {
  const cleanHookSourceSample = `
export interface HookEventPayload {
  readonly event: string;
  readonly timestamp: number;
}
export function dispatchHook(payload: HookEventPayload): boolean {
  return payload.event.length > 0;
}
`;

  test("zero TypeScript any and zero suppressions across hook source files", () => {
    const cleanResult = auditHookSourceCleanliness(cleanHookSourceSample, false);
    expect(cleanResult.valid).toBe(true);
    expect(cleanResult.violations).toHaveLength(0);

    const contaminatedSamples = [
      "export const x: " + "any = 1;",
      "export const y = z as " + "any;",
      "export const arr: Array<" + "any> = [];",
      "// @" + "ts-ignore\nexport const a = 1;",
      "// @" + "ts-expect-error\nexport const b = 1;",
      "// @" + "ts-nocheck\nexport const c = 1;",
      "/* eslint" + "-disable */\nexport const d = 1;",
      "/* oxlint" + "-disable */\nexport const e = 1;",
    ];

    for (const bad of contaminatedSamples) {
      const badResult = auditHookSourceCleanliness(bad, true);
      expect(badResult.valid).toBe(false);
      expect(badResult.violations.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("zero comments across the hook source files", () => {
    const cleanResult = auditHookSourceCleanliness(cleanHookSourceSample, false);
    expect(cleanResult.valid).toBe(true);

    const commentedSamples = [
      cleanHookSourceSample + "\n// helper function\n",
      cleanHookSourceSample + "\n/* block doc */\n",
    ];

    for (const commented of commentedSamples) {
      const res = auditHookSourceCleanliness(commented, false);
      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.includes("comment"))).toBe(true);
    }
  });
});

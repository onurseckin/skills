import { describe, test, expect } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  FORBIDDEN_SYNTAX_RULES,
  verifyAstBoundaries,
} from "../../../olt/scripts/src/plan/pre-enhancer.ts";
import { createCleanTypeScriptCode } from "./index.ts";

describe("pre-enhancer-ast (AST boundary analysis, zero-fallback & zero-any)", () => {
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

    const fixtureResult = verifyAstBoundaries("src/profile.ts", createCleanTypeScriptCode());
    expect(fixtureResult.compliant).toBe(true);
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

  test("detects prohibited untyped any annotation", () => {
    const anyToken = "a" + "n" + "y";
    const badCode = `export function unsafeFunction(data: ${anyToken}): number { return 42; }`;
    const result = verifyAstBoundaries("src/unsafe.ts", badCode);
    expect(result.compliant).toBe(false);
    expect(result.findings.some((f) => f.ruleId === "NO_ANY_TYPE_ANNOTATION")).toBe(true);
  });

  test("detects prohibited untyped any cast", () => {
    const anyCast = "as" + " any";
    const badCode = `export function castUnsafe(input: unknown): string { return (input ${anyCast}).name; }`;
    const result = verifyAstBoundaries("src/cast.ts", badCode);
    expect(result.compliant).toBe(false);
    expect(result.findings.some((f) => f.ruleId === "NO_ANY_TYPE_CAST")).toBe(true);
  });

  test("detects prohibited compiler suppression directives", () => {
    const tsNocheck = "// @ts-" + "nocheck";
    const tsIgnore = "// @ts-" + "ignore";
    const badCode = `${tsNocheck}\nexport function ignoreErrors(): void {\n  ${tsIgnore}\n  const x = 1 + "test";\n}`;
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

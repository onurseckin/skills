import { describe, expect, test } from "bun:test";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  executePostActionHook,
  inspectAstPurity,
  inspectPhysicalLines,
} from "../../../olt/scripts/src/sentinel/index.ts";

describe("sentinel:post-action hook & AST inspection", () => {
  test("flags physical line budget exceeded when lines > 300", () => {
    const lines = Array.from({ length: 305 }, (_, i) => `// line ${i}`).join("\n");
    const violations = inspectPhysicalLines(lines, "src/bloated.ts");

    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe("LINE_BUDGET_EXCEEDED");
    expect(violations[0]?.severity).toBe("CRITICAL");
  });

  test("passes physical line budget when lines <= 400", () => {
    const lines = Array.from({ length: 250 }, (_, i) => `// line ${i}`).join("\n");
    const violations = inspectPhysicalLines(lines, "src/concise.ts");

    expect(violations).toHaveLength(0);
  });

  test("flags compiler suppressions: @ts-ignore and @ts-expect-error", () => {
    const code = `
      // @ts-ignore
      const x = 1;
      /* @ts-expect-error */
      const y = 2;
    `;
    const violations = inspectAstPurity(code, "src/types.ts");

    expect(violations.some((v) => v.code === "AST_SUPPRESSION_DETECTED")).toBe(true);
  });

  test("flags untyped escape hatches: : any, as any, <any>", () => {
    const code1 = "function doSomething(data: any) {}";
    const violations1 = inspectAstPurity(code1, "src/any1.ts");
    expect(violations1.some((v) => v.code === "ZERO_ANY_VIOLATION")).toBe(true);

    const code2 = "const val = input as any;";
    const violations2 = inspectAstPurity(code2, "src/any2.ts");
    expect(violations2.some((v) => v.code === "ZERO_ANY_VIOLATION")).toBe(true);
  });

  test("flags wildcard exports and default exports", () => {
    const code = `
      export * from "./types.ts";
      export default class Foo {}
    `;
    const violations = inspectAstPurity(code, "src/index.ts");

    expect(violations.some((v) => v.code === "WILDCARD_EXPORT_PROHIBITED")).toBe(true);
    expect(violations.some((v) => v.code === "DEFAULT_EXPORT_PROHIBITED")).toBe(true);
  });

  test("passes clean TypeScript code with zero violations", () => {
    const cleanCode = `
      export interface User {
        readonly id: string;
        readonly name: string;
      }

      export function formatUser(user: User): string {
        return \`\${user.name} (\${user.id})\`;
      }
    `;
    const violations = inspectAstPurity(cleanCode, "src/user.ts");
    expect(violations).toHaveLength(0);
  });

  test("flags nested generic any and multiline compiler suppressions", () => {
    const codeGeneric = "const task: Promise<any> = Promise.resolve();";
    const violationsGeneric = inspectAstPurity(codeGeneric, "src/generic.ts");
    expect(violationsGeneric.some((v) => v.code === "ZERO_ANY_VIOLATION")).toBe(true);

    const multilineSuppression = `
      /**
       * @ts-nocheck
       */
      const bypass = true;
    `;
    const violationsSuppression = inspectAstPurity(multilineSuppression, "src/suppress.ts");
    expect(violationsSuppression.some((v) => v.code === "AST_SUPPRESSION_DETECTED")).toBe(true);
  });

  test("flags combined multi-violation AST patterns within a single file", () => {
    const combinedCode = `
      // @ts-ignore
      const raw = value as any;
      export * from "./internals.ts";
      export default function fallback() {}
    `;
    const violations = inspectAstPurity(combinedCode, "src/kitchen-sink.ts");

    expect(violations.some((v) => v.code === "AST_SUPPRESSION_DETECTED")).toBe(true);
    expect(violations.some((v) => v.code === "ZERO_ANY_VIOLATION")).toBe(true);
    expect(violations.some((v) => v.code === "WILDCARD_EXPORT_PROHIBITED")).toBe(true);
    expect(violations.some((v) => v.code === "DEFAULT_EXPORT_PROHIBITED")).toBe(true);
  });

  test("executePostActionHook allows clean empty modified_files set", () => {
    const result = executePostActionHook({
      agent_id: "impl_01",
      role: "implementer",
      action_type: "file_write",
      target: "src/types.ts",
      modified_files: [],
    });

    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("inspects exact 300 vs 301 physical line boundaries", () => {
    const exactly300 = Array.from({ length: 300 }, (_, i) => `// line ${i}`).join("\n");
    expect(inspectPhysicalLines(exactly300, "src/exact300.ts")).toHaveLength(0);

    const exactly301 = Array.from({ length: 301 }, (_, i) => `// line ${i}`).join("\n");
    const v301 = inspectPhysicalLines(exactly301, "src/exact301.ts");
    expect(v301).toHaveLength(1);
    const first = v301[0];
    if (!first) throw new Error("Expected violation");
    expect(first.code).toBe("LINE_BUDGET_EXCEEDED");
  });

  test("normalizes CRLF line endings correctly", () => {
    const crlf250 = Array.from({ length: 250 }, (_, i) => `// line ${i}`).join("\r\n");
    expect(inspectPhysicalLines(crlf250, "src/crlf250.ts")).toHaveLength(0);

    const crlf305 = Array.from({ length: 305 }, (_, i) => `// line ${i}`).join("\r\n");
    const v305 = inspectPhysicalLines(crlf305, "src/crlf305.ts");
    expect(v305).toHaveLength(1);
  });

  test("passes clean template literals and interpolation", () => {
    const code = "const message = `hello world ${1 + 2}`;";
    const violations = inspectAstPurity(code, "src/template.ts");
    expect(violations).toHaveLength(0);
  });

  test("CLI execute sentinel:post-action inspects files cleanly", async () => {
    const res = await execute([
      "sentinel:post-action",
      "--role",
      "implementer",
      "--agent",
      "impl_01",
      "--files",
      "olt/scripts/src/sentinel/types.ts",
    ]);

    expect(res.allowed).toBe(true);
    expect(res.files_inspected).toBe(1);
  });
});

import { describe, expect, test } from "bun:test";
import { execute } from "../../olt/scripts/src/cli/execute.ts";
import {
  executePostActionHook,
  inspectAstPurity,
  inspectPhysicalLines,
} from "../../olt/scripts/src/sentinel/index.ts";

describe("sentinel:post-action hook & AST inspection", () => {
  test("flags physical line budget exceeded when lines > 300", () => {
    const lines = Array.from({ length: 305 }, (_, i) => `// line ${i}`).join("\n");
    const violations = inspectPhysicalLines(lines, "src/bloated.ts");

    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe("LINE_BUDGET_EXCEEDED");
    expect(violations[0]?.severity).toBe("CRITICAL");
  });

  test("passes physical line budget when lines <= 300", () => {
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

import { describe, expect, test } from "bun:test";
import {
  checkAstPurity,
  scanFileForAstPurity,
} from "../../../olt/scripts/src/reporting/doctor/ast-purity-engine.ts";

describe("Wave 2 - Task 2.1: Native AST Static Purity Tokenizer", () => {
  test("passes cleanly when code is pure without any suppressions or any types", () => {
    const code = `
      export function sum(a: number, b: number): number {
        return a + b;
      }
    `;
    const findings = scanFileForAstPurity("src/math.ts", code);
    expect(findings).toHaveLength(0);

    const result = checkAstPurity({
      fileContents: { "src/math.ts": code },
    });
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  test("flags @ts-ignore and @ts-expect-error comments as COMPILER_SUPPRESSION_DIRECTIVE", () => {
    const code = `
      // @ts-ignore
      const a = 1;
      /* @ts-expect-error */
      const b = 2;
    `;
    const findings = scanFileForAstPurity("src/suppressed.ts", code);
    expect(findings).toHaveLength(2);
    expect(findings[0]?.violationType).toBe("COMPILER_SUPPRESSION_DIRECTIVE");
    expect(findings[0]?.lineNumber).toBe(2);
    expect(findings[1]?.violationType).toBe("COMPILER_SUPPRESSION_DIRECTIVE");
    expect(findings[1]?.lineNumber).toBe(4);
  });

  test("flags explicit any and any type assertions", () => {
    const code = `
      let x: any = 10;
      const y = x as any;
      const z = <any>x;
      function foo(item: Array<any>): Promise<any> {
        return Promise.resolve(item);
      }
    `;
    const findings = scanFileForAstPurity("src/any.ts", code);
    expect(findings.length).toBeGreaterThanOrEqual(4);
    expect(findings.some((f) => f.violationType === "EXPLICIT_ANY")).toBe(true);
    expect(findings.some((f) => f.violationType === "ANY_TYPE_ASSERTION")).toBe(true);
  });

  test("PROVES 0 FALSE POSITIVES on string literals and regular expression literals", () => {
    const code = `
      describe("mock suite", () => {
        test("inspects prohibited syntax", () => {
          const expectedMessage = "Found banned as any usage";
          const regexCheck = /<\\s*any\\s*>/u;
          const templateStr = \`Prohibiting @ts-ignore in production\`;
          expect(expectedMessage).not.toContain("as any");
          expect(regexCheck.test("<any>")).toBe(true);
        });
      });
    `;
    const findings = scanFileForAstPurity("tests/mock.test.ts", code);
    expect(findings).toHaveLength(0);

    const result = checkAstPurity({
      fileContents: { "tests/mock.test.ts": code },
    });
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  test("flags any type assertions inside template expressions while ignoring static string text", () => {
    const code = `
      const id = 123;
      const msg = \`User \${id} has \${(id as any).foo}\`;
    `;
    const findings = scanFileForAstPurity("src/template.ts", code);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.violationType === "ANY_TYPE_ASSERTION")).toBe(true);
  });

  test("flags trailing comments and eslint-disable / ts-nocheck directives", () => {
    const code = `
      const x = 1; // eslint-disable-next-line
      const y = 2; // @ts-nocheck
    `;
    const findings = scanFileForAstPurity("src/directives.ts", code);
    expect(findings.length).toBe(2);
    expect(findings.every((f) => f.violationType === "COMPILER_SUPPRESSION_DIRECTIVE")).toBe(true);
  });
});

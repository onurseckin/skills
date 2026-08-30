import ts from "typescript";
import type { AstLinterViolation } from "../anti-mock/anti-mock-types.ts";
import { getRootExpectArg, isLiteralOrConstant } from "./types.ts";

export function checkTrivialConstantAssertion(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  testName: string,
  fileName?: string,
): AstLinterViolation | undefined {
  const expr = call.expression;

  if (ts.isIdentifier(expr) && expr.text === "assert") {
    const firstArg = call.arguments[0];
    if (firstArg && firstArg.kind === ts.SyntaxKind.TrueKeyword) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(call.getStart());
      return {
        rule: "trivial_constant_assertion",
        message: `Test '${testName}' contains trivial constant assertion 'assert(true)'.`,
        file: fileName,
        line: line + 1,
        column: character + 1,
        testName,
        snippet: call.getText(sourceFile),
      };
    }
  }

  if (ts.isPropertyAccessExpression(expr)) {
    if (ts.isIdentifier(expr.expression) && expr.expression.text === "assert") {
      const methodName = expr.name.text;
      const firstArg = call.arguments[0];
      const secondArg = call.arguments[1];

      if (
        (methodName === "isTrue" && firstArg && firstArg.kind === ts.SyntaxKind.TrueKeyword) ||
        (methodName === "isFalse" && firstArg && firstArg.kind === ts.SyntaxKind.FalseKeyword)
      ) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(call.getStart());
        return {
          rule: "trivial_constant_assertion",
          message: `Test '${testName}' contains trivial constant assertion 'assert.${methodName}(...)'.`,
          file: fileName,
          line: line + 1,
          column: character + 1,
          testName,
          snippet: call.getText(sourceFile),
        };
      }

      if (
        (methodName === "equal" || methodName === "strictEqual" || methodName === "deepEqual") &&
        firstArg &&
        secondArg &&
        isLiteralOrConstant(firstArg) &&
        isLiteralOrConstant(secondArg) &&
        firstArg.getText(sourceFile) === secondArg.getText(sourceFile)
      ) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(call.getStart());
        return {
          rule: "trivial_constant_assertion",
          message: `Test '${testName}' asserts constant literal against itself in 'assert.${methodName}(...)'.`,
          file: fileName,
          line: line + 1,
          column: character + 1,
          testName,
          snippet: call.getText(sourceFile),
        };
      }
    }

    const matcherName = expr.name.text;
    const rootArg = getRootExpectArg(call);

    if (rootArg) {
      const expectedArg = call.arguments[0];

      if (
        (matcherName === "toBe" ||
          matcherName === "toEqual" ||
          matcherName === "toStrictEqual" ||
          matcherName === "toBeStrictEqual") &&
        expectedArg &&
        isLiteralOrConstant(rootArg) &&
        isLiteralOrConstant(expectedArg) &&
        rootArg.getText(sourceFile) === expectedArg.getText(sourceFile)
      ) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(call.getStart());
        return {
          rule: "trivial_constant_assertion",
          message: `Test '${testName}' asserts constant literal against itself: '${call.getText(sourceFile)}'.`,
          file: fileName,
          line: line + 1,
          column: character + 1,
          testName,
          snippet: call.getText(sourceFile),
        };
      }

      if (
        (matcherName === "toBe" || matcherName === "toEqual" || matcherName === "toStrictEqual") &&
        expectedArg &&
        ts.isIdentifier(rootArg) &&
        ts.isIdentifier(expectedArg) &&
        rootArg.text === expectedArg.text
      ) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(call.getStart());
        return {
          rule: "trivial_constant_assertion",
          message: `Test '${testName}' asserts variable '${rootArg.text}' against itself: '${call.getText(sourceFile)}'.`,
          file: fileName,
          line: line + 1,
          column: character + 1,
          testName,
          snippet: call.getText(sourceFile),
        };
      }

      if (
        (matcherName === "toBeTruthy" && rootArg.kind === ts.SyntaxKind.TrueKeyword) ||
        (matcherName === "toBeFalsy" && rootArg.kind === ts.SyntaxKind.FalseKeyword) ||
        (matcherName === "toBeNull" && rootArg.kind === ts.SyntaxKind.NullKeyword) ||
        (matcherName === "toBeUndefined" &&
          ts.isIdentifier(rootArg) &&
          rootArg.text === "undefined") ||
        (matcherName === "toBeNaN" && ts.isIdentifier(rootArg) && rootArg.text === "NaN") ||
        (matcherName === "toBeDefined" && isLiteralOrConstant(rootArg))
      ) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(call.getStart());
        return {
          rule: "trivial_constant_assertion",
          message: `Test '${testName}' contains trivial constant assertion '${call.getText(sourceFile)}'.`,
          file: fileName,
          line: line + 1,
          column: character + 1,
          testName,
          snippet: call.getText(sourceFile),
        };
      }
    }
  }

  return undefined;
}

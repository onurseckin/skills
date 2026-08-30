import ts from "typescript";
import type {
  AstLinterOptions,
  AstLinterResult,
  AstLinterViolation,
} from "../anti-mock/anti-mock-types.ts";
import { checkTrivialConstantAssertion } from "./assertion-detectors.ts";
import { checkMockTautology } from "./mock-detectors.ts";
import { identifyTestCall, isAssertionCall, type TestCallInfo } from "./types.ts";

export function lintTestAst(sourceCode: string, options?: AstLinterOptions): AstLinterResult {
  const detectEmpty = options?.detectEmptyTests ?? true;
  const detectReturns = options?.detectTrivialReturns ?? true;
  const detectMocks = options?.detectMockTautologies ?? true;
  const detectConstants = options?.detectTrivialConstants ?? true;
  const fileName =
    typeof options?.file === "string" && options.file.length > 0 ? options.file : "test.ts";

  const sourceFile = ts.createSourceFile(
    fileName,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") || fileName.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const testCalls: TestCallInfo[] = [];

  function findTests(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const testInfo = identifyTestCall(node);
      if (testInfo) {
        testCalls.push(testInfo);
      }
    }
    ts.forEachChild(node, findTests);
  }

  findTests(sourceFile);

  const violations: AstLinterViolation[] = [];
  let emptyTestCount = 0;
  let trivialReturnCount = 0;
  let mockTautologyCount = 0;
  let trivialConstantCount = 0;

  for (const { node, testName, callback } of testCalls) {
    if (detectEmpty) {
      if (!callback.body) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        violations.push({
          rule: "empty_test_function",
          message: `Test '${testName}' has no function body.`,
          file: fileName,
          line: line + 1,
          column: character + 1,
          testName,
          snippet: node.getText(sourceFile),
        });
        emptyTestCount++;
        continue;
      } else if (ts.isBlock(callback.body)) {
        if (callback.body.statements.length === 0) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(
            callback.body.getStart(),
          );
          violations.push({
            rule: "empty_test_function",
            message: `Test '${testName}' has an empty function body.`,
            file: fileName,
            line: line + 1,
            column: character + 1,
            testName,
            snippet: callback.body.getText(sourceFile),
          });
          emptyTestCount++;
          continue;
        }
      }
    }

    if (detectReturns && callback.body && ts.isBlock(callback.body)) {
      let foundAssertionBefore = false;
      let earlyReturnViolation: AstLinterViolation | undefined = undefined;

      for (const stmt of callback.body.statements) {
        let hasAssertion = false;
        function checkAssertion(n: ts.Node): void {
          if (ts.isCallExpression(n) && isAssertionCall(n)) {
            hasAssertion = true;
          }
          ts.forEachChild(n, checkAssertion);
        }
        checkAssertion(stmt);
        if (hasAssertion) {
          foundAssertionBefore = true;
        }

        if (ts.isReturnStatement(stmt)) {
          if (!foundAssertionBefore) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(stmt.getStart());
            earlyReturnViolation = {
              rule: "trivial_early_return",
              message: `Test '${testName}' returns early on line ${line + 1} before executing any assertions.`,
              file: fileName,
              line: line + 1,
              column: character + 1,
              testName,
              snippet: stmt.getText(sourceFile),
            };
            break;
          }
        }

        if (ts.isIfStatement(stmt) && !foundAssertionBefore) {
          const thenStmt = stmt.thenStatement;
          if (
            ts.isReturnStatement(thenStmt) ||
            (ts.isBlock(thenStmt) &&
              thenStmt.statements.length === 1 &&
              thenStmt.statements[0] &&
              ts.isReturnStatement(thenStmt.statements[0]))
          ) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(stmt.getStart());
            earlyReturnViolation = {
              rule: "trivial_early_return",
              message: `Test '${testName}' contains conditional early return before any assertions.`,
              file: fileName,
              line: line + 1,
              column: character + 1,
              testName,
              snippet: stmt.getText(sourceFile),
            };
            break;
          }
        }
      }

      if (earlyReturnViolation) {
        violations.push(earlyReturnViolation);
        trivialReturnCount++;
      }
    }

    if (detectConstants && callback.body) {
      function scanConstantAssertions(n: ts.Node): void {
        if (ts.isCallExpression(n) && isAssertionCall(n)) {
          const v = checkTrivialConstantAssertion(n, sourceFile, testName, fileName);
          if (v) {
            violations.push(v);
            trivialConstantCount++;
          }
        }
        ts.forEachChild(n, scanConstantAssertions);
      }
      scanConstantAssertions(callback.body);
    }

    if (detectMocks) {
      const mockViolation = checkMockTautology(callback, sourceFile, testName, fileName);
      if (mockViolation) {
        violations.push(mockViolation);
        mockTautologyCount++;
      }
    }
  }

  return {
    passed: violations.length === 0,
    totalTestsAnalyzed: testCalls.length,
    violations,
    emptyTestCount,
    trivialReturnCount,
    mockTautologyCount,
    trivialConstantCount,
  };
}

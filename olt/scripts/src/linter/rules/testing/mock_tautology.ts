import ts from "typescript";
import type { AstLintRuleModule } from "../../ast/index.ts";
import {
  detectMockDeclarations,
  getRootExpectArg,
  identifyTestCall,
  isAssertionCall,
  matchesMockTarget,
} from "../../ast/index.ts";

export const mockTautologyRule: AstLintRuleModule = {
  rule: "mock_tautology",
  checkNode: (node, context) => {
    if (ts.isCallExpression(node)) {
      const testInfo = identifyTestCall(node);
      if (testInfo !== undefined) {
        const { testName, callback } = testInfo;
        const mocks = detectMockDeclarations(callback, context.sourceFile);
        if (mocks.length > 0) {
          const mockNames = new Set(mocks.map((m) => m.varName));
          const stubbedMap = new Map<string, string>();
          for (const m of mocks) {
            if (m.stubbedReturnValue !== undefined) {
              stubbedMap.set(m.varName, m.stubbedReturnValue);
            }
          }

          let mockUsedInSut = false;
          const assertions: ts.CallExpression[] = [];

          function checkMockUsage(n: ts.Node): void {
            if (ts.isCallExpression(n)) {
              if (isAssertionCall(n)) {
                assertions.push(n);
              } else {
                let isDirectMock = false;
                if (ts.isIdentifier(n.expression)) {
                  if (mockNames.has(n.expression.text)) {
                    isDirectMock = true;
                  }
                }
                let isDirectMethod = false;
                if (ts.isPropertyAccessExpression(n.expression)) {
                  if (ts.isIdentifier(n.expression.expression)) {
                    if (mockNames.has(n.expression.expression.text)) {
                      isDirectMethod = true;
                    }
                  }
                }
                if (!isDirectMock && !isDirectMethod) {
                  for (const arg of n.arguments) {
                    if (ts.isIdentifier(arg)) {
                      if (mockNames.has(arg.text)) {
                        mockUsedInSut = true;
                      }
                    }
                  }
                }
              }
            } else if (ts.isNewExpression(n)) {
              let newArgs: readonly ts.Expression[] = [];
              if (n.arguments !== undefined && n.arguments !== null) {
                newArgs = n.arguments;
              }
              for (const arg of newArgs) {
                if (ts.isIdentifier(arg)) {
                  if (mockNames.has(arg.text)) {
                    mockUsedInSut = true;
                  }
                }
              }
            }
            ts.forEachChild(n, checkMockUsage);
          }

          if (callback.body) {
            checkMockUsage(callback.body);
          }

          let foundStubbedViolation = false;
          for (const assertion of assertions) {
            const rootArg = getRootExpectArg(assertion);
            if (
              rootArg !== undefined &&
              ts.isCallExpression(rootArg) &&
              ts.isIdentifier(rootArg.expression)
            ) {
              const calledName = rootArg.expression.text;
              const stubbed = stubbedMap.get(calledName);
              if (stubbed !== undefined && assertion.arguments.length > 0) {
                const expectedArg = assertion.arguments[0];
                if (
                  expectedArg !== undefined &&
                  expectedArg.getText(context.sourceFile) === stubbed
                ) {
                  const loc = context.sourceFile.getLineAndCharacterOfPosition(
                    assertion.getStart(context.sourceFile),
                  );
                  context.violations.push({
                    rule: "mock_tautology",
                    message: `Test '${testName}' asserts stubbed mock '${calledName}()' return value (${stubbed}) directly without exercising implementation logic.`,
                    file: context.fileName,
                    line: loc.line + 1,
                    column: loc.character + 1,
                    testName,
                    snippet: assertion.getText(context.sourceFile),
                  });
                  foundStubbedViolation = true;
                }
              }
            }
          }

          if (!foundStubbedViolation && !mockUsedInSut && assertions.length > 0) {
            let onlyMockAsserts = true;
            for (const assertion of assertions) {
              const rootArg = getRootExpectArg(assertion);
              if (rootArg === undefined) {
                onlyMockAsserts = false;
                break;
              }
              const rootText = rootArg.getText(context.sourceFile);
              let matchesAnyMock = false;
              for (const name of mockNames) {
                if (matchesMockTarget(rootText, name)) {
                  matchesAnyMock = true;
                  break;
                }
              }
              if (!matchesAnyMock) {
                onlyMockAsserts = false;
                break;
              }
            }

            if (onlyMockAsserts) {
              const firstMock = mocks[0];
              const varName = firstMock !== undefined ? firstMock.varName : "mock";
              const firstAssert = assertions[0];
              const pos =
                firstAssert !== undefined
                  ? firstAssert.getStart(context.sourceFile)
                  : callback.getStart(context.sourceFile);
              const loc = context.sourceFile.getLineAndCharacterOfPosition(pos);
              context.violations.push({
                rule: "mock_tautology",
                message: `Test '${testName}' asserts mock '${varName}' directly without passing it to any implementation under test.`,
                file: context.fileName,
                line: loc.line + 1,
                column: loc.character + 1,
                testName,
                snippet:
                  firstAssert !== undefined
                    ? firstAssert.getText(context.sourceFile)
                    : callback.getText(context.sourceFile),
              });
            }
          }
        }
      }
    }
  },
  generateFixSuggestion: () => ({
    suggestedReplacement: "/* Pass mock to system under test and assert on output */",
    explanation:
      "Avoid asserting on mocks directly without exercising production implementation logic.",
  }),
};

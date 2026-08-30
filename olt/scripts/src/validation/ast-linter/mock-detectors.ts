import ts from "typescript";
import type { AstLinterViolation } from "../anti-mock/anti-mock-types.ts";
import { getRootExpectArg, isAssertionCall, MOCK_FACTORIES, type MockInfo } from "./types.ts";

export function detectMockDeclarations(
  callback: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
): MockInfo[] {
  const mocks: MockInfo[] = [];

  function checkInitializer(init: ts.Expression): {
    isMock: boolean;
    stubbedValue?: string | undefined;
  } {
    if (ts.isCallExpression(init)) {
      let curr: ts.Expression = init;
      let stubbedValue: string | undefined = undefined;

      while (ts.isCallExpression(curr) || ts.isPropertyAccessExpression(curr)) {
        if (ts.isCallExpression(curr)) {
          if (ts.isPropertyAccessExpression(curr.expression)) {
            const propName = curr.expression.name.text;
            if (propName === "mockReturnValue" || propName === "mockResolvedValue") {
              const valArg = curr.arguments[0];
              if (valArg) stubbedValue = valArg.getText(sourceFile);
            }
            if (MOCK_FACTORIES.has(propName)) {
              return { isMock: true, stubbedValue };
            }
            curr = curr.expression.expression;
          } else if (ts.isIdentifier(curr.expression)) {
            if (
              curr.expression.text === "mock" ||
              curr.expression.text === "vi" ||
              curr.expression.text === "jest"
            ) {
              const firstArg = curr.arguments[0];
              if (firstArg && (ts.isArrowFunction(firstArg) || ts.isFunctionExpression(firstArg))) {
                if (firstArg.body && !ts.isBlock(firstArg.body)) {
                  stubbedValue = firstArg.body.getText(sourceFile);
                }
              }
              return { isMock: true, stubbedValue };
            }
            break;
          } else {
            break;
          }
        } else if (ts.isPropertyAccessExpression(curr)) {
          if (
            ts.isIdentifier(curr.expression) &&
            (curr.expression.text === "vi" || curr.expression.text === "jest") &&
            MOCK_FACTORIES.has(curr.name.text)
          ) {
            return { isMock: true, stubbedValue };
          }
          curr = curr.expression;
        } else {
          break;
        }
      }
    }
    return { isMock: false };
  }

  function walk(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const { isMock, stubbedValue } = checkInitializer(node.initializer);
      if (isMock) {
        mocks.push({ varName: node.name.text, stubbedReturnValue: stubbedValue });
      } else if (ts.isObjectLiteralExpression(node.initializer)) {
        let hasMockProp = false;
        for (const prop of node.initializer.properties) {
          if (ts.isPropertyAssignment(prop) && prop.initializer) {
            const propRes = checkInitializer(prop.initializer);
            if (propRes.isMock) {
              hasMockProp = true;
              break;
            }
          }
        }
        if (hasMockProp) {
          mocks.push({ varName: node.name.text, isMockObject: true });
        }
      }
    }
    ts.forEachChild(node, walk);
  }

  if (callback.body && ts.isBlock(callback.body)) {
    for (const stmt of callback.body.statements) {
      walk(stmt);
    }
  }

  return mocks;
}

export function checkMockTautology(
  callback: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
  testName: string,
  fileName?: string,
): AstLinterViolation | undefined {
  const mocks = detectMockDeclarations(callback, sourceFile);
  if (mocks.length === 0) return undefined;

  const mockNames = new Set(mocks.map((m) => m.varName));
  const stubbedValuesMap = new Map<string, string>();
  for (const m of mocks) {
    if (m.stubbedReturnValue !== undefined) {
      stubbedValuesMap.set(m.varName, m.stubbedReturnValue);
    }
  }

  let mockExercisedInSut = false;
  const assertions: ts.CallExpression[] = [];

  function inspectNode(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      if (isAssertionCall(node)) {
        assertions.push(node);
      } else {
        const isDirectMockCall =
          ts.isIdentifier(node.expression) && mockNames.has(node.expression.text);
        const isDirectMockMethod =
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          mockNames.has(node.expression.expression.text);

        if (!isDirectMockCall && !isDirectMockMethod) {
          for (const arg of node.arguments) {
            if (ts.isIdentifier(arg) && mockNames.has(arg.text)) {
              mockExercisedInSut = true;
            }
          }
        }
      }
    } else if (ts.isNewExpression(node)) {
      for (const arg of node.arguments ?? []) {
        if (ts.isIdentifier(arg) && mockNames.has(arg.text)) {
          mockExercisedInSut = true;
        }
      }
    }
    ts.forEachChild(node, inspectNode);
  }

  if (callback.body) {
    inspectNode(callback.body);
  }

  for (const assertion of assertions) {
    const rootArg = getRootExpectArg(assertion);
    if (rootArg && ts.isCallExpression(rootArg) && ts.isIdentifier(rootArg.expression)) {
      const calledName = rootArg.expression.text;
      const stubbed = stubbedValuesMap.get(calledName);
      if (stubbed !== undefined && assertion.arguments.length > 0) {
        const expectedArg = assertion.arguments[0];
        if (expectedArg && expectedArg.getText(sourceFile) === stubbed) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(
            assertion.getStart(),
          );
          return {
            rule: "mock_tautology",
            message: `Test '${testName}' asserts stubbed mock '${calledName}()' return value (${stubbed}) directly without exercising implementation logic.`,
            file: fileName,
            line: line + 1,
            column: character + 1,
            testName,
            snippet: assertion.getText(sourceFile),
          };
        }
      }
    }
  }

  if (!mockExercisedInSut && assertions.length > 0) {
    let onlyMockAssertions = true;
    for (const assertion of assertions) {
      const rootArg = getRootExpectArg(assertion);
      if (!rootArg) {
        onlyMockAssertions = false;
        break;
      }
      const rootText = rootArg.getText(sourceFile);
      const targetsMock = Array.from(mockNames).some(
        (name) =>
          rootText === name || rootText.startsWith(`${name}.`) || rootText.startsWith(`${name}(`),
      );
      if (!targetsMock) {
        onlyMockAssertions = false;
        break;
      }
    }

    if (onlyMockAssertions) {
      const firstMock = mocks[0];
      const varName = firstMock ? firstMock.varName : "mock";
      const firstAssert = assertions[0];
      const pos = firstAssert ? firstAssert.getStart() : callback.getStart();
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
      return {
        rule: "mock_tautology",
        message: `Test '${testName}' asserts mock '${varName}' directly without passing it to any implementation under test.`,
        file: fileName,
        line: line + 1,
        column: character + 1,
        testName,
        snippet: firstAssert ? firstAssert.getText(sourceFile) : callback.getText(sourceFile),
      };
    }
  }

  return undefined;
}

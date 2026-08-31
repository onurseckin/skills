import ts from "typescript";
import type { AstLinterViolation } from "../anti-mock/anti-mock-types.ts";
import { getRootExpectArg, isAssertionCall, MOCK_FACTORIES, type MockInfo } from "./types.ts";

export function detectMockDeclarations(
  callback: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
): MockInfo[] {
  const mocks: MockInfo[] = [];
  const destructuredFactories = new Set<string>();

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
            const idName = curr.expression.text;
            if (
              idName === "mock" ||
              idName === "vi" ||
              idName === "jest" ||
              idName === "fn" ||
              idName === "spyOn" ||
              MOCK_FACTORIES.has(idName) ||
              destructuredFactories.has(idName)
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
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) {
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
                const propName = prop.name.getText(sourceFile);
                mocks.push({
                  varName: `${node.name.text}.${propName}`,
                  stubbedReturnValue: propRes.stubbedValue,
                });
              }
            }
          }
          if (hasMockProp) {
            mocks.push({ varName: node.name.text, isMockObject: true });
          }
        }
      } else if (ts.isObjectBindingPattern(node.name)) {
        const isViOrJest =
          (ts.isIdentifier(node.initializer) &&
            (node.initializer.text === "vi" || node.initializer.text === "jest")) ||
          checkInitializer(node.initializer).isMock;
        for (const elem of node.name.elements) {
          if (ts.isIdentifier(elem.name) && (isViOrJest || MOCK_FACTORIES.has(elem.name.text))) {
            mocks.push({ varName: elem.name.text });
            destructuredFactories.add(elem.name.text);
          }
        }
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left)
    ) {
      const propRes = checkInitializer(node.right);
      if (propRes.isMock) {
        const fullName = node.left.getText(sourceFile);
        const objName = node.left.expression.getText(sourceFile);
        mocks.push({ varName: fullName, stubbedReturnValue: propRes.stubbedValue });
        mocks.push({ varName: objName, isMockObject: true });
      }
    }

    if (ts.isCallExpression(node)) {
      let curr: ts.Expression = node;
      let stubbedValue: string | undefined = undefined;
      while (ts.isCallExpression(curr) || ts.isPropertyAccessExpression(curr)) {
        if (ts.isCallExpression(curr)) {
          if (ts.isPropertyAccessExpression(curr.expression)) {
            const pName = curr.expression.name.text;
            if (pName === "mockReturnValue" || pName === "mockResolvedValue") {
              const valArg = curr.arguments[0];
              if (valArg) stubbedValue = valArg.getText(sourceFile);
            }
            if (
              (pName === "spyOn" || pName === "mock") &&
              ts.isIdentifier(curr.expression.expression) &&
              (curr.expression.expression.text === "vi" ||
                curr.expression.expression.text === "jest")
            ) {
              const targetObj = curr.arguments[0]?.getText(sourceFile);
              const targetMethod = curr.arguments[1]?.getText(sourceFile)?.replace(/['"]/g, "");
              if (targetObj) {
                mocks.push({ varName: targetObj, isMockObject: true });
                if (targetMethod) {
                  mocks.push({
                    varName: `${targetObj}.${targetMethod}`,
                    stubbedReturnValue: stubbedValue,
                  });
                }
              }
              break;
            }
          }
          curr = curr.expression;
        } else {
          curr = curr.expression;
        }
      }
    }

    ts.forEachChild(node, walk);
  }

  if (callback.body) {
    if (ts.isBlock(callback.body)) {
      for (const stmt of callback.body.statements) {
        walk(stmt);
      }
    } else {
      walk(callback.body);
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
          (mockNames.has(node.expression.getText(sourceFile)) ||
            (ts.isIdentifier(node.expression.expression) &&
              mockNames.has(node.expression.expression.text)));

        if (!isDirectMockCall && !isDirectMockMethod) {
          for (const arg of node.arguments) {
            const argText = arg.getText(sourceFile);
            if (mockNames.has(argText) || (ts.isIdentifier(arg) && mockNames.has(arg.text))) {
              mockExercisedInSut = true;
            }
          }
        }
      }
    } else if (ts.isNewExpression(node)) {
      for (const arg of node.arguments ?? []) {
        const argText = arg.getText(sourceFile);
        if (mockNames.has(argText) || (ts.isIdentifier(arg) && mockNames.has(arg.text))) {
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
    if (rootArg && ts.isCallExpression(rootArg)) {
      const calledName = rootArg.expression.getText(sourceFile);
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

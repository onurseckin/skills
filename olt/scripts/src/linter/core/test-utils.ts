import ts from "typescript";
import { isAccessOrCall } from "./utils.ts";

export const TEST_IDENTIFIERS = new Set(["test", "it"]);
export const MOCK_FACTORIES = new Set([
  "fn",
  "mock",
  "spyOn",
  "mockReturnValue",
  "mockResolvedValue",
  "mockImplementation",
]);
export const MOCK_RETURN_PROPS = new Set(["mockReturnValue", "mockResolvedValue"]);
export const MOCK_FRAMEWORK_NAMES = new Set(["mock", "vi", "jest"]);
export const ASSERTION_NAMES = new Set(["expect", "assert", "t"]);
export const EQUALITY_MATCHERS = new Set(["toBe", "toEqual", "toStrictEqual", "toBeStrictEqual"]);
export const LITERAL_SYNTAX_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.ArrayLiteralExpression,
  ts.SyntaxKind.ObjectLiteralExpression,
]);

export interface TestCallInfo {
  readonly node: ts.CallExpression;
  readonly testName: string;
  readonly callback: ts.FunctionLikeDeclaration;
}

export function isTestIdentifier(name: string): boolean {
  return TEST_IDENTIFIERS.has(name);
}

export function extractTestName(args: ts.NodeArray<ts.Expression>): string {
  for (const arg of args) {
    if (ts.isStringLiteral(arg)) {
      return arg.text;
    }
    if (ts.isNoSubstitutionTemplateLiteral(arg)) {
      return arg.text;
    }
    if (ts.isTemplateExpression(arg)) {
      return arg.getText();
    }
  }
  return "<anonymous test>";
}

export function findCallback(
  args: ts.NodeArray<ts.Expression>,
): ts.FunctionLikeDeclaration | undefined {
  for (const arg of args) {
    if (ts.isArrowFunction(arg)) {
      return arg;
    }
    if (ts.isFunctionExpression(arg)) {
      return arg;
    }
  }
  return undefined;
}

export function isTestPropertyTarget(obj: ts.Expression, prop: string): boolean {
  if (ts.isIdentifier(obj)) {
    if (isTestIdentifier(obj.text)) {
      return true;
    }
    if (obj.text === "describe" && isTestIdentifier(prop)) {
      return true;
    }
  }
  if (ts.isPropertyAccessExpression(obj)) {
    if (ts.isIdentifier(obj.name)) {
      if (isTestIdentifier(obj.name.text)) {
        return true;
      }
    }
  }
  return false;
}

export function identifyTestCall(node: ts.CallExpression): TestCallInfo | undefined {
  const expr = node.expression;
  if (ts.isIdentifier(expr) && isTestIdentifier(expr.text)) {
    const callback = findCallback(node.arguments);
    if (callback !== undefined) {
      return { node, testName: extractTestName(node.arguments), callback };
    }
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const obj = expr.expression;
    const prop = expr.name.text;
    if (isTestPropertyTarget(obj, prop)) {
      const callback = findCallback(node.arguments);
      if (callback !== undefined) {
        return { node, testName: extractTestName(node.arguments), callback };
      }
    }
  }
  if (ts.isCallExpression(expr)) {
    const innerExpr = expr.expression;
    if (
      ts.isPropertyAccessExpression(innerExpr) &&
      ts.isIdentifier(innerExpr.expression) &&
      isTestIdentifier(innerExpr.expression.text) &&
      innerExpr.name.text === "each"
    ) {
      const callback = findCallback(node.arguments);
      if (callback !== undefined) {
        return { node, testName: extractTestName(node.arguments), callback };
      }
    }
  }
  return undefined;
}

export function isLiteralOrConstant(node: ts.Node): boolean {
  if (LITERAL_SYNTAX_KINDS.has(node.kind)) {
    return true;
  }
  if (ts.isIdentifier(node)) {
    if (node.text === "undefined") {
      return true;
    }
    if (node.text === "NaN") {
      return true;
    }
  }
  if (ts.isPrefixUnaryExpression(node)) {
    if (ts.isNumericLiteral(node.operand)) {
      return true;
    }
  }
  return false;
}

export function isAssertionCall(call: ts.CallExpression): boolean {
  const expr = call.expression;
  if (ts.isIdentifier(expr)) {
    if (ASSERTION_NAMES.has(expr.text)) {
      return true;
    }
  }
  let curr: ts.Expression = expr;
  while (isAccessOrCall(curr)) {
    if (ts.isPropertyAccessExpression(curr)) {
      if (ts.isIdentifier(curr.expression)) {
        if (ASSERTION_NAMES.has(curr.expression.text)) {
          return true;
        }
      }
      curr = curr.expression;
    } else if (ts.isCallExpression(curr)) {
      if (ts.isIdentifier(curr.expression)) {
        if (ASSERTION_NAMES.has(curr.expression.text)) {
          return true;
        }
      }
      curr = curr.expression;
    } else {
      break;
    }
  }
  return false;
}

export function getRootExpectArg(node: ts.CallExpression): ts.Expression | undefined {
  if (ts.isIdentifier(node.expression)) {
    if (node.expression.text === "expect") {
      return node.arguments[0];
    }
  }
  let curr: ts.Expression = node.expression;
  while (isAccessOrCall(curr)) {
    if (ts.isCallExpression(curr)) {
      if (ts.isIdentifier(curr.expression)) {
        if (curr.expression.text === "expect") {
          return curr.arguments[0];
        }
      }
      curr = curr.expression;
    } else if (ts.isPropertyAccessExpression(curr)) {
      curr = curr.expression;
    } else {
      break;
    }
  }
  return undefined;
}

export interface MockInfo {
  readonly varName: string;
  readonly stubbedReturnValue?: string | undefined;
  readonly isMockObject?: boolean | undefined;
}

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

      while (isAccessOrCall(curr)) {
        if (ts.isCallExpression(curr)) {
          if (ts.isPropertyAccessExpression(curr.expression)) {
            const propName = curr.expression.name.text;
            if (MOCK_RETURN_PROPS.has(propName)) {
              const valArg = curr.arguments[0];
              if (valArg !== undefined) {
                stubbedValue = valArg.getText(sourceFile);
              }
            }
            if (MOCK_FACTORIES.has(propName)) {
              return { isMock: true, stubbedValue };
            }
            curr = curr.expression.expression;
          } else if (ts.isIdentifier(curr.expression)) {
            if (MOCK_FRAMEWORK_NAMES.has(curr.expression.text)) {
              const firstArg = curr.arguments[0];
              if (firstArg !== undefined) {
                const isFn = ts.isArrowFunction(firstArg)
                  ? true
                  : ts.isFunctionExpression(firstArg);
                if (isFn) {
                  const fnNode = firstArg as ts.ArrowFunction | ts.FunctionExpression;
                  if (fnNode.body && !ts.isBlock(fnNode.body)) {
                    stubbedValue = fnNode.body.getText(sourceFile);
                  }
                }
              }
              return { isMock: true, stubbedValue };
            }
            break;
          } else {
            break;
          }
        } else if (ts.isPropertyAccessExpression(curr)) {
          if (ts.isIdentifier(curr.expression)) {
            if (MOCK_FRAMEWORK_NAMES.has(curr.expression.text)) {
              if (MOCK_FACTORIES.has(curr.name.text)) {
                return { isMock: true, stubbedValue };
              }
            }
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
      const initRes = checkInitializer(node.initializer);
      if (initRes.isMock) {
        mocks.push({ varName: node.name.text, stubbedReturnValue: initRes.stubbedValue });
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

export function matchesMockTarget(rootText: string, name: string): boolean {
  if (rootText === name) {
    return true;
  }
  if (rootText.startsWith(`${name}.`)) {
    return true;
  }
  if (rootText.startsWith(`${name}(`)) {
    return true;
  }
  return false;
}

export function isTrivialLiteralMatch(methodName: string, rootArg: ts.Expression): boolean {
  if (methodName === "toBeTruthy" && rootArg.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (methodName === "toBeFalsy" && rootArg.kind === ts.SyntaxKind.FalseKeyword) {
    return true;
  }
  if (methodName === "toBeNull" && rootArg.kind === ts.SyntaxKind.NullKeyword) {
    return true;
  }
  if (methodName === "toBeUndefined" && ts.isIdentifier(rootArg) && rootArg.text === "undefined") {
    return true;
  }
  if (methodName === "toBeNaN" && ts.isIdentifier(rootArg) && rootArg.text === "NaN") {
    return true;
  }
  return false;
}

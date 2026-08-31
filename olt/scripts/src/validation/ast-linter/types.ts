import ts from "typescript";
import type {
  AstLinterOptions,
  AstLinterResult,
  AstLinterViolation,
} from "../anti-mock/anti-mock-types.ts";

export type { AstLinterOptions, AstLinterResult, AstLinterViolation };

export interface TestCallInfo {
  readonly node: ts.CallExpression;
  readonly testName: string;
  readonly callback: ts.FunctionLikeDeclaration;
}

export interface MockInfo {
  readonly varName: string;
  readonly stubbedReturnValue?: string | undefined;
  readonly isMockObject?: boolean | undefined;
}

export const TEST_IDENTIFIERS: ReadonlySet<string> = new Set(["test", "it"]);

export const MOCK_FACTORIES: ReadonlySet<string> = new Set([
  "fn",
  "mock",
  "spyOn",
  "mockReturnValue",
  "mockResolvedValue",
  "mockImplementation",
]);

export function isTestIdentifier(name: string): boolean {
  return TEST_IDENTIFIERS.has(name);
}

export function extractTestName(args: ts.NodeArray<ts.Expression>): string {
  for (const arg of args) {
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
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
    if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
      return arg;
    }
  }
  return undefined;
}

export function getRootTestIdentifier(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return getRootTestIdentifier(expr.expression);
  }
  if (ts.isCallExpression(expr)) {
    return getRootTestIdentifier(expr.expression);
  }
  return undefined;
}

export function identifyTestCall(node: ts.CallExpression): TestCallInfo | undefined {
  const expr = node.expression;
  const rootId = getRootTestIdentifier(expr);

  const isTest =
    (rootId !== undefined && isTestIdentifier(rootId)) ||
    (ts.isPropertyAccessExpression(expr) &&
      ts.isIdentifier(expr.name) &&
      isTestIdentifier(expr.name.text));

  if (isTest) {
    const callback = findCallback(node.arguments);
    if (callback) {
      return { node, testName: extractTestName(node.arguments), callback };
    }
  }

  return undefined;
}

export function isLiteralOrConstant(node: ts.Node): boolean {
  if (
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    node.kind === ts.SyntaxKind.NumericLiteral ||
    node.kind === ts.SyntaxKind.StringLiteral ||
    node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
    node.kind === ts.SyntaxKind.ArrayLiteralExpression ||
    node.kind === ts.SyntaxKind.ObjectLiteralExpression
  ) {
    return true;
  }
  if (ts.isIdentifier(node) && (node.text === "undefined" || node.text === "NaN")) {
    return true;
  }
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
    return true;
  }
  return false;
}

export function isAssertionCall(call: ts.CallExpression): boolean {
  const expr = call.expression;
  if (ts.isIdentifier(expr)) {
    return expr.text === "expect" || expr.text === "assert";
  }
  let curr: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(curr) || ts.isCallExpression(curr)) {
    if (ts.isPropertyAccessExpression(curr)) {
      if (ts.isIdentifier(curr.expression)) {
        return (
          curr.expression.text === "assert" ||
          curr.expression.text === "expect" ||
          curr.expression.text === "t"
        );
      }
      curr = curr.expression;
    } else if (ts.isCallExpression(curr)) {
      if (ts.isIdentifier(curr.expression)) {
        return curr.expression.text === "expect" || curr.expression.text === "assert";
      }
      curr = curr.expression;
    } else {
      break;
    }
  }
  return false;
}

export function getRootExpectArg(node: ts.CallExpression): ts.Expression | undefined {
  if (ts.isIdentifier(node.expression) && node.expression.text === "expect") {
    return node.arguments[0];
  }
  let curr: ts.Expression = node.expression;
  while (ts.isPropertyAccessExpression(curr) || ts.isCallExpression(curr)) {
    if (ts.isCallExpression(curr)) {
      if (ts.isIdentifier(curr.expression) && curr.expression.text === "expect") {
        return curr.arguments[0];
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

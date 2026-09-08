/**
 * @file anti-patterns.ts
 * AST check helpers for anti-patterns: empty test bodies, trivial assertions, mock tautologies.
 */

import ts from "typescript";
import type { PurityViolation } from "./types.ts";
import {
  createViolation,
  WALL_CLOCK_COMPARISON_METHODS,
  WALL_CLOCK_IDENTIFIERS,
  WALL_CLOCK_RULE,
  WALL_CLOCK_VIOLATION_MESSAGE,
} from "./rules-config.ts";

export function checkEmptyBody(
  call: ts.CallExpression,
  fnName: string,
  sf: ts.SourceFile,
  file: string,
  out: PurityViolation[],
): void {
  for (const arg of call.arguments) {
    if (
      (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) &&
      ts.isBlock(arg.body) &&
      arg.body.statements.length === 0
    ) {
      out.push(
        createViolation(
          call,
          sf,
          file,
          "anti_pattern",
          "no-empty-test-body",
          `Empty test body in '${fnName}'. Tests must assert substantive domain invariants.`,
        ),
      );
    }
  }
}

export function checkTrivialAssert(
  node: ts.CallExpression,
  expr: ts.PropertyAccessExpression,
  sf: ts.SourceFile,
  file: string,
  out: PurityViolation[],
): void {
  const method = expr.name.text;
  if (method !== "toBe" && method !== "toEqual" && method !== "toStrictEqual") {
    return;
  }
  if (
    !ts.isCallExpression(expr.expression) ||
    !ts.isIdentifier(expr.expression.expression) ||
    expr.expression.expression.text !== "expect"
  ) {
    return;
  }

  const actualArg = expr.expression.arguments[0];
  const expectedArg = node.arguments[0];
  if (!actualArg || !expectedArg) return;

  const actual = actualArg.getText(sf).trim();
  const expected = expectedArg.getText(sf).trim();
  if (actual === expected) {
    out.push(
      createViolation(
        node,
        sf,
        file,
        "anti_pattern",
        "no-trivial-assertion",
        `Trivial constant assertion 'expect(${actual}).${method}(${expected})'. Tests must verify dynamic invariants.`,
      ),
    );
  }
}

export function checkMockTautologies(
  call: ts.CallExpression,
  testLabel: string,
  sf: ts.SourceFile,
  file: string,
  out: PurityViolation[],
): void {
  for (const arg of call.arguments) {
    if ((!ts.isArrowFunction(arg) && !ts.isFunctionExpression(arg)) || !ts.isBlock(arg.body)) {
      continue;
    }
    const mockReturns = new Map<string, string>();
    for (const stmt of arg.body.statements) {
      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (
            ts.isIdentifier(decl.name) &&
            decl.initializer &&
            ts.isCallExpression(decl.initializer)
          ) {
            const initText = decl.initializer.expression.getText(sf);
            if (initText === "mock" || initText.endsWith(".mock")) {
              const mockArg = decl.initializer.arguments[0];
              if (
                mockArg &&
                (ts.isArrowFunction(mockArg) || ts.isFunctionExpression(mockArg)) &&
                !ts.isBlock(mockArg.body)
              ) {
                mockReturns.set(decl.name.text, mockArg.body.getText(sf).trim());
              }
            }
          }
        }
      } else if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
        const expr = stmt.expression.expression;
        if (
          ts.isPropertyAccessExpression(expr) &&
          (expr.name.text === "mockReturnValue" || expr.name.text === "mockResolvedValue")
        ) {
          const retArg = stmt.expression.arguments[0];
          if (retArg)
            mockReturns.set(expr.expression.getText(sf).trim(), retArg.getText(sf).trim());
        }
      }
    }
    if (mockReturns.size === 0) continue;

    function scanAssertions(n: ts.Node): void {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const mName = n.expression.name.text;
        if (
          (mName === "toBe" || mName === "toEqual") &&
          ts.isCallExpression(n.expression.expression)
        ) {
          const innerCall = n.expression.expression;
          if (ts.isIdentifier(innerCall.expression) && innerCall.expression.text === "expect") {
            const actual = innerCall.arguments[0];
            const expected = n.arguments[0];
            if (
              actual &&
              expected &&
              ts.isCallExpression(actual) &&
              ts.isIdentifier(actual.expression)
            ) {
              if (mockReturns.get(actual.expression.text) === expected.getText(sf).trim()) {
                out.push(
                  createViolation(
                    n,
                    sf,
                    file,
                    "anti_pattern",
                    "no-mock-tautology",
                    `Mock tautology in '${testLabel}': asserting stubbed return value of '${actual.expression.text}()' directly.`,
                  ),
                );
              }
            }
          }
        }
      }
      ts.forEachChild(n, scanAssertions);
    }
    scanAssertions(arg.body);
  }
}

function unwrapParens(node: ts.Node): ts.Node {
  let curr = node;
  while (ts.isParenthesizedExpression(curr)) {
    curr = curr.expression;
  }
  return curr;
}

function findDeclarationInitializer(
  identName: string,
  fromNode: ts.Node,
): ts.Expression | undefined {
  let curr: ts.Node | undefined = fromNode.parent;

  while (curr) {
    if (ts.isBlock(curr) || ts.isSourceFile(curr)) {
      for (const stmt of curr.statements) {
        if (stmt.pos >= fromNode.pos) break;

        if (ts.isVariableStatement(stmt)) {
          for (const decl of stmt.declarationList.declarations) {
            if (ts.isIdentifier(decl.name) && decl.name.text === identName) {
              if (decl.initializer) {
                return decl.initializer;
              }
            }
          }
        }
      }
    }
    curr = curr.parent;
  }

  return undefined;
}

export function involvesWallClock(node: ts.Node, sf: ts.SourceFile, depth = 0): boolean {
  if (depth > 3) return false;
  let found = false;

  function visit(n: ts.Node): void {
    if (found) return;

    if (ts.isCallExpression(n)) {
      const callText = n.expression.getText(sf);
      if (callText === "Date.now" || callText === "performance.now" || callText.endsWith(".now")) {
        found = true;
        return;
      }
    }

    if (ts.isIdentifier(n)) {
      if (WALL_CLOCK_IDENTIFIERS.has(n.text)) {
        found = true;
        return;
      }
      if (depth < 2) {
        const init = findDeclarationInitializer(n.text, n);
        if (init && involvesWallClock(init, sf, depth + 1)) {
          found = true;
          return;
        }
      }
    }

    ts.forEachChild(n, visit);
  }

  visit(node);
  return found;
}

export function isWallClockBinaryComparison(node: ts.Node, sf: ts.SourceFile, depth = 0): boolean {
  const unwrapped = unwrapParens(node);

  if (ts.isBinaryExpression(unwrapped)) {
    const op = unwrapped.operatorToken.kind;
    const isComparisonOp =
      op === ts.SyntaxKind.LessThanToken ||
      op === ts.SyntaxKind.LessThanEqualsToken ||
      op === ts.SyntaxKind.GreaterThanToken ||
      op === ts.SyntaxKind.GreaterThanEqualsToken;

    if (isComparisonOp) {
      if (involvesWallClock(unwrapped.left, sf) || involvesWallClock(unwrapped.right, sf)) {
        return true;
      }
    }
  }

  if (ts.isIdentifier(unwrapped) && depth < 2) {
    const init = findDeclarationInitializer(unwrapped.text, unwrapped);
    if (init && isWallClockBinaryComparison(init, sf, depth + 1)) {
      return true;
    }
  }

  return false;
}

function getExpectCall(expr: ts.PropertyAccessExpression): ts.CallExpression | undefined {
  let curr: ts.Expression = expr.expression;
  while (ts.isPropertyAccessExpression(curr)) {
    const name = curr.name.text;
    if (name === "not" || name === "resolves" || name === "rejects") {
      curr = curr.expression;
    } else {
      break;
    }
  }
  if (
    ts.isCallExpression(curr) &&
    ts.isIdentifier(curr.expression) &&
    curr.expression.text === "expect"
  ) {
    return curr;
  }
  return undefined;
}

export function checkWallClockAssert(
  node: ts.CallExpression,
  expr: ts.PropertyAccessExpression,
  sf: ts.SourceFile,
  file: string,
  out: PurityViolation[],
): void {
  const expectCall = getExpectCall(expr);
  if (expectCall) {
    const actualArg = expectCall.arguments[0];

    // Case 1: expect(binaryComparison).matcher(...) e.g. expect(Date.now() - start < 100).toBe(true)
    if (actualArg && isWallClockBinaryComparison(actualArg, sf)) {
      out.push(
        createViolation(
          node,
          sf,
          file,
          "anti_pattern",
          WALL_CLOCK_RULE,
          WALL_CLOCK_VIOLATION_MESSAGE,
        ),
      );
      return;
    }

    // Case 2: expect(timingExpr).toBeLessThan(...) or expect(100).toBeGreaterThan(timingExpr)
    const method = expr.name.text;
    if (WALL_CLOCK_COMPARISON_METHODS.has(method)) {
      const actualWallClock = actualArg !== undefined && involvesWallClock(actualArg, sf);
      const expectedWallClock = node.arguments.some((arg) => involvesWallClock(arg, sf));

      if (actualWallClock || expectedWallClock) {
        out.push(
          createViolation(
            node,
            sf,
            file,
            "anti_pattern",
            WALL_CLOCK_RULE,
            WALL_CLOCK_VIOLATION_MESSAGE,
          ),
        );
        return;
      }
    }
  }

  const receiverText = expr.expression.getText(sf);
  if (receiverText === "assert" || receiverText.endsWith(".assert")) {
    if (node.arguments.some((arg) => isWallClockBinaryComparison(arg, sf))) {
      out.push(
        createViolation(
          node,
          sf,
          file,
          "anti_pattern",
          WALL_CLOCK_RULE,
          WALL_CLOCK_VIOLATION_MESSAGE,
        ),
      );
      return;
    }

    const method = expr.name.text;
    if (
      method === "isBelow" ||
      method === "isAbove" ||
      method === "isAtLeast" ||
      method === "isAtMost" ||
      method === "lessThan" ||
      method === "greaterThan"
    ) {
      if (node.arguments.some((arg) => involvesWallClock(arg, sf))) {
        out.push(
          createViolation(
            node,
            sf,
            file,
            "anti_pattern",
            WALL_CLOCK_RULE,
            WALL_CLOCK_VIOLATION_MESSAGE,
          ),
        );
        return;
      }
    }
  }
}

export function checkWallClockAssertIdentifier(
  node: ts.CallExpression,
  sf: ts.SourceFile,
  file: string,
  out: PurityViolation[],
): void {
  if (node.arguments.some((arg) => isWallClockBinaryComparison(arg, sf))) {
    out.push(
      createViolation(
        node,
        sf,
        file,
        "anti_pattern",
        WALL_CLOCK_RULE,
        WALL_CLOCK_VIOLATION_MESSAGE,
      ),
    );
  }
}

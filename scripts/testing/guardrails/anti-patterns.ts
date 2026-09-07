/**
 * @file anti-patterns.ts
 * AST check helpers for anti-patterns: empty test bodies, trivial assertions, mock tautologies.
 */

import ts from "typescript";
import type { PurityViolation } from "./types.ts";
import { createViolation } from "./rules-config.ts";

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

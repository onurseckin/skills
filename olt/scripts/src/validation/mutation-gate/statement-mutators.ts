import ts from "typescript";
import type { CandidateAdder } from "./expression-mutators.ts";

export function shouldSkipStringLiteral(node: ts.StringLiteral): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (
    ts.isCallExpression(parent) &&
    ts.isIdentifier(parent.expression) &&
    parent.expression.text === "require"
  ) {
    return true;
  }
  if (ts.isExpressionStatement(parent) && parent.parent && ts.isSourceFile(parent.parent)) {
    return true;
  }
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  return false;
}

export function visitReturnStatements(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  addCandidate: CandidateAdder,
): void {
  if (!ts.isReturnStatement(node)) return;

  if (node.expression) {
    const expr = node.expression;
    if (expr.kind === ts.SyntaxKind.TrueKeyword) {
      addCandidate(
        "flip_return_value",
        "Flip return true to return false",
        node.getStart(sourceFile),
        node.getEnd(),
        node.getText(sourceFile),
        "return false;",
      );
    } else if (expr.kind === ts.SyntaxKind.FalseKeyword) {
      addCandidate(
        "flip_return_value",
        "Flip return false to return true",
        node.getStart(sourceFile),
        node.getEnd(),
        node.getText(sourceFile),
        "return true;",
      );
    } else if (ts.isNumericLiteral(expr)) {
      const numVal = Number(expr.text);
      const replacement = numVal === 0 ? "1" : "0";
      addCandidate(
        "flip_return_value",
        `Flip return ${expr.text} to return ${replacement}`,
        node.getStart(sourceFile),
        node.getEnd(),
        node.getText(sourceFile),
        `return ${replacement};`,
      );
    } else if (ts.isStringLiteral(expr)) {
      const replacement = expr.text.length > 0 ? '""' : '"__MUTATED__"';
      addCandidate(
        "flip_return_value",
        `Flip return string to ${replacement}`,
        node.getStart(sourceFile),
        node.getEnd(),
        node.getText(sourceFile),
        `return ${replacement};`,
      );
    } else {
      addCandidate(
        "flip_return_value",
        "Flip return value to return undefined",
        node.getStart(sourceFile),
        node.getEnd(),
        node.getText(sourceFile),
        "return undefined;",
      );
    }
  } else {
    addCandidate(
      "flip_return_value",
      "Flip bare return to return true",
      node.getStart(sourceFile),
      node.getEnd(),
      node.getText(sourceFile),
      "return true;",
    );
  }
}

export function visitFunctionBodies(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  addCandidate: CandidateAdder,
): void {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)) &&
    node.body &&
    ts.isBlock(node.body) &&
    node.body.statements.length > 0
  ) {
    addCandidate(
      "strip_function_body",
      "Strip function body statements",
      node.body.getStart(sourceFile),
      node.body.getEnd(),
      node.body.getText(sourceFile),
      "{ return undefined; }",
    );
  }
}

export function visitStringLiterals(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  addCandidate: CandidateAdder,
): void {
  if (ts.isStringLiteral(node) && !shouldSkipStringLiteral(node)) {
    const replacement = node.text.length > 0 ? '""' : '"__MUTATED__"';
    addCandidate(
      "string_literal_mutation",
      `Mutate string literal to ${replacement}`,
      node.getStart(sourceFile),
      node.getEnd(),
      node.getText(sourceFile),
      replacement,
    );
  }
}

import ts from "typescript";
import type { MutationCandidate, MutationType } from "./types.ts";

export type CandidateAdder = (
  mutationType: MutationType,
  description: string,
  start: number,
  end: number,
  originalText: string,
  replacementText: string,
) => void;

export function shouldSkipStringLiteral(node: ts.StringLiteral): boolean {
  const parent = node.parent;
  if (!parent) return false;
  // Skip import / export declarations
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  // Skip require calls
  if (
    ts.isCallExpression(parent) &&
    ts.isIdentifier(parent.expression) &&
    parent.expression.text === "require"
  ) {
    return true;
  }
  // Skip directive prologues e.g. "use strict"
  if (ts.isExpressionStatement(parent) && parent.parent && ts.isSourceFile(parent.parent)) {
    return true;
  }
  // Skip object property names if not computed
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;

  return false;
}

export function visitBooleanAndUnary(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  addCandidate: CandidateAdder,
): void {
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    addCandidate(
      "invert_boolean",
      "Invert true to false",
      node.getStart(sourceFile),
      node.getEnd(),
      "true",
      "false",
    );
  } else if (node.kind === ts.SyntaxKind.FalseKeyword) {
    addCandidate(
      "invert_boolean",
      "Invert false to true",
      node.getStart(sourceFile),
      node.getEnd(),
      "false",
      "true",
    );
  }

  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const operandText = node.operand.getText(sourceFile);
    addCandidate(
      "invert_boolean",
      `Remove logical NOT (!${operandText} -> ${operandText})`,
      node.getStart(sourceFile),
      node.getEnd(),
      node.getText(sourceFile),
      operandText,
    );
  }
}

export function visitBinaryExpressions(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  addCandidate: CandidateAdder,
): void {
  if (!ts.isBinaryExpression(node)) return;

  const opToken = node.operatorToken;
  const opKind = opToken.kind;

  // Comparison / Equality
  if (opKind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
    addCandidate("comparison_mutation", "Mutate === to !==", opToken.getStart(sourceFile), opToken.getEnd(), "===", "!==");
  } else if (opKind === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
    addCandidate("comparison_mutation", "Mutate !== to ===", opToken.getStart(sourceFile), opToken.getEnd(), "!==", "===");
  } else if (opKind === ts.SyntaxKind.EqualsEqualsToken) {
    addCandidate("comparison_mutation", "Mutate == to !=", opToken.getStart(sourceFile), opToken.getEnd(), "==", "!=");
  } else if (opKind === ts.SyntaxKind.ExclamationEqualsToken) {
    addCandidate("comparison_mutation", "Mutate != to ==", opToken.getStart(sourceFile), opToken.getEnd(), "!=", "==");
  } else if (opKind === ts.SyntaxKind.LessThanToken) {
    addCandidate("comparison_mutation", "Mutate < to >=", opToken.getStart(sourceFile), opToken.getEnd(), "<", ">=");
  } else if (opKind === ts.SyntaxKind.LessThanEqualsToken) {
    addCandidate("comparison_mutation", "Mutate <= to >", opToken.getStart(sourceFile), opToken.getEnd(), "<=", ">");
  } else if (opKind === ts.SyntaxKind.GreaterThanToken) {
    addCandidate("comparison_mutation", "Mutate > to <=", opToken.getStart(sourceFile), opToken.getEnd(), ">", "<=");
  } else if (opKind === ts.SyntaxKind.GreaterThanEqualsToken) {
    addCandidate("comparison_mutation", "Mutate >= to <", opToken.getStart(sourceFile), opToken.getEnd(), ">=", "<");
  }

  // Logical Operators
  if (opKind === ts.SyntaxKind.AmpersandAmpersandToken) {
    addCandidate("logical_operator_mutation", "Mutate && to ||", opToken.getStart(sourceFile), opToken.getEnd(), "&&", "||");
  } else if (opKind === ts.SyntaxKind.BarBarToken) {
    addCandidate("logical_operator_mutation", "Mutate || to &&", opToken.getStart(sourceFile), opToken.getEnd(), "||", "&&");
  }

  // Arithmetic Operators
  if (opKind === ts.SyntaxKind.PlusToken) {
    addCandidate("arithmetic_mutation", "Mutate + to -", opToken.getStart(sourceFile), opToken.getEnd(), "+", "-");
  } else if (opKind === ts.SyntaxKind.MinusToken) {
    addCandidate("arithmetic_mutation", "Mutate - to +", opToken.getStart(sourceFile), opToken.getEnd(), "-", "+");
  } else if (opKind === ts.SyntaxKind.AsteriskToken) {
    addCandidate("arithmetic_mutation", "Mutate * to /", opToken.getStart(sourceFile), opToken.getEnd(), "*", "/");
  } else if (opKind === ts.SyntaxKind.SlashToken) {
    addCandidate("arithmetic_mutation", "Mutate / to *", opToken.getStart(sourceFile), opToken.getEnd(), "/", "*");
  } else if (opKind === ts.SyntaxKind.PercentToken) {
    addCandidate("arithmetic_mutation", "Mutate % to *", opToken.getStart(sourceFile), opToken.getEnd(), "%", "*");
  }
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
      addCandidate("flip_return_value", "Flip return true to return false", node.getStart(sourceFile), node.getEnd(), node.getText(sourceFile), "return false;");
    } else if (expr.kind === ts.SyntaxKind.FalseKeyword) {
      addCandidate("flip_return_value", "Flip return false to return true", node.getStart(sourceFile), node.getEnd(), node.getText(sourceFile), "return true;");
    } else if (ts.isNumericLiteral(expr)) {
      const numVal = Number(expr.text);
      const replacement = numVal === 0 ? "1" : "0";
      addCandidate("flip_return_value", `Flip return ${expr.text} to return ${replacement}`, node.getStart(sourceFile), node.getEnd(), node.getText(sourceFile), `return ${replacement};`);
    } else if (ts.isStringLiteral(expr)) {
      const replacement = expr.text.length > 0 ? '""' : '"__MUTATED__"';
      addCandidate("flip_return_value", `Flip return string to ${replacement}`, node.getStart(sourceFile), node.getEnd(), node.getText(sourceFile), `return ${replacement};`);
    } else {
      addCandidate("flip_return_value", "Flip return value to return undefined", node.getStart(sourceFile), node.getEnd(), node.getText(sourceFile), "return undefined;");
    }
  } else {
    addCandidate("flip_return_value", "Flip bare return to return true", node.getStart(sourceFile), node.getEnd(), node.getText(sourceFile), "return true;");
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

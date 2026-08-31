import ts from "typescript";
import type { MutationType } from "./types.ts";

export type CandidateAdder = (
  mutationType: MutationType,
  description: string,
  start: number,
  end: number,
  originalText: string,
  replacementText: string,
) => void;

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

  if (opKind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
    addCandidate(
      "comparison_mutation",
      "Mutate === to !==",
      opToken.getStart(sourceFile),
      opToken.getEnd(),
      "===",
      "!==",
    );
  } else if (opKind === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
    addCandidate(
      "comparison_mutation",
      "Mutate !== to ===",
      opToken.getStart(sourceFile),
      opToken.getEnd(),
      "!==",
      "===",
    );
  } else if (opKind === ts.SyntaxKind.EqualsEqualsToken) {
    addCandidate(
      "comparison_mutation",
      "Mutate == to !=",
      opToken.getStart(sourceFile),
      opToken.getEnd(),
      "==",
      "!=",
    );
  } else if (opKind === ts.SyntaxKind.ExclamationEqualsToken) {
    addCandidate(
      "comparison_mutation",
      "Mutate != to ==",
      opToken.getStart(sourceFile),
      opToken.getEnd(),
      "!=",
      "==",
    );
  } else if (opKind === ts.SyntaxKind.LessThanToken) {
    addCandidate(
      "comparison_mutation",
      "Mutate < to >=",
      opToken.getStart(sourceFile),
      opToken.getEnd(),
      "<",
      ">=",
    );
  } else if (opKind === ts.SyntaxKind.LessThanEqualsToken) {
    addCandidate(
      "comparison_mutation",
      "Mutate <= to >",
      opToken.getStart(sourceFile),
      opToken.getEnd(),
      "<=",
      ">",
    );
  } else if (opKind === ts.SyntaxKind.GreaterThanToken) {
    addCandidate(
      "comparison_mutation",
      "Mutate > to <=",
      opToken.getStart(sourceFile),
      opToken.getEnd(),
      ">",
      "<=",
    );
  } else if (opKind === ts.SyntaxKind.GreaterThanEqualsToken) {
    addCandidate(
      "comparison_mutation",
      "Mutate >= to <",
      opToken.getStart(sourceFile),
      opToken.getEnd(),
      ">=",
      "<",
    );
  }

  if (opKind === ts.SyntaxKind.AmpersandAmpersandToken) {
    addCandidate(
      "logical_operator_mutation",
      "Mutate && to ||",
      opToken.getStart(sourceFile),
      opToken.getEnd(),
      "&&",
      "||",
    );
  } else if (opKind === ts.SyntaxKind.BarBarToken) {
    addCandidate(
      "logical_operator_mutation",
      "Mutate || to &&",
      opToken.getStart(sourceFile),
      opToken.getEnd(),
      "||",
      "&&",
    );
  }

  if (opKind === ts.SyntaxKind.PlusToken) {
    addCandidate(
      "arithmetic_mutation",
      "Mutate + to -",
      opToken.getStart(sourceFile),
      opToken.getEnd(),
      "+",
      "-",
    );
  } else if (opKind === ts.SyntaxKind.MinusToken) {
    addCandidate(
      "arithmetic_mutation",
      "Mutate - to +",
      opToken.getStart(sourceFile),
      opToken.getEnd(),
      "-",
      "+",
    );
  } else if (opKind === ts.SyntaxKind.AsteriskToken) {
    addCandidate(
      "arithmetic_mutation",
      "Mutate * to /",
      opToken.getStart(sourceFile),
      opToken.getEnd(),
      "*",
      "/",
    );
  } else if (opKind === ts.SyntaxKind.SlashToken) {
    addCandidate(
      "arithmetic_mutation",
      "Mutate / to *",
      opToken.getStart(sourceFile),
      opToken.getEnd(),
      "/",
      "*",
    );
  } else if (opKind === ts.SyntaxKind.PercentToken) {
    addCandidate(
      "arithmetic_mutation",
      "Mutate % to *",
      opToken.getStart(sourceFile),
      opToken.getEnd(),
      "%",
      "*",
    );
  }
}

import ts from "typescript";
import type { AstLintRuleModule } from "../ast/index.ts";

export const nullishCoalescingRule: AstLintRuleModule = {
  rule: "nullish_coalescing",
  checkNode: (node, context) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      const loc = context.sourceFile.getLineAndCharacterOfPosition(
        node.getStart(context.sourceFile),
      );
      context.violations.push({
        rule: "nullish_coalescing",
        message:
          "Prohibited nullish coalescing operator (??) detected. Use explicit branching instead.",
        file: context.fileName,
        line: loc.line + 1,
        column: loc.character + 1,
        snippet: node.getText(context.sourceFile),
      });
    }
  },
  generateFixSuggestion: (violation) => {
    const parts = violation.snippet.split("??").map((s) => s.trim());
    if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
      const left = parts[0];
      const right = parts[1];
      return {
        suggestedReplacement: `(${left} !== undefined && ${left} !== null ? ${left} : ${right})`,
        explanation:
          "Replace nullish coalescing operator (??) with explicit nullish checks or explicit branching.",
      };
    }
    return {
      suggestedReplacement: "/* Use explicit if-check or ternary condition */",
      explanation:
        "Replace nullish coalescing operator (??) with explicit nullish checks or explicit branching.",
    };
  },
};

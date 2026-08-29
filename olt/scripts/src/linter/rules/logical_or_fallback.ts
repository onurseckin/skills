import ts from "typescript";
import type { AstLintRuleModule } from "../ast/index.ts";

export const logicalOrFallbackRule: AstLintRuleModule = {
  rule: "logical_or_fallback",
  checkNode: (node, context) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      const loc = context.sourceFile.getLineAndCharacterOfPosition(
        node.getStart(context.sourceFile),
      );
      context.violations.push({
        rule: "logical_or_fallback",
        message: "Prohibited logical OR operator (||) detected. Use explicit branching instead.",
        file: context.fileName,
        line: loc.line + 1,
        column: loc.character + 1,
        snippet: node.getText(context.sourceFile),
      });
    }
  },
  generateFixSuggestion: (violation) => {
    const parts = violation.snippet.split("||").map((s) => s.trim());
    if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
      const left = parts[0];
      const right = parts[1];
      return {
        suggestedReplacement: `(Boolean(${left}) ? ${left} : ${right})`,
        explanation:
          "Replace logical OR fallback operator (||) with explicit boolean verification.",
      };
    }
    return {
      suggestedReplacement: "/* Use explicit branching instead of || */",
      explanation: "Replace logical OR fallback operator (||) with explicit boolean verification.",
    };
  },
};

import ts from "typescript";
import type { AstLintRuleModule } from "../ast/index.ts";

export const anyTypeRule: AstLintRuleModule = {
  rule: "any_type",
  checkNode: (node, context) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const loc = context.sourceFile.getLineAndCharacterOfPosition(
        node.getStart(context.sourceFile),
      );
      context.violations.push({
        rule: "any_type",
        message:
          "Prohibited 'any' type annotation detected. Use strict types or type guards instead.",
        file: context.fileName,
        line: loc.line + 1,
        column: loc.character + 1,
        snippet: node.getText(context.sourceFile),
      });
    }
  },
  generateFixSuggestion: (violation) => {
    let replacement = "unknown";
    if (violation.snippet.includes("as any")) {
      replacement = violation.snippet.replace(/\bas\s+any\b/gu, "as unknown");
    } else if (violation.snippet.includes(": any")) {
      replacement = violation.snippet.replace(/:\s*any\b/gu, ": unknown");
    } else if (violation.snippet.includes("<any>")) {
      replacement = violation.snippet.replace(/<any>/gu, "<unknown>");
    }
    return {
      suggestedReplacement: replacement,
      explanation: "Replace 'any' with 'unknown', strict generic types, or safe type guards.",
    };
  },
};

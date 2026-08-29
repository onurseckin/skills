import ts from "typescript";
import type { AstLintRuleModule } from "../ast/index.ts";

export const nonNullAssertionRule: AstLintRuleModule = {
  rule: "non_null_assertion",
  checkNode: (node, context) => {
    if (ts.isNonNullExpression(node)) {
      const loc = context.sourceFile.getLineAndCharacterOfPosition(
        node.getStart(context.sourceFile),
      );
      context.violations.push({
        rule: "non_null_assertion",
        message:
          "Prohibited non-null assertion operator (!) detected. Use explicit branching and runtime verification.",
        file: context.fileName,
        line: loc.line + 1,
        column: loc.character + 1,
        snippet: node.getText(context.sourceFile),
      });
    }
  },
  generateFixSuggestion: () => ({
    suggestedReplacement: "/* verify value !== undefined before access */",
    explanation: "Replace non-null assertion (!) with explicit conditional guard or runtime check.",
  }),
};

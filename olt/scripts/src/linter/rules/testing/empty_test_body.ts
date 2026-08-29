import ts from "typescript";
import type { AstLintRuleModule } from "../../ast/index.ts";
import { identifyTestCall } from "../../ast/index.ts";

export const emptyTestBodyRule: AstLintRuleModule = {
  rule: "empty_test_body",
  checkNode: (node, context) => {
    if (ts.isCallExpression(node)) {
      const testInfo = identifyTestCall(node);
      if (testInfo !== undefined) {
        const { testName, callback } = testInfo;
        if (!callback.body) {
          const loc = context.sourceFile.getLineAndCharacterOfPosition(
            node.getStart(context.sourceFile),
          );
          context.violations.push({
            rule: "empty_test_body",
            message: `Test '${testName}' has no function body.`,
            file: context.fileName,
            line: loc.line + 1,
            column: loc.character + 1,
            testName,
            snippet: node.getText(context.sourceFile),
          });
        } else if (ts.isBlock(callback.body) && callback.body.statements.length === 0) {
          const loc = context.sourceFile.getLineAndCharacterOfPosition(
            callback.body.getStart(context.sourceFile),
          );
          context.violations.push({
            rule: "empty_test_body",
            message: `Test '${testName}' has an empty function body.`,
            file: context.fileName,
            line: loc.line + 1,
            column: loc.character + 1,
            testName,
            snippet: callback.body.getText(context.sourceFile),
          });
        }
      }
    }
  },
  generateFixSuggestion: () => ({
    suggestedReplacement: "/* Add test statements and assertions */",
    explanation: "Provide test statements and assertions verifying behavior.",
  }),
};

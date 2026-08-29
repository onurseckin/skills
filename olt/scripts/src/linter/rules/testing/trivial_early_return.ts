import ts from "typescript";
import type { AstLintRuleModule } from "../../ast/index.ts";
import { identifyTestCall, isAssertionCall } from "../../ast/index.ts";

export const trivialEarlyReturnRule: AstLintRuleModule = {
  rule: "trivial_early_return",
  checkNode: (node, context) => {
    if (ts.isCallExpression(node)) {
      const testInfo = identifyTestCall(node);
      if (testInfo !== undefined && testInfo.callback.body && ts.isBlock(testInfo.callback.body)) {
        let foundAssertion = false;
        for (const stmt of testInfo.callback.body.statements) {
          let stmtHasAssertion = false;
          function checkStmtAssertion(n: ts.Node): void {
            if (ts.isCallExpression(n) && isAssertionCall(n)) {
              stmtHasAssertion = true;
            }
            ts.forEachChild(n, checkStmtAssertion);
          }
          checkStmtAssertion(stmt);

          if (stmtHasAssertion) {
            foundAssertion = true;
          }

          if (ts.isReturnStatement(stmt) && !foundAssertion) {
            const loc = context.sourceFile.getLineAndCharacterOfPosition(
              stmt.getStart(context.sourceFile),
            );
            context.violations.push({
              rule: "trivial_early_return",
              message: `Test '${testInfo.testName}' has early return before any assertion was reached.`,
              file: context.fileName,
              line: loc.line + 1,
              column: loc.character + 1,
              testName: testInfo.testName,
              snippet: stmt.getText(context.sourceFile),
            });
            break;
          }
        }
      }
    }
  },
  generateFixSuggestion: () => ({
    suggestedReplacement: "/* Execute assertions before returning */",
    explanation: "Ensure test executes assertions before any return statement.",
  }),
};

import ts from "typescript";
import type { AstLintRuleModule } from "../../ast/index.ts";
import {
  EQUALITY_MATCHERS,
  getRootExpectArg,
  isLiteralOrConstant,
  isTrivialLiteralMatch,
} from "../../ast/index.ts";

export const trivialAssertionRule: AstLintRuleModule = {
  rule: "trivial_assertion",
  checkNode: (node, context) => {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isIdentifier(expr) && expr.text === "assert") {
        const firstArg = node.arguments[0];
        if (firstArg !== undefined && firstArg.kind === ts.SyntaxKind.TrueKeyword) {
          const loc = context.sourceFile.getLineAndCharacterOfPosition(
            node.getStart(context.sourceFile),
          );
          context.violations.push({
            rule: "trivial_assertion",
            message: "Trivial constant assertion 'assert(true)' detected.",
            file: context.fileName,
            line: loc.line + 1,
            column: loc.character + 1,
            snippet: node.getText(context.sourceFile),
          });
        }
      }

      if (ts.isPropertyAccessExpression(expr)) {
        const methodName = expr.name.text;
        const rootArg = getRootExpectArg(node);

        if (rootArg !== undefined) {
          const expectedArg = node.arguments[0];

          if (
            EQUALITY_MATCHERS.has(methodName) &&
            expectedArg !== undefined &&
            isLiteralOrConstant(rootArg) &&
            isLiteralOrConstant(expectedArg) &&
            rootArg.getText(context.sourceFile) === expectedArg.getText(context.sourceFile)
          ) {
            const loc = context.sourceFile.getLineAndCharacterOfPosition(
              node.getStart(context.sourceFile),
            );
            context.violations.push({
              rule: "trivial_assertion",
              message: `Trivial constant assertion comparing literal against itself: '${node.getText(context.sourceFile)}'.`,
              file: context.fileName,
              line: loc.line + 1,
              column: loc.character + 1,
              snippet: node.getText(context.sourceFile),
            });
          }

          if (
            EQUALITY_MATCHERS.has(methodName) &&
            expectedArg !== undefined &&
            ts.isIdentifier(rootArg) &&
            ts.isIdentifier(expectedArg) &&
            rootArg.text === expectedArg.text
          ) {
            const loc = context.sourceFile.getLineAndCharacterOfPosition(
              node.getStart(context.sourceFile),
            );
            context.violations.push({
              rule: "trivial_assertion",
              message: `Trivial assertion comparing variable '${rootArg.text}' against itself: '${node.getText(context.sourceFile)}'.`,
              file: context.fileName,
              line: loc.line + 1,
              column: loc.character + 1,
              snippet: node.getText(context.sourceFile),
            });
          }

          if (isTrivialLiteralMatch(methodName, rootArg)) {
            const loc = context.sourceFile.getLineAndCharacterOfPosition(
              node.getStart(context.sourceFile),
            );
            context.violations.push({
              rule: "trivial_assertion",
              message: `Trivial constant assertion '${node.getText(context.sourceFile)}'.`,
              file: context.fileName,
              line: loc.line + 1,
              column: loc.character + 1,
              snippet: node.getText(context.sourceFile),
            });
          }
        }
      }
    }
  },
  generateFixSuggestion: () => ({
    suggestedReplacement: "/* Assert on dynamic computed result from function under test */",
    explanation:
      "Replace trivial literal comparison with meaningful assertions on actual business logic.",
  }),
};

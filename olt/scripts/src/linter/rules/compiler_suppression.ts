import ts from "typescript";
import {
  COMPILER_SUPPRESSION_DIRECTIVES,
  isCommentToken,
  isJsxFile,
  type AstLintRuleModule,
} from "../ast/index.ts";

export const compilerSuppressionRule: AstLintRuleModule = {
  rule: "compiler_suppression",
  checkSourceFile: (sourceCode, context) => {
    let languageVariant = ts.LanguageVariant.Standard;
    if (isJsxFile(context.fileName)) {
      languageVariant = ts.LanguageVariant.JSX;
    }
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, languageVariant, sourceCode);
    let token = scanner.scan();
    while (token !== ts.SyntaxKind.EndOfFileToken) {
      if (isCommentToken(token)) {
        const commentText = scanner.getTokenText();
        const commentPos = scanner.getTokenPos();
        for (const suppression of COMPILER_SUPPRESSION_DIRECTIVES) {
          if (commentText.includes(suppression)) {
            const loc = context.sourceFile.getLineAndCharacterOfPosition(commentPos);
            context.violations.push({
              rule: "compiler_suppression",
              message: `Prohibited compiler suppression directive '${suppression}' detected.`,
              file: context.fileName,
              line: loc.line + 1,
              column: loc.character + 1,
              snippet: commentText.trim(),
            });
            break;
          }
        }
      }
      token = scanner.scan();
    }
  },
  generateFixSuggestion: () => ({
    suggestedReplacement: "",
    explanation: "Remove compiler suppression directive and fix underlying TypeScript type issue.",
  }),
};

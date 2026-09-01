import ts from "typescript";
import {
  findVendorInWordList,
  isIdentifierNode,
  isInsideVendorConfigDefinition,
  type AstLintRuleModule,
} from "../ast/index.ts";

export const vendorLeakRule: AstLintRuleModule = {
  rule: "vendor_leak",
  checkNode: (node, context) => {
    if (isIdentifierNode(node)) {
      const identifierText = (node as ts.Identifier).text;
      const vendor = findVendorInWordList(identifierText, context.vendorSet);
      if (vendor !== undefined && vendor !== null) {
        const loc = context.sourceFile.getLineAndCharacterOfPosition(
          node.getStart(context.sourceFile),
        );
        context.violations.push({
          rule: "vendor_leak",
          message: `Prohibited vendor identifier '${vendor}' found in '${identifierText}'.`,
          file: context.fileName,
          line: loc.line + 1,
          column: loc.character + 1,
          snippet: node.getText(context.sourceFile),
          identifier: identifierText,
        });
      }
    }

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const modVendor = findVendorInWordList(node.moduleSpecifier.text, context.vendorSet);
      if (modVendor !== undefined && modVendor !== null) {
        const loc = context.sourceFile.getLineAndCharacterOfPosition(
          node.moduleSpecifier.getStart(context.sourceFile),
        );
        context.violations.push({
          rule: "vendor_leak",
          message: `Prohibited vendor identifier '${modVendor}' found in module import '${node.moduleSpecifier.text}'.`,
          file: context.fileName,
          line: loc.line + 1,
          column: loc.character + 1,
          snippet: node.moduleSpecifier.getText(context.sourceFile),
          identifier: node.moduleSpecifier.text,
        });
      }
    }

    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const modVendor = findVendorInWordList(node.moduleSpecifier.text, context.vendorSet);
      if (modVendor !== undefined && modVendor !== null) {
        const loc = context.sourceFile.getLineAndCharacterOfPosition(
          node.moduleSpecifier.getStart(context.sourceFile),
        );
        context.violations.push({
          rule: "vendor_leak",
          message: `Prohibited vendor identifier '${modVendor}' found in module export '${node.moduleSpecifier.text}'.`,
          file: context.fileName,
          line: loc.line + 1,
          column: loc.character + 1,
          snippet: node.moduleSpecifier.getText(context.sourceFile),
          identifier: node.moduleSpecifier.text,
        });
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length > 0
    ) {
      const firstArg = node.arguments[0];
      if (firstArg !== undefined && ts.isStringLiteral(firstArg)) {
        const reqVendor = findVendorInWordList(firstArg.text, context.vendorSet);
        if (reqVendor !== undefined && reqVendor !== null) {
          const loc = context.sourceFile.getLineAndCharacterOfPosition(
            firstArg.getStart(context.sourceFile),
          );
          context.violations.push({
            rule: "vendor_leak",
            message: `Prohibited vendor identifier '${reqVendor}' found in require call '${firstArg.text}'.`,
            file: context.fileName,
            line: loc.line + 1,
            column: loc.character + 1,
            snippet: firstArg.getText(context.sourceFile),
            identifier: firstArg.text,
          });
        }
      }
    }

    if (
      ts.isStringLiteral(node) &&
      !ts.isImportDeclaration(node.parent) &&
      !ts.isExportDeclaration(node.parent) &&
      !isInsideVendorConfigDefinition(node)
    ) {
      if (
        /\b(gpt-[0-9]|claude-[0-9]|gemini-[0-9]|dall-e-[0-9]|text-davinci|sonnet-[0-9]|opus-[0-9]|haiku-[0-9])\b/iu.test(
          node.text,
        )
      ) {
        const loc = context.sourceFile.getLineAndCharacterOfPosition(
          node.getStart(context.sourceFile),
        );
        context.violations.push({
          rule: "vendor_leak",
          message: `Prohibited vendor model/system string found in literal '${node.text}'.`,
          file: context.fileName,
          line: loc.line + 1,
          column: loc.character + 1,
          snippet: node.getText(context.sourceFile),
          identifier: node.text,
        });
      }
    }
  },
  generateFixSuggestion: () => ({
    suggestedReplacement: "/* Replace vendor-specific identifier with neutral naming */",
    explanation: "Sanitize vendor identifier to maintain host/vendor neutrality.",
  }),
};

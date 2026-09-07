import ts from "typescript";
import type { AstLintRuleModule } from "../../core/index.ts";

interface ModuleMockCall {
  readonly node: ts.CallExpression;
  readonly specifier: string;
}

function findMockImportName(sourceFile: ts.SourceFile): string | undefined {
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.moduleSpecifier.text !== "bun:test") continue;
    const bindings = stmt.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const importedName = (element.propertyName ?? element.name).text;
      if (importedName === "mock") return element.name.text;
    }
  }
  return undefined;
}

function isMockPropertyCall(
  node: ts.Node,
  mockIdentifierName: string,
  propertyName: string,
): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === mockIdentifierName &&
    node.expression.name.text === propertyName
  );
}

function collectModuleMockCalls(root: ts.Node, mockIdentifierName: string): ModuleMockCall[] {
  const calls: ModuleMockCall[] = [];
  function visit(node: ts.Node): void {
    if (isMockPropertyCall(node, mockIdentifierName, "module") && ts.isCallExpression(node)) {
      const firstArg = node.arguments[0];
      if (firstArg && ts.isStringLiteral(firstArg)) {
        calls.push({ node, specifier: firstArg.text });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  return calls;
}

function hasMockRestoreCall(root: ts.Node, mockIdentifierName: string): boolean {
  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    if (isMockPropertyCall(node, mockIdentifierName, "restore")) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}

export const unrestoredGlobalMockRule: AstLintRuleModule = {
  rule: "unrestored_global_mock",
  checkSourceFile: (_sourceCode, context) => {
    const mockIdentifierName = findMockImportName(context.sourceFile);
    if (mockIdentifierName === undefined) return;

    const calls = collectModuleMockCalls(context.sourceFile, mockIdentifierName);
    if (calls.length === 0) return;

    const fileRestoresAllMocks = hasMockRestoreCall(context.sourceFile, mockIdentifierName);

    const specifierOccurrences = new Map<string, number>();
    for (const call of calls) {
      specifierOccurrences.set(call.specifier, (specifierOccurrences.get(call.specifier) ?? 0) + 1);
    }

    for (const call of calls) {
      const specifierIsReestablishedElsewhere = (specifierOccurrences.get(call.specifier) ?? 0) > 1;
      if (fileRestoresAllMocks || specifierIsReestablishedElsewhere) continue;

      const loc = context.sourceFile.getLineAndCharacterOfPosition(
        call.node.getStart(context.sourceFile),
      );
      context.violations.push({
        rule: "unrestored_global_mock",
        message:
          `${mockIdentifierName}.module("${call.specifier}") replaces this module for the rest of ` +
          `the bun test process (Bun has no scoped undo for mock.module). This file never calls ` +
          `${mockIdentifierName}.restore() and never re-establishes "${call.specifier}" with a ` +
          `second ${mockIdentifierName}.module() call, so every later suite in the same run ` +
          `inherits this replacement. Inject the real dependency as a parameter with a real ` +
          `default instead of replacing the module.`,
        file: context.fileName,
        line: loc.line + 1,
        column: loc.character + 1,
        snippet: call.node.getText(context.sourceFile),
      });
    }
  },
  generateFixSuggestion: () => ({
    suggestedReplacement:
      "/* Thread the real dependency through an injectable parameter, not mock.module() */",
    explanation:
      "mock.module() mutates the process-wide module registry with no reliable per-file undo. " +
      "Give the production function a parameter for this dependency with the real implementation " +
      "as its default, then pass a stub explicitly from the test instead of replacing the module.",
  }),
};

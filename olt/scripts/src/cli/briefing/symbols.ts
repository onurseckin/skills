import { extractSymbolsFromGenericSource } from "./generic-symbols.ts";
import type { AnchorSymbol, AnchorSymbolKind } from "./types.ts";
import ts from "typescript";
import {
  isTypeScriptOrJavaScript,
  extractNodeSignature,
  extractNodeTriviaInfo,
  isExportedNode,
  getMemberName,
} from "./ast-symbols.ts";

export function extractSymbolsFromSource(
  sourceCode: string,
  fileName?: string,
): readonly AnchorSymbol[] {
  const effectiveFileName = fileName !== undefined ? fileName : "source.ts";
  if (!isTypeScriptOrJavaScript(effectiveFileName)) {
    return extractSymbolsFromGenericSource(sourceCode, effectiveFileName);
  }

  const isJsx = effectiveFileName.endsWith(".tsx") || effectiveFileName.endsWith(".jsx");
  const scriptKind = isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

  const sourceFile = ts.createSourceFile(
    effectiveFileName,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  const symbols: AnchorSymbol[] = [];

  for (const node of sourceFile.statements) {
    if (ts.isFunctionDeclaration(node)) {
      const name = node.name !== undefined ? node.name.text : "<anonymous>";
      const trivia = extractNodeTriviaInfo(node, sourceFile);
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      symbols.push({
        name,
        kind: "function",
        startLine: trivia.declarationStartLine,
        declarationStartLine: trivia.declarationStartLine,
        enclosingStartLine: trivia.enclosingStartLine,
        endLine,
        signature: extractNodeSignature(node, sourceFile),
        exported: isExportedNode(node),
        docstring: trivia.docstring,
      });
      continue;
    }

    if (ts.isClassDeclaration(node)) {
      const className = node.name !== undefined ? node.name.text : "<anonymous>";
      const trivia = extractNodeTriviaInfo(node, sourceFile);
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      symbols.push({
        name: className,
        kind: "class",
        startLine: trivia.declarationStartLine,
        declarationStartLine: trivia.declarationStartLine,
        enclosingStartLine: trivia.enclosingStartLine,
        endLine,
        signature: extractNodeSignature(node, sourceFile),
        exported: isExportedNode(node),
        docstring: trivia.docstring,
      });

      for (const member of node.members) {
        const isMethod = ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member);
        const isProp = ts.isPropertyDeclaration(member);
        if (isMethod || isProp) {
          const memberName = ts.isConstructorDeclaration(member)
            ? "constructor"
            : getMemberName((member as ts.PropertyDeclaration).name, sourceFile);
          const mTrivia = extractNodeTriviaInfo(member, sourceFile);
          const mEnd = sourceFile.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
          symbols.push({
            name: `${className}.${memberName}`,
            kind: isMethod ? "method" : "property",
            startLine: mTrivia.declarationStartLine,
            declarationStartLine: mTrivia.declarationStartLine,
            enclosingStartLine: mTrivia.enclosingStartLine,
            endLine: mEnd,
            signature: extractNodeSignature(member, sourceFile),
            docstring: mTrivia.docstring,
          });
        }
      }
      continue;
    }

    if (ts.isInterfaceDeclaration(node)) {
      const ifaceName = node.name.text;
      const trivia = extractNodeTriviaInfo(node, sourceFile);
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      symbols.push({
        name: ifaceName,
        kind: "interface",
        startLine: trivia.declarationStartLine,
        declarationStartLine: trivia.declarationStartLine,
        enclosingStartLine: trivia.enclosingStartLine,
        endLine,
        signature: extractNodeSignature(node, sourceFile),
        exported: isExportedNode(node),
        docstring: trivia.docstring,
      });

      for (const member of node.members) {
        const memberName = getMemberName(member.name, sourceFile);
        const mTrivia = extractNodeTriviaInfo(member, sourceFile);
        const mEnd = sourceFile.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
        symbols.push({
          name: `${ifaceName}.${memberName}`,
          kind: ts.isMethodSignature(member) ? "method" : "property",
          startLine: mTrivia.declarationStartLine,
          declarationStartLine: mTrivia.declarationStartLine,
          enclosingStartLine: mTrivia.enclosingStartLine,
          endLine: mEnd,
          signature: extractNodeSignature(member, sourceFile),
          docstring: mTrivia.docstring,
        });
      }
      continue;
    }

    if (ts.isTypeAliasDeclaration(node)) {
      const name = node.name.text;
      const trivia = extractNodeTriviaInfo(node, sourceFile);
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      symbols.push({
        name,
        kind: "type",
        startLine: trivia.declarationStartLine,
        declarationStartLine: trivia.declarationStartLine,
        enclosingStartLine: trivia.enclosingStartLine,
        endLine,
        signature: extractNodeSignature(node, sourceFile),
        exported: isExportedNode(node),
        docstring: trivia.docstring,
      });
      continue;
    }

    if (ts.isEnumDeclaration(node)) {
      const enumName = node.name.text;
      const trivia = extractNodeTriviaInfo(node, sourceFile);
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      symbols.push({
        name: enumName,
        kind: "enum",
        startLine: trivia.declarationStartLine,
        declarationStartLine: trivia.declarationStartLine,
        enclosingStartLine: trivia.enclosingStartLine,
        endLine,
        signature: extractNodeSignature(node, sourceFile),
        exported: isExportedNode(node),
        docstring: trivia.docstring,
      });

      for (const member of node.members) {
        const memberName = member.name.getText(sourceFile);
        const mStart =
          sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1;
        const mEnd = sourceFile.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
        symbols.push({
          name: `${enumName}.${memberName}`,
          kind: "property",
          startLine: mStart,
          declarationStartLine: mStart,
          enclosingStartLine: mStart,
          endLine: mEnd,
          signature: `${enumName}.${memberName}`,
        });
      }
      continue;
    }

    if (ts.isVariableStatement(node)) {
      const exported = isExportedNode(node);
      const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
      const stmtTrivia = extractNodeTriviaInfo(node, sourceFile);

      for (let i = 0; i < node.declarationList.declarations.length; i++) {
        const decl = node.declarationList.declarations[i]!;
        const startLine =
          sourceFile.getLineAndCharacterOfPosition(decl.getStart(sourceFile)).line + 1;
        const endLine = sourceFile.getLineAndCharacterOfPosition(decl.getEnd()).line + 1;
        const enclosingStartLine = i === 0 ? stmtTrivia.enclosingStartLine : startLine;
        const docstring = i === 0 ? stmtTrivia.docstring : undefined;

        if (ts.isIdentifier(decl.name)) {
          const name = decl.name.text;
          const isFn =
            decl.initializer !== undefined &&
            (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer));
          const kind: AnchorSymbolKind = isFn ? "function" : isConst ? "const" : "variable";

          symbols.push({
            name,
            kind,
            startLine,
            declarationStartLine: startLine,
            enclosingStartLine,
            endLine,
            signature: extractNodeSignature(decl, sourceFile),
            exported,
            docstring,
          });
        } else if (ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name)) {
          for (const elem of decl.name.elements) {
            if (ts.isBindingElement(elem) && ts.isIdentifier(elem.name)) {
              const name = elem.name.text;
              const elemStart =
                sourceFile.getLineAndCharacterOfPosition(elem.getStart(sourceFile)).line + 1;
              const elemEnd = sourceFile.getLineAndCharacterOfPosition(elem.getEnd()).line + 1;
              symbols.push({
                name,
                kind: isConst ? "const" : "variable",
                startLine: elemStart,
                declarationStartLine: elemStart,
                enclosingStartLine: i === 0 ? enclosingStartLine : elemStart,
                endLine: elemEnd,
                signature: `${isConst ? "const" : "let"} ${name}`,
                exported,
                docstring: i === 0 ? docstring : undefined,
              });
            }
          }
        }
      }
      continue;
    }

    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        const name = element.name.text;
        const startLine =
          sourceFile.getLineAndCharacterOfPosition(element.getStart(sourceFile)).line + 1;
        const endLine = sourceFile.getLineAndCharacterOfPosition(element.getEnd()).line + 1;
        symbols.push({
          name,
          kind: "other",
          startLine,
          declarationStartLine: startLine,
          enclosingStartLine: startLine,
          endLine,
          signature: `export { ${name} }`,
          exported: true,
        });
      }
    }
  }

  return symbols;
}

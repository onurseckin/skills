import { extractSymbolsFromGenericSource } from "./generic-symbols.ts";
import type { AnchorSymbol, AnchorSymbolKind } from "./types.ts";
import ts from "typescript";
import {
  isTypeScriptOrJavaScript,
  extractNodeSignature,
  extractNodeDocstring,
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

  const isJsx = effectiveFileName.endsWith(".tsx") ? true : effectiveFileName.endsWith(".jsx");
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
    // Function declarations
    if (ts.isFunctionDeclaration(node)) {
      const name = node.name !== undefined ? node.name.text : "<anonymous>";
      const startLine =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const exported = isExportedNode(node);
      symbols.push({
        name,
        kind: "function",
        startLine,
        endLine,
        signature: extractNodeSignature(node, sourceFile),
        exported,
        docstring: extractNodeDocstring(node, sourceFile),
      });
      continue;
    }

    // Class declarations
    if (ts.isClassDeclaration(node)) {
      const className = node.name !== undefined ? node.name.text : "<anonymous>";
      const startLine =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const exported = isExportedNode(node);

      symbols.push({
        name: className,
        kind: "class",
        startLine,
        endLine,
        signature: extractNodeSignature(node, sourceFile),
        exported,
        docstring: extractNodeDocstring(node, sourceFile),
      });

      // Class members
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member)) {
          const memberName = getMemberName(member.name, sourceFile);
          const mStart =
            sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1;
          const mEnd = sourceFile.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
          symbols.push({
            name: `${className}.${memberName}`,
            kind: "method",
            startLine: mStart,
            endLine: mEnd,
            signature: extractNodeSignature(member, sourceFile),
            docstring: extractNodeDocstring(member, sourceFile),
          });
        } else if (ts.isPropertyDeclaration(member)) {
          const propName = getMemberName(member.name, sourceFile);
          const pStart =
            sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1;
          const pEnd = sourceFile.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
          symbols.push({
            name: `${className}.${propName}`,
            kind: "property",
            startLine: pStart,
            endLine: pEnd,
            signature: extractNodeSignature(member, sourceFile),
            docstring: extractNodeDocstring(member, sourceFile),
          });
        } else if (ts.isConstructorDeclaration(member)) {
          const cStart =
            sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1;
          const cEnd = sourceFile.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
          symbols.push({
            name: `${className}.constructor`,
            kind: "method",
            startLine: cStart,
            endLine: cEnd,
            signature: extractNodeSignature(member, sourceFile),
            docstring: extractNodeDocstring(member, sourceFile),
          });
        }
      }
      continue;
    }

    // Interface declarations
    if (ts.isInterfaceDeclaration(node)) {
      const ifaceName = node.name.text;
      const startLine =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const exported = isExportedNode(node);

      symbols.push({
        name: ifaceName,
        kind: "interface",
        startLine,
        endLine,
        signature: extractNodeSignature(node, sourceFile),
        exported,
        docstring: extractNodeDocstring(node, sourceFile),
      });

      for (const member of node.members) {
        if (ts.isMethodSignature(member)) {
          const memberName = getMemberName(member.name, sourceFile);
          const mStart =
            sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1;
          const mEnd = sourceFile.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
          symbols.push({
            name: `${ifaceName}.${memberName}`,
            kind: "method",
            startLine: mStart,
            endLine: mEnd,
            signature: extractNodeSignature(member, sourceFile),
            docstring: extractNodeDocstring(member, sourceFile),
          });
        } else if (ts.isPropertySignature(member)) {
          const propName = getMemberName(member.name, sourceFile);
          const pStart =
            sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1;
          const pEnd = sourceFile.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
          symbols.push({
            name: `${ifaceName}.${propName}`,
            kind: "property",
            startLine: pStart,
            endLine: pEnd,
            signature: extractNodeSignature(member, sourceFile),
            docstring: extractNodeDocstring(member, sourceFile),
          });
        }
      }
      continue;
    }

    // Type alias declarations
    if (ts.isTypeAliasDeclaration(node)) {
      const name = node.name.text;
      const startLine =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const exported = isExportedNode(node);
      symbols.push({
        name,
        kind: "type",
        startLine,
        endLine,
        signature: extractNodeSignature(node, sourceFile),
        exported,
        docstring: extractNodeDocstring(node, sourceFile),
      });
      continue;
    }

    // Enum declarations
    if (ts.isEnumDeclaration(node)) {
      const enumName = node.name.text;
      const startLine =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const exported = isExportedNode(node);

      symbols.push({
        name: enumName,
        kind: "enum",
        startLine,
        endLine,
        signature: extractNodeSignature(node, sourceFile),
        exported,
        docstring: extractNodeDocstring(node, sourceFile),
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
          endLine: mEnd,
          signature: `${enumName}.${memberName}`,
        });
      }
      continue;
    }

    // Variable statements
    if (ts.isVariableStatement(node)) {
      const exported = isExportedNode(node);
      const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;

      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const name = decl.name.text;
          let isFn = false;
          if (decl.initializer !== undefined) {
            if (ts.isArrowFunction(decl.initializer)) {
              isFn = true;
            } else if (ts.isFunctionExpression(decl.initializer)) {
              isFn = true;
            }
          }
          const kind: AnchorSymbolKind = isFn ? "function" : isConst ? "const" : "variable";
          const startLine =
            sourceFile.getLineAndCharacterOfPosition(decl.getStart(sourceFile)).line + 1;
          const endLine = sourceFile.getLineAndCharacterOfPosition(decl.getEnd()).line + 1;

          symbols.push({
            name,
            kind,
            startLine,
            endLine,
            signature: extractNodeSignature(decl, sourceFile),
            exported,
            docstring: extractNodeDocstring(node, sourceFile),
          });
        }
      }
      continue;
    }
    // Export declarations (re-exports)
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) {
          const name = el.name.text;
          const isType = el.isTypeOnly || node.isTypeOnly;
          const startLine =
            sourceFile.getLineAndCharacterOfPosition(el.getStart(sourceFile)).line + 1;
          const endLine = sourceFile.getLineAndCharacterOfPosition(el.getEnd()).line + 1;
          symbols.push({
            name,
            kind: isType ? "type" : "const",
            startLine,
            endLine,
            signature: isType ? `type ${name}` : name,
            exported: true,
          });
        }
      }
      continue;
    }
  }

  return symbols;
}

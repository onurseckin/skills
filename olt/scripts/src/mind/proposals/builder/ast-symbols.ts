import ts from "typescript";

export function isTypeScriptOrJavaScript(filePath: string): boolean {
  return (
    filePath.endsWith(".ts") ||
    filePath.endsWith(".tsx") ||
    filePath.endsWith(".js") ||
    filePath.endsWith(".jsx") ||
    filePath.endsWith(".mjs") ||
    filePath.endsWith(".cjs")
  );
}

export function extractFunctionLikeSignature(node: ts.Node, sourceFile: ts.SourceFile): string {
  const text = node.getText(sourceFile);
  const braceIndex = text.indexOf("{");
  if (braceIndex > 0) {
    return text.substring(0, braceIndex).trim();
  }
  const semiIndex = text.indexOf(";");
  if (semiIndex > 0) {
    return text.substring(0, semiIndex).trim();
  }
  const firstLine = text.split("\n")[0];
  return firstLine !== undefined ? firstLine.trim() : text.trim();
}

export function extractNodeSignature(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  if (ts.isFunctionDeclaration(node)) {
    return extractFunctionLikeSignature(node, sourceFile);
  }
  if (ts.isMethodDeclaration(node)) {
    return extractFunctionLikeSignature(node, sourceFile);
  }
  if (ts.isMethodSignature(node)) {
    return extractFunctionLikeSignature(node, sourceFile);
  }
  if (ts.isConstructorDeclaration(node)) {
    return extractFunctionLikeSignature(node, sourceFile);
  }
  if (ts.isInterfaceDeclaration(node)) {
    const text = node.getText(sourceFile);
    const braceIndex = text.indexOf("{");
    if (braceIndex > 0) {
      return text.substring(0, braceIndex).trim();
    }
    return `interface ${node.name.text}`;
  }
  if (ts.isTypeAliasDeclaration(node)) {
    const text = node.getText(sourceFile);
    const eqIndex = text.indexOf("=");
    if (eqIndex > 0) {
      const typePart = text.substring(eqIndex + 1).trim();
      const firstLine = typePart.split("\n")[0];
      const preview = firstLine !== undefined ? firstLine.trim() : "";
      return `type ${node.name.text} = ${preview.length > 50 ? preview.substring(0, 47) + "..." : preview}`;
    }
    return `type ${node.name.text}`;
  }
  if (ts.isClassDeclaration(node)) {
    const text = node.getText(sourceFile);
    const braceIndex = text.indexOf("{");
    if (braceIndex > 0) {
      return text.substring(0, braceIndex).trim();
    }
    return `class ${node.name !== undefined ? node.name.text : "<anonymous>"}`;
  }
  if (ts.isEnumDeclaration(node)) {
    return `enum ${node.name.text}`;
  }
  if (ts.isVariableDeclaration(node)) {
    const name = ts.isIdentifier(node.name) ? node.name.text : node.name.getText(sourceFile);
    if (node.type !== undefined) {
      return `${name}: ${node.type.getText(sourceFile)}`;
    }
    return name;
  }
  return undefined;
}

export function extractNodeDocstring(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  const fullText = sourceFile.getFullText();
  const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart());
  if (ranges !== undefined && ranges.length > 0) {
    const lastComment = ranges[ranges.length - 1];
    if (lastComment !== undefined && lastComment.kind === ts.SyntaxKind.MultiLineCommentTrivia) {
      const commentText = fullText.substring(lastComment.pos, lastComment.end);
      if (commentText.startsWith("/**")) {
        return commentText
          .replace(/^\/\*\*|\*\/$/g, "")
          .split("\n")
          .map((line: string): string => line.replace(/^\s*\*\s?/, "").trim())
          .filter((line: string): boolean => line.length > 0)
          .join(" ");
      }
    }
  }
  return undefined;
}

export function getMemberName(
  nameNode: ts.PropertyName | undefined,
  sourceFile: ts.SourceFile,
): string {
  if (nameNode === undefined) {
    return "<anonymous>";
  }
  if (ts.isIdentifier(nameNode)) {
    return nameNode.text;
  }
  if (ts.isStringLiteral(nameNode)) {
    return nameNode.text;
  }
  return nameNode.getText(sourceFile);
}

export function isExportedNode(node: ts.Node): boolean {
  if (ts.canHaveModifiers(node)) {
    const modifiers = ts.getModifiers(node);
    if (modifiers !== undefined) {
      for (const m of modifiers) {
        if (m.kind === ts.SyntaxKind.ExportKeyword) {
          return true;
        }
      }
    }
  }
  return false;
}

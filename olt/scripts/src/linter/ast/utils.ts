import ts from "typescript";
import { AstLintRule } from "./types.ts";

export function isJsxFile(fileName: string): boolean {
  if (fileName.endsWith(".tsx")) {
    return true;
  }
  if (fileName.endsWith(".jsx")) {
    return true;
  }
  return false;
}

export function isJsFile(fileName: string): boolean {
  if (fileName.endsWith(".js")) {
    return true;
  }
  if (fileName.endsWith(".mjs")) {
    return true;
  }
  if (fileName.endsWith(".cjs")) {
    return true;
  }
  return false;
}

export function isCommentToken(token: ts.SyntaxKind): boolean {
  if (token === ts.SyntaxKind.SingleLineCommentTrivia) {
    return true;
  }
  if (token === ts.SyntaxKind.MultiLineCommentTrivia) {
    return true;
  }
  return false;
}

export function isIdentifierNode(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) {
    return true;
  }
  if (ts.isPrivateIdentifier(node)) {
    return true;
  }
  return false;
}

export function matchesExcludePattern(name: string, fullPath: string, pattern: string): boolean {
  if (name === pattern) {
    return true;
  }
  if (fullPath.includes(pattern)) {
    return true;
  }
  return false;
}

export function isAccessOrCall(expr: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(expr)) {
    return true;
  }
  if (ts.isCallExpression(expr)) {
    return true;
  }
  return false;
}

export function extractIdentifierWords(identifier: string): readonly string[] {
  if (typeof identifier !== "string") {
    return [];
  }
  if (identifier.length === 0) {
    return [];
  }
  return identifier
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/u)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

export function createEmptyRuleSummary(): Record<AstLintRule, number> {
  return {
    nullish_coalescing: 0,
    logical_or_fallback: 0,
    any_type: 0,
    non_null_assertion: 0,
    vendor_leak: 0,
    compiler_suppression: 0,
    mock_tautology: 0,
    trivial_assertion: 0,
    empty_test_body: 0,
    trivial_early_return: 0,
  };
}

export function findVendorInWordList(
  identifier: string,
  vendorSet: ReadonlySet<string>,
): string | undefined {
  const words = extractIdentifierWords(identifier);
  for (const word of words) {
    if (vendorSet.has(word)) {
      return word;
    }
  }
  const concatenated = words.join("");
  const lower = identifier.toLowerCase();
  for (const vendor of vendorSet) {
    if (concatenated.includes(vendor)) {
      return vendor;
    }
    if (lower.includes(vendor)) {
      return vendor;
    }
  }
  return undefined;
}

export function isInsideVendorConfigDefinition(node: ts.Node): boolean {
  let parent: ts.Node | undefined = node.parent;
  while (parent !== undefined) {
    if (ts.isVariableDeclaration(parent)) {
      if (ts.isIdentifier(parent.name)) {
        const textUpper = parent.name.text.toUpperCase();
        if (textUpper.includes("VENDOR")) {
          return true;
        }
      }
    }
    parent = parent.parent;
  }
  return false;
}

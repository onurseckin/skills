import ts from "typescript";
import {
  ENGINE_RESULT_TYPE,
  type ArgumentShape,
  type EngineDeclaration,
  type EngineInvocation,
  type ObjectArgumentProperty,
  type SourceDocument,
} from "./engine-wiring-contracts.ts";

export function parseDocument(document: SourceDocument): ts.SourceFile {
  return ts.createSourceFile(document.path, document.text, ts.ScriptTarget.Latest, true);
}

export function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function normalizeReturnType(text: string): string {
  const collapsed = text.replace(/\s+/gu, "");
  const promise = /^Promise<(.+)>$/u.exec(collapsed);
  return promise?.[1] ?? collapsed;
}

function returnsEngineResult(
  node: ts.SignatureDeclarationBase,
  sourceFile: ts.SourceFile,
): boolean {
  if (node.type === undefined) return false;
  return normalizeReturnType(node.type.getText(sourceFile)) === ENGINE_RESULT_TYPE;
}

function hasExportModifier(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

function isEmptyObjectDefault(parameter: ts.ParameterDeclaration | undefined): boolean {
  const initializer = parameter?.initializer;
  if (initializer === undefined) return false;
  if (!ts.isObjectLiteralExpression(initializer)) return false;
  return initializer.properties.length === 0;
}

function toDeclaration(
  name: string,
  signature: ts.SignatureDeclarationBase,
  sourceFile: ts.SourceFile,
  document: SourceDocument,
): EngineDeclaration {
  return {
    name,
    path: document.path,
    line: lineOf(sourceFile, signature),
    parameterCount: signature.parameters.length,
    emptyObjectDefault: isEmptyObjectDefault(signature.parameters[0]),
  };
}

export function collectEngineDeclarations(
  documents: readonly SourceDocument[],
): readonly EngineDeclaration[] {
  const declarations: EngineDeclaration[] = [];
  for (const document of documents) {
    if (!document.text.includes(ENGINE_RESULT_TYPE)) continue;
    const sourceFile = parseDocument(document);
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name !== undefined && hasExportModifier(node)) {
        if (returnsEngineResult(node, sourceFile)) {
          declarations.push(toDeclaration(node.name.text, node, sourceFile, document));
        }
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const initializer = node.initializer;
        const isFunctionLike =
          initializer !== undefined &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
        if (
          isFunctionLike &&
          hasExportModifier(node) &&
          returnsEngineResult(initializer, sourceFile)
        ) {
          declarations.push(toDeclaration(node.name.text, initializer, sourceFile, document));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return declarations.sort((left, right) => left.name.localeCompare(right.name));
}

export function isEmptyLiteral(expression: ts.Expression): boolean {
  if (ts.isArrayLiteralExpression(expression)) return expression.elements.length === 0;
  if (ts.isObjectLiteralExpression(expression)) return expression.properties.length === 0;
  return ts.isIdentifier(expression) && expression.text === "undefined";
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name)) return name.text;
  return undefined;
}

export function describeArgument(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): ArgumentShape {
  const text = expression.getText(sourceFile).replace(/\s+/gu, " ");
  if (ts.isIdentifier(expression) && expression.text === "undefined") return { kind: "undefined" };
  if (!ts.isObjectLiteralExpression(expression)) return { kind: "opaque", text };
  const properties: ObjectArgumentProperty[] = [];
  for (const property of expression.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      properties.push({
        name: property.name.text,
        emptyLiteral: false,
        valueText: property.name.text,
      });
      continue;
    }
    if (!ts.isPropertyAssignment(property)) return { kind: "opaque", text };
    const name = propertyName(property.name);
    if (name === undefined) return { kind: "opaque", text };
    properties.push({
      name,
      emptyLiteral: isEmptyLiteral(property.initializer),
      valueText: property.initializer.getText(sourceFile).replace(/\s+/gu, " "),
    });
  }
  return { kind: "object", properties };
}

function enclosingFunctionName(node: ts.Node): string | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isFunctionDeclaration(current) && current.name !== undefined) return current.name.text;
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name))
      return current.name.text;
    current = current.parent;
  }
  return undefined;
}

export function collectEngineInvocations(
  documents: readonly SourceDocument[],
  engineNames: readonly string[],
): readonly EngineInvocation[] {
  const wanted = new Set(engineNames);
  const invocations: EngineInvocation[] = [];
  for (const document of documents) {
    if (!engineNames.some((name) => document.text.includes(name))) continue;
    const sourceFile = parseDocument(document);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (wanted.has(name) && enclosingFunctionName(node) !== name) {
          invocations.push({
            name,
            path: document.path,
            line: lineOf(sourceFile, node),
            argumentCount: node.arguments.length,
            argumentShapes: node.arguments.map((argument) =>
              describeArgument(argument, sourceFile),
            ),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return invocations;
}

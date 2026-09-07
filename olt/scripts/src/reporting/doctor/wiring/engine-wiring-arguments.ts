import ts from "typescript";
import type {
  ArgumentShape,
  EngineInvocation,
  InvocationVoidness,
  OptionReadSet,
  SourceDocument,
} from "./engine-wiring-contracts.ts";
import { parseDocument } from "./engine-wiring-inventory.ts";
import { collectLocalFunctions } from "./engine-wiring-inertness.ts";

function undecidable(reason: string): OptionReadSet {
  return { decidable: false, names: new Set<string>(), reason };
}

function propertyReadName(node: ts.Identifier): string | undefined {
  const parent = node.parent as ts.Node | undefined;
  if (parent === undefined) return undefined;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
    return ts.isIdentifier(parent.name) ? parent.name.text : undefined;
  }
  if (ts.isElementAccessExpression(parent) && parent.expression === node) {
    const key = parent.argumentExpression;
    return ts.isStringLiteralLike(key) ? key.text : undefined;
  }
  return undefined;
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent as ts.Node | undefined;
  if (parent === undefined) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isQualifiedName(parent) && parent.right === node) return true;
  return false;
}

function bindsName(node: ts.Identifier): boolean {
  const parent = node.parent as ts.Node | undefined;
  if (parent === undefined) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true;
  if (ts.isParameter(parent) && parent.name === node) return true;
  if (ts.isBindingElement(parent) && parent.name === node) return true;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return true;
  if (ts.isClassDeclaration(parent) && parent.name === node) return true;
  return false;
}

function readSetFromBindingPattern(pattern: ts.ObjectBindingPattern): OptionReadSet {
  const names = new Set<string>();
  for (const element of pattern.elements) {
    if (element.dotDotDotToken !== undefined) {
      return undecidable("the options parameter is captured whole by a rest element");
    }
    const key = element.propertyName;
    if (key === undefined) {
      if (!ts.isIdentifier(element.name)) {
        return undecidable("the options parameter is destructured into a nested pattern");
      }
      names.add(element.name.text);
      continue;
    }
    if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) {
      names.add(key.text);
      continue;
    }
    return undecidable("the options parameter is destructured through a computed key");
  }
  return { decidable: true, names, reason: "the options parameter is fully destructured" };
}

function readSetFromIdentifier(
  parameterName: string,
  body: ts.Node,
  sourceFile: ts.SourceFile,
): OptionReadSet {
  const names = new Set<string>();
  let failure: string | undefined;
  const visit = (node: ts.Node): void => {
    if (failure !== undefined) return;
    if (ts.isIdentifier(node) && node.text === parameterName && !isDeclarationName(node)) {
      if (bindsName(node)) {
        failure = `'${parameterName}' is rebound inside the engine body`;
        return;
      }
      const read = propertyReadName(node);
      if (read === undefined) {
        const parent = node.parent as ts.Node | undefined;
        const context = parent === undefined ? parameterName : parent.getText(sourceFile);
        failure = `'${parameterName}' is used as a whole value in \`${context.replace(/\s+/gu, " ").slice(0, 60)}\``;
        return;
      }
      names.add(read);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  if (failure !== undefined) return undecidable(failure);
  return {
    decidable: true,
    names,
    reason: `every reference to '${parameterName}' is a direct property read`,
  };
}

export function collectOptionReadSet(document: SourceDocument, engineName: string): OptionReadSet {
  const sourceFile = parseDocument(document);
  const signature = collectLocalFunctions(sourceFile).get(engineName);
  if (signature === undefined) return undecidable(`declaration for ${engineName} was not found`);
  const parameter = signature.parameters[0];
  const body = signature.body;
  if (parameter === undefined || body === undefined) {
    return undecidable(`${engineName} has no inspectable options parameter`);
  }
  if (ts.isObjectBindingPattern(parameter.name)) {
    return readSetFromBindingPattern(parameter.name);
  }
  if (!ts.isIdentifier(parameter.name)) {
    return undecidable("the options parameter is not a plain binding");
  }
  return readSetFromIdentifier(parameter.name.text, body, sourceFile);
}

export function classifyArgumentVoidness(
  shape: ArgumentShape,
  readSet: OptionReadSet,
): InvocationVoidness {
  if (shape.kind === "undefined") {
    return { voided: true, reason: "passes an explicitly undefined argument" };
  }
  if (shape.kind === "opaque") {
    return { voided: false, reason: `passes the runtime expression \`${shape.text}\`` };
  }
  if (shape.properties.length === 0) {
    return { voided: true, reason: "passes an empty object literal argument" };
  }
  const reasons: string[] = [];
  for (const property of shape.properties) {
    if (property.emptyLiteral) {
      reasons.push(`empty literal argument '${property.name}: ${property.valueText}'`);
      continue;
    }
    if (readSet.decidable && !readSet.names.has(property.name)) {
      reasons.push(`argument '${property.name}' passed but never read in the engine body`);
      continue;
    }
    return { voided: false, reason: `passes an observable '${property.name}'` };
  }
  return { voided: true, reason: `passes only inert properties: ${reasons.join(", ")}` };
}

export function classifyInvocationVoidness(
  invocation: EngineInvocation,
  readSet: OptionReadSet,
): InvocationVoidness {
  if (invocation.argumentShapes.length === 0) {
    return { voided: true, reason: "passes zero arguments" };
  }
  const reasons: string[] = [];
  for (const shape of invocation.argumentShapes) {
    const verdict = classifyArgumentVoidness(shape, readSet);
    if (!verdict.voided) return verdict;
    reasons.push(verdict.reason);
  }
  return { voided: true, reason: reasons.join(" and ") };
}

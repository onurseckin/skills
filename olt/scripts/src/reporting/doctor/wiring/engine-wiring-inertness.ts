import ts from "typescript";
import { parseDocument } from "./engine-wiring-inventory.ts";
import type { SourceDocument } from "./engine-wiring-contracts.ts";

const PURE_GLOBALS = new Set([
  "Array",
  "BigInt",
  "Boolean",
  "Error",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Promise",
  "RangeError",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "TypeError",
  "WeakMap",
  "WeakSet",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "structuredClone",
]);

const ACQUISITION_GLOBALS = new Set([
  "Date",
  "Intl",
  "fetch",
  "globalThis",
  "performance",
  "process",
  "require",
]);

export interface InertnessVerdict {
  readonly inert: boolean;
  readonly reason: string;
}

interface ModuleFacts {
  readonly sourceFile: ts.SourceFile;
  readonly externals: ReadonlySet<string>;
  readonly locals: ReadonlyMap<string, ts.FunctionLikeDeclaration>;
}

function identifiersIn(node: ts.Node): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (current: ts.Node): void => {
    if (ts.isIdentifier(current)) {
      names.add(current.text);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return names;
}

function referencesAny(node: ts.Node, names: ReadonlySet<string>): boolean {
  for (const identifier of identifiersIn(node)) {
    if (names.has(identifier)) return true;
  }
  return false;
}

function bindingNames(name: ts.BindingName): readonly string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return [...identifiersIn(name)];
}

function collectImportedBindings(sourceFile: ts.SourceFile): Set<string> {
  const externals = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly) continue;
    if (clause.name !== undefined) {
      externals.add(clause.name.text);
    }
    const bindings = clause.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      externals.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if (!element.isTypeOnly) {
        externals.add(element.name.text);
      }
    }
  }
  return externals;
}

function collectExternals(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const externals = collectImportedBindings(sourceFile);
  for (let pass = 0; pass < 3; pass += 1) {
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const initializer = declaration.initializer;
        if (initializer === undefined) continue;
        if (referencesAny(initializer, externals)) {
          externals.add(declaration.name.text);
        }
      }
    }
  }
  return externals;
}

function collectLocalFunctions(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, ts.FunctionLikeDeclaration> {
  const locals = new Map<string, ts.FunctionLikeDeclaration>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      locals.set(node.name.text, node);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const initializer = node.initializer;
      if (
        initializer !== undefined &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      ) {
        locals.set(node.name.text, initializer);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return locals;
}

function computeTaint(body: ts.Node, seed: readonly string[]): Set<string> {
  const tainted = new Set(seed);
  for (let pass = 0; pass < 4; pass += 1) {
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
        if (referencesAny(node.initializer, tainted)) {
          for (const name of bindingNames(node.name)) tainted.add(name);
        }
      }
      if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
        if (referencesAny(node.expression, tainted)) {
          for (const name of identifiersIn(node.initializer)) tainted.add(name);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
  }
  return tainted;
}

function calleeRoot(expression: ts.Expression): string | undefined {
  let current: ts.Expression = expression;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current.text : undefined;
}

function isRandomAccess(expression: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "Math" &&
    expression.name.text === "random"
  );
}

function seedForCall(
  local: ts.FunctionLikeDeclaration,
  args: readonly ts.Expression[],
  tainted: ReadonlySet<string>,
): readonly string[] {
  const seed: string[] = [];
  local.parameters.forEach((parameter, index) => {
    const argument = args[index];
    if (argument !== undefined && referencesAny(argument, tainted)) {
      seed.push(...bindingNames(parameter.name));
    }
  });
  return seed;
}

function findAcquisition(
  signature: ts.FunctionLikeDeclaration,
  facts: ModuleFacts,
  seed: readonly string[],
  stack: ReadonlySet<string>,
): string | undefined {
  const body = signature.body;
  if (body === undefined) return undefined;
  const tainted = computeTaint(body, seed);
  let acquisition: string | undefined;

  const inspect = (node: ts.CallExpression | ts.NewExpression): void => {
    const root = calleeRoot(node.expression);
    if (root === undefined || tainted.has(root)) return;
    const args = node.arguments === undefined ? [] : [...node.arguments];
    const text = node.expression.getText(facts.sourceFile);
    if (isRandomAccess(node.expression) || ACQUISITION_GLOBALS.has(root)) {
      acquisition = `${text} reads ambient state`;
      return;
    }
    const taintedArgument = args.some((argument) => referencesAny(argument, tainted));
    if (facts.externals.has(root)) {
      if (!taintedArgument) {
        acquisition = `${text} calls imported binding '${root}' with no options-derived argument`;
      }
      return;
    }
    if (PURE_GLOBALS.has(root) || stack.has(root)) return;
    const local = facts.locals.get(root);
    if (local === undefined) return;
    const nested = findAcquisition(
      local,
      facts,
      seedForCall(local, args, tainted),
      new Set([...stack, root]),
    );
    if (nested !== undefined) acquisition = `${root}() -> ${nested}`;
  };

  const visit = (node: ts.Node): void => {
    if (acquisition !== undefined) return;
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) inspect(node);
    ts.forEachChild(node, visit);
  };
  visit(body);
  return acquisition;
}

export function analyzeInertness(document: SourceDocument, engineName: string): InertnessVerdict {
  const sourceFile = parseDocument(document);
  const locals = collectLocalFunctions(sourceFile);
  const signature = locals.get(engineName);
  if (signature === undefined) {
    return { inert: false, reason: `declaration for ${engineName} was not found` };
  }
  const facts: ModuleFacts = {
    sourceFile,
    externals: collectExternals(sourceFile),
    locals,
  };
  const seed = signature.parameters.flatMap((parameter) => bindingNames(parameter.name));
  const acquisition = findAcquisition(signature, facts, seed, new Set([engineName]));
  if (acquisition !== undefined) {
    return { inert: false, reason: `acquires its own input: ${acquisition}` };
  }
  return {
    inert: true,
    reason: "closed computation over an empty options object; no branch can observe a defect",
  };
}

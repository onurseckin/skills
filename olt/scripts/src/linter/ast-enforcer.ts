import ts from "typescript";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../core/errors/harness-error.ts";
import { isRecord } from "../requirements/predicates.ts";

export type AstLintRule =
  | "nullish_coalescing"
  | "logical_or_fallback"
  | "any_type"
  | "non_null_assertion"
  | "vendor_leak"
  | "compiler_suppression"
  | "mock_tautology"
  | "trivial_assertion"
  | "empty_test_body"
  | "trivial_early_return";

export const ALL_AST_LINT_RULES: readonly AstLintRule[] = [
  "nullish_coalescing",
  "logical_or_fallback",
  "any_type",
  "non_null_assertion",
  "vendor_leak",
  "compiler_suppression",
  "mock_tautology",
  "trivial_assertion",
  "empty_test_body",
  "trivial_early_return",
] as const;

export const DEFAULT_PROHIBITED_VENDORS: readonly string[] = [
  "anthropic",
  "openai",
  "gemini",
  "claude",
  "chatgpt",
  "gpt-4",
  "gpt-3",
  "sonnet",
  "haiku",
  "opus",
  "dall-e",
  "llama",
  "deepseek",
  "mistral",
  "qwen",
  "cohere",
] as const;

export const DEFAULT_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

export const COMPILER_SUPPRESSION_DIRECTIVES: readonly string[] = [
  "@ts-ignore",
  "@ts-nocheck",
  "@ts-expect-error",
  "@ts-check",
  "eslint-disable",
  "eslint-disable-line",
  "eslint-disable-next-line",
] as const;

const TEST_IDENTIFIERS = new Set(["test", "it"]);
const MOCK_FACTORIES = new Set([
  "fn",
  "mock",
  "spyOn",
  "mockReturnValue",
  "mockResolvedValue",
  "mockImplementation",
]);
const MOCK_RETURN_PROPS = new Set(["mockReturnValue", "mockResolvedValue"]);
const MOCK_FRAMEWORK_NAMES = new Set(["mock", "vi", "jest"]);
const ASSERTION_NAMES = new Set(["expect", "assert", "t"]);
const EQUALITY_MATCHERS = new Set(["toBe", "toEqual", "toStrictEqual", "toBeStrictEqual"]);

const LITERAL_SYNTAX_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.ArrayLiteralExpression,
  ts.SyntaxKind.ObjectLiteralExpression,
]);

export interface AstLintViolation {
  readonly rule: AstLintRule;
  readonly message: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly snippet: string;
  readonly identifier?: string | undefined;
  readonly testName?: string | undefined;
}

export interface AstLintResult {
  readonly valid: boolean;
  readonly passed: boolean;
  readonly filePath: string;
  readonly violations: readonly AstLintViolation[];
  readonly totalViolations: number;
  readonly summaryByRule: Readonly<Record<AstLintRule, number>>;
}

export interface DirectoryLintResult {
  readonly valid: boolean;
  readonly passed: boolean;
  readonly directoryPath: string;
  readonly totalFiles: number;
  readonly cleanFiles: number;
  readonly failedFiles: number;
  readonly totalViolations: number;
  readonly fileResults: readonly AstLintResult[];
  readonly summaryByRule: Readonly<Record<AstLintRule, number>>;
}

export interface AstLintOptions {
  readonly enabledRules?: readonly AstLintRule[] | undefined;
  readonly disabledRules?: readonly AstLintRule[] | undefined;
  readonly vendorNames?: readonly string[] | undefined;
  readonly includeExtensions?: readonly string[] | undefined;
  readonly excludePatterns?: readonly string[] | undefined;
  readonly maxDepth?: number | undefined;
}

export interface FixSuggestion {
  readonly rule: AstLintRule;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly originalSnippet: string;
  readonly suggestedReplacement: string;
  readonly explanation: string;
}

export interface AutoFixResult {
  readonly originalCode: string;
  readonly fixedCode: string;
  readonly appliedFixesCount: number;
  readonly fixedViolations: readonly FixSuggestion[];
  readonly remainingResult: AstLintResult;
}

function isJsxFile(fileName: string): boolean {
  if (fileName.endsWith(".tsx")) {
    return true;
  }
  if (fileName.endsWith(".jsx")) {
    return true;
  }
  return false;
}

function isJsFile(fileName: string): boolean {
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

function isCommentToken(token: ts.SyntaxKind): boolean {
  if (token === ts.SyntaxKind.SingleLineCommentTrivia) {
    return true;
  }
  if (token === ts.SyntaxKind.MultiLineCommentTrivia) {
    return true;
  }
  return false;
}

function isIdentifierNode(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) {
    return true;
  }
  if (ts.isPrivateIdentifier(node)) {
    return true;
  }
  return false;
}

function matchesExcludePattern(name: string, fullPath: string, pattern: string): boolean {
  if (name === pattern) {
    return true;
  }
  if (fullPath.includes(pattern)) {
    return true;
  }
  return false;
}

function isAccessOrCall(expr: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(expr)) {
    return true;
  }
  if (ts.isCallExpression(expr)) {
    return true;
  }
  return false;
}

export function isAstLintViolation(value: unknown): value is AstLintViolation {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.rule !== "string") {
    return false;
  }
  if (!ALL_AST_LINT_RULES.includes(value.rule as AstLintRule)) {
    return false;
  }
  if (typeof value.message !== "string") {
    return false;
  }
  if (typeof value.file !== "string") {
    return false;
  }
  if (typeof value.line !== "number") {
    return false;
  }
  if (typeof value.column !== "number") {
    return false;
  }
  if (typeof value.snippet !== "string") {
    return false;
  }
  return true;
}

export function isAstLintResult(value: unknown): value is AstLintResult {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.valid !== "boolean") {
    return false;
  }
  if (typeof value.passed !== "boolean") {
    return false;
  }
  if (typeof value.filePath !== "string") {
    return false;
  }
  if (!Array.isArray(value.violations)) {
    return false;
  }
  if (typeof value.totalViolations !== "number") {
    return false;
  }
  if (!isRecord(value.summaryByRule)) {
    return false;
  }
  return true;
}

export function isDirectoryLintResult(value: unknown): value is DirectoryLintResult {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.valid !== "boolean") {
    return false;
  }
  if (typeof value.passed !== "boolean") {
    return false;
  }
  if (typeof value.directoryPath !== "string") {
    return false;
  }
  if (typeof value.totalFiles !== "number") {
    return false;
  }
  if (typeof value.cleanFiles !== "number") {
    return false;
  }
  if (typeof value.failedFiles !== "number") {
    return false;
  }
  if (typeof value.totalViolations !== "number") {
    return false;
  }
  if (!Array.isArray(value.fileResults)) {
    return false;
  }
  if (!isRecord(value.summaryByRule)) {
    return false;
  }
  return true;
}

export function isFixSuggestion(value: unknown): value is FixSuggestion {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.rule !== "string") {
    return false;
  }
  if (!ALL_AST_LINT_RULES.includes(value.rule as AstLintRule)) {
    return false;
  }
  if (typeof value.file !== "string") {
    return false;
  }
  if (typeof value.line !== "number") {
    return false;
  }
  if (typeof value.column !== "number") {
    return false;
  }
  if (typeof value.originalSnippet !== "string") {
    return false;
  }
  if (typeof value.suggestedReplacement !== "string") {
    return false;
  }
  if (typeof value.explanation !== "string") {
    return false;
  }
  return true;
}

export function isAutoFixResult(value: unknown): value is AutoFixResult {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.originalCode !== "string") {
    return false;
  }
  if (typeof value.fixedCode !== "string") {
    return false;
  }
  if (typeof value.appliedFixesCount !== "number") {
    return false;
  }
  if (!Array.isArray(value.fixedViolations)) {
    return false;
  }
  if (!isAstLintResult(value.remainingResult)) {
    return false;
  }
  return true;
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

function createEmptyRuleSummary(): Record<AstLintRule, number> {
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

function findVendorInWordList(
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

function isInsideVendorConfigDefinition(node: ts.Node): boolean {
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

function scanCompilerSuppressions(
  sourceCode: string,
  sourceFile: ts.SourceFile,
  fileName: string,
): readonly AstLintViolation[] {
  const violations: AstLintViolation[] = [];
  const isJsx = isJsxFile(fileName);
  let languageVariant = ts.LanguageVariant.Standard;
  if (isJsx) {
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
          const loc = sourceFile.getLineAndCharacterOfPosition(commentPos);
          violations.push({
            rule: "compiler_suppression",
            message: `Prohibited compiler suppression directive '${suppression}' detected.`,
            file: fileName,
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

  return violations;
}

interface TestCallInfo {
  readonly node: ts.CallExpression;
  readonly testName: string;
  readonly callback: ts.FunctionLikeDeclaration;
}

function isTestIdentifier(name: string): boolean {
  return TEST_IDENTIFIERS.has(name);
}

function extractTestName(args: ts.NodeArray<ts.Expression>): string {
  for (const arg of args) {
    if (ts.isStringLiteral(arg)) {
      return arg.text;
    }
    if (ts.isNoSubstitutionTemplateLiteral(arg)) {
      return arg.text;
    }
    if (ts.isTemplateExpression(arg)) {
      return arg.getText();
    }
  }
  return "<anonymous test>";
}

function findCallback(args: ts.NodeArray<ts.Expression>): ts.FunctionLikeDeclaration | undefined {
  for (const arg of args) {
    if (ts.isArrowFunction(arg)) {
      return arg;
    }
    if (ts.isFunctionExpression(arg)) {
      return arg;
    }
  }
  return undefined;
}

function isTestPropertyTarget(obj: ts.Expression, prop: string): boolean {
  if (ts.isIdentifier(obj)) {
    if (isTestIdentifier(obj.text)) {
      return true;
    }
    if (obj.text === "describe" && isTestIdentifier(prop)) {
      return true;
    }
  }
  if (ts.isPropertyAccessExpression(obj)) {
    if (ts.isIdentifier(obj.name)) {
      if (isTestIdentifier(obj.name.text)) {
        return true;
      }
    }
  }
  return false;
}

function identifyTestCall(node: ts.CallExpression): TestCallInfo | undefined {
  const expr = node.expression;

  if (ts.isIdentifier(expr) && isTestIdentifier(expr.text)) {
    const callback = findCallback(node.arguments);
    if (callback !== undefined) {
      return { node, testName: extractTestName(node.arguments), callback };
    }
  }

  if (ts.isPropertyAccessExpression(expr)) {
    const obj = expr.expression;
    const prop = expr.name.text;
    if (isTestPropertyTarget(obj, prop)) {
      const callback = findCallback(node.arguments);
      if (callback !== undefined) {
        return { node, testName: extractTestName(node.arguments), callback };
      }
    }
  }

  if (ts.isCallExpression(expr)) {
    const innerExpr = expr.expression;
    if (
      ts.isPropertyAccessExpression(innerExpr) &&
      ts.isIdentifier(innerExpr.expression) &&
      isTestIdentifier(innerExpr.expression.text) &&
      innerExpr.name.text === "each"
    ) {
      const callback = findCallback(node.arguments);
      if (callback !== undefined) {
        return { node, testName: extractTestName(node.arguments), callback };
      }
    }
  }

  return undefined;
}

function isLiteralOrConstant(node: ts.Node): boolean {
  if (LITERAL_SYNTAX_KINDS.has(node.kind)) {
    return true;
  }
  if (ts.isIdentifier(node)) {
    if (node.text === "undefined") {
      return true;
    }
    if (node.text === "NaN") {
      return true;
    }
  }
  if (ts.isPrefixUnaryExpression(node)) {
    if (ts.isNumericLiteral(node.operand)) {
      return true;
    }
  }
  return false;
}

function isAssertionCall(call: ts.CallExpression): boolean {
  const expr = call.expression;
  if (ts.isIdentifier(expr)) {
    if (ASSERTION_NAMES.has(expr.text)) {
      return true;
    }
  }
  let curr: ts.Expression = expr;
  while (isAccessOrCall(curr)) {
    if (ts.isPropertyAccessExpression(curr)) {
      if (ts.isIdentifier(curr.expression)) {
        if (ASSERTION_NAMES.has(curr.expression.text)) {
          return true;
        }
      }
      curr = curr.expression;
    } else if (ts.isCallExpression(curr)) {
      if (ts.isIdentifier(curr.expression)) {
        if (ASSERTION_NAMES.has(curr.expression.text)) {
          return true;
        }
      }
      curr = curr.expression;
    } else {
      break;
    }
  }
  return false;
}

function getRootExpectArg(node: ts.CallExpression): ts.Expression | undefined {
  if (ts.isIdentifier(node.expression)) {
    if (node.expression.text === "expect") {
      return node.arguments[0];
    }
  }
  let curr: ts.Expression = node.expression;
  while (isAccessOrCall(curr)) {
    if (ts.isCallExpression(curr)) {
      if (ts.isIdentifier(curr.expression)) {
        if (curr.expression.text === "expect") {
          return curr.arguments[0];
        }
      }
      curr = curr.expression;
    } else if (ts.isPropertyAccessExpression(curr)) {
      curr = curr.expression;
    } else {
      break;
    }
  }
  return undefined;
}

interface MockInfo {
  readonly varName: string;
  readonly stubbedReturnValue?: string | undefined;
  readonly isMockObject?: boolean | undefined;
}

function detectMockDeclarations(
  callback: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
): MockInfo[] {
  const mocks: MockInfo[] = [];

  function checkInitializer(init: ts.Expression): {
    isMock: boolean;
    stubbedValue?: string | undefined;
  } {
    if (ts.isCallExpression(init)) {
      let curr: ts.Expression = init;
      let stubbedValue: string | undefined = undefined;

      while (isAccessOrCall(curr)) {
        if (ts.isCallExpression(curr)) {
          if (ts.isPropertyAccessExpression(curr.expression)) {
            const propName = curr.expression.name.text;
            if (MOCK_RETURN_PROPS.has(propName)) {
              const valArg = curr.arguments[0];
              if (valArg !== undefined) {
                stubbedValue = valArg.getText(sourceFile);
              }
            }
            if (MOCK_FACTORIES.has(propName)) {
              return { isMock: true, stubbedValue };
            }
            curr = curr.expression.expression;
          } else if (ts.isIdentifier(curr.expression)) {
            if (MOCK_FRAMEWORK_NAMES.has(curr.expression.text)) {
              const firstArg = curr.arguments[0];
              if (firstArg !== undefined) {
                const isFn = ts.isArrowFunction(firstArg)
                  ? true
                  : ts.isFunctionExpression(firstArg);
                if (isFn) {
                  const fnNode = firstArg as ts.ArrowFunction | ts.FunctionExpression;
                  if (fnNode.body && !ts.isBlock(fnNode.body)) {
                    stubbedValue = fnNode.body.getText(sourceFile);
                  }
                }
              }
              return { isMock: true, stubbedValue };
            }
            break;
          } else {
            break;
          }
        } else if (ts.isPropertyAccessExpression(curr)) {
          if (ts.isIdentifier(curr.expression)) {
            if (MOCK_FRAMEWORK_NAMES.has(curr.expression.text)) {
              if (MOCK_FACTORIES.has(curr.name.text)) {
                return { isMock: true, stubbedValue };
              }
            }
          }
          curr = curr.expression;
        } else {
          break;
        }
      }
    }
    return { isMock: false };
  }

  function walk(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initRes = checkInitializer(node.initializer);
      if (initRes.isMock) {
        mocks.push({ varName: node.name.text, stubbedReturnValue: initRes.stubbedValue });
      } else if (ts.isObjectLiteralExpression(node.initializer)) {
        let hasMockProp = false;
        for (const prop of node.initializer.properties) {
          if (ts.isPropertyAssignment(prop) && prop.initializer) {
            const propRes = checkInitializer(prop.initializer);
            if (propRes.isMock) {
              hasMockProp = true;
              break;
            }
          }
        }
        if (hasMockProp) {
          mocks.push({ varName: node.name.text, isMockObject: true });
        }
      }
    }
    ts.forEachChild(node, walk);
  }

  if (callback.body && ts.isBlock(callback.body)) {
    for (const stmt of callback.body.statements) {
      walk(stmt);
    }
  }

  return mocks;
}

function matchesMockTarget(rootText: string, name: string): boolean {
  if (rootText === name) {
    return true;
  }
  if (rootText.startsWith(`${name}.`)) {
    return true;
  }
  if (rootText.startsWith(`${name}(`)) {
    return true;
  }
  return false;
}

function isTrivialLiteralMatch(methodName: string, rootArg: ts.Expression): boolean {
  if (methodName === "toBeTruthy" && rootArg.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (methodName === "toBeFalsy" && rootArg.kind === ts.SyntaxKind.FalseKeyword) {
    return true;
  }
  if (methodName === "toBeNull" && rootArg.kind === ts.SyntaxKind.NullKeyword) {
    return true;
  }
  if (methodName === "toBeUndefined" && ts.isIdentifier(rootArg) && rootArg.text === "undefined") {
    return true;
  }
  if (methodName === "toBeNaN" && ts.isIdentifier(rootArg) && rootArg.text === "NaN") {
    return true;
  }
  return false;
}

export function lintSourceCode(
  sourceCode: string,
  filePath?: string,
  options?: AstLintOptions,
): AstLintResult {
  let fileName = "source.ts";
  if (typeof filePath === "string" && filePath.length > 0) {
    fileName = filePath;
  }

  let enabledRulesSet = new Set<AstLintRule>(ALL_AST_LINT_RULES);
  if (options !== undefined && options !== null) {
    if (options.enabledRules !== undefined && options.enabledRules !== null) {
      enabledRulesSet = new Set<AstLintRule>(options.enabledRules);
    }
    if (options.disabledRules !== undefined && options.disabledRules !== null) {
      for (const disabledRule of options.disabledRules) {
        enabledRulesSet.delete(disabledRule);
      }
    }
  }

  let vendorList: readonly string[] = DEFAULT_PROHIBITED_VENDORS;
  if (options !== undefined && options !== null) {
    if (options.vendorNames !== undefined && options.vendorNames !== null) {
      vendorList = options.vendorNames;
    }
  }
  const vendorSet = new Set<string>(vendorList.map((item) => item.toLowerCase()));

  let scriptKind = ts.ScriptKind.TS;
  if (isJsxFile(fileName)) {
    scriptKind = ts.ScriptKind.TSX;
  } else if (isJsFile(fileName)) {
    scriptKind = ts.ScriptKind.JS;
  }

  const sourceFile = ts.createSourceFile(
    fileName,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  const violations: AstLintViolation[] = [];

  // Check 1: Compiler suppressions in comments
  if (enabledRulesSet.has("compiler_suppression")) {
    const commentViolations = scanCompilerSuppressions(sourceCode, sourceFile, fileName);
    for (const commentViolation of commentViolations) {
      violations.push(commentViolation);
    }
  }

  // Check 2: AST traversal for structural invariants & vendor leaks
  function walk(node: ts.Node): void {
    // Nullish coalescing operator ??
    if (
      enabledRulesSet.has("nullish_coalescing") &&
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      const loc = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        rule: "nullish_coalescing",
        message:
          "Prohibited nullish coalescing operator (??) detected. Use explicit branching instead.",
        file: fileName,
        line: loc.line + 1,
        column: loc.character + 1,
        snippet: node.getText(sourceFile),
      });
    }

    // Logical OR operator ||
    if (
      enabledRulesSet.has("logical_or_fallback") &&
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken
    ) {
      const loc = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        rule: "logical_or_fallback",
        message: "Prohibited logical OR operator (||) detected. Use explicit branching instead.",
        file: fileName,
        line: loc.line + 1,
        column: loc.character + 1,
        snippet: node.getText(sourceFile),
      });
    }

    // any type keyword
    if (enabledRulesSet.has("any_type") && node.kind === ts.SyntaxKind.AnyKeyword) {
      const loc = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        rule: "any_type",
        message:
          "Prohibited 'any' type annotation detected. Use strict types or type guards instead.",
        file: fileName,
        line: loc.line + 1,
        column: loc.character + 1,
        snippet: node.getText(sourceFile),
      });
    }

    // Non-null assertion operator !
    if (enabledRulesSet.has("non_null_assertion") && ts.isNonNullExpression(node)) {
      const loc = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        rule: "non_null_assertion",
        message:
          "Prohibited non-null assertion operator (!) detected. Use explicit branching and runtime verification.",
        file: fileName,
        line: loc.line + 1,
        column: loc.character + 1,
        snippet: node.getText(sourceFile),
      });
    }

    // Vendor / internal leak identifiers
    if (enabledRulesSet.has("vendor_leak")) {
      if (isIdentifierNode(node)) {
        const identifierText = (node as ts.Identifier).text;
        const vendor = findVendorInWordList(identifierText, vendorSet);
        if (vendor !== undefined && vendor !== null) {
          const loc = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          violations.push({
            rule: "vendor_leak",
            message: `Prohibited vendor identifier '${vendor}' found in '${identifierText}'.`,
            file: fileName,
            line: loc.line + 1,
            column: loc.character + 1,
            snippet: node.getText(sourceFile),
            identifier: identifierText,
          });
        }
      }

      // Check import declaration module specifiers
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const modVendor = findVendorInWordList(node.moduleSpecifier.text, vendorSet);
        if (modVendor !== undefined && modVendor !== null) {
          const loc = sourceFile.getLineAndCharacterOfPosition(
            node.moduleSpecifier.getStart(sourceFile),
          );
          violations.push({
            rule: "vendor_leak",
            message: `Prohibited vendor identifier '${modVendor}' found in module import '${node.moduleSpecifier.text}'.`,
            file: fileName,
            line: loc.line + 1,
            column: loc.character + 1,
            snippet: node.moduleSpecifier.getText(sourceFile),
            identifier: node.moduleSpecifier.text,
          });
        }
      }

      // Check export declaration module specifiers
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const modVendor = findVendorInWordList(node.moduleSpecifier.text, vendorSet);
        if (modVendor !== undefined && modVendor !== null) {
          const loc = sourceFile.getLineAndCharacterOfPosition(
            node.moduleSpecifier.getStart(sourceFile),
          );
          violations.push({
            rule: "vendor_leak",
            message: `Prohibited vendor identifier '${modVendor}' found in module export '${node.moduleSpecifier.text}'.`,
            file: fileName,
            line: loc.line + 1,
            column: loc.character + 1,
            snippet: node.moduleSpecifier.getText(sourceFile),
            identifier: node.moduleSpecifier.text,
          });
        }
      }

      // Check require("vendor") call expressions
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require" &&
        node.arguments.length > 0
      ) {
        const firstArg = node.arguments[0];
        if (firstArg !== undefined && ts.isStringLiteral(firstArg)) {
          const reqVendor = findVendorInWordList(firstArg.text, vendorSet);
          if (reqVendor !== undefined && reqVendor !== null) {
            const loc = sourceFile.getLineAndCharacterOfPosition(firstArg.getStart(sourceFile));
            violations.push({
              rule: "vendor_leak",
              message: `Prohibited vendor identifier '${reqVendor}' found in require call '${firstArg.text}'.`,
              file: fileName,
              line: loc.line + 1,
              column: loc.character + 1,
              snippet: firstArg.getText(sourceFile),
              identifier: firstArg.text,
            });
          }
        }
      }

      // Check string literals containing leaked vendor models/systems (ignoring config declarations)
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
          const loc = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          violations.push({
            rule: "vendor_leak",
            message: `Prohibited vendor model/system string found in literal '${node.text}'.`,
            file: fileName,
            line: loc.line + 1,
            column: loc.character + 1,
            snippet: node.getText(sourceFile),
            identifier: node.text,
          });
        }
      }
    }

    // Check 3: Test Anti-Patterns
    if (ts.isCallExpression(node)) {
      const testInfo = identifyTestCall(node);
      if (testInfo !== undefined) {
        const { testName, callback } = testInfo;

        // Check empty test body
        if (enabledRulesSet.has("empty_test_body")) {
          if (!callback.body) {
            const loc = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            violations.push({
              rule: "empty_test_body",
              message: `Test '${testName}' has no function body.`,
              file: fileName,
              line: loc.line + 1,
              column: loc.character + 1,
              testName,
              snippet: node.getText(sourceFile),
            });
          } else if (ts.isBlock(callback.body) && callback.body.statements.length === 0) {
            const loc = sourceFile.getLineAndCharacterOfPosition(
              callback.body.getStart(sourceFile),
            );
            violations.push({
              rule: "empty_test_body",
              message: `Test '${testName}' has an empty function body.`,
              file: fileName,
              line: loc.line + 1,
              column: loc.character + 1,
              testName,
              snippet: callback.body.getText(sourceFile),
            });
          }
        }

        // Check trivial early return
        if (
          enabledRulesSet.has("trivial_early_return") &&
          callback.body &&
          ts.isBlock(callback.body)
        ) {
          let foundAssertion = false;
          for (const stmt of callback.body.statements) {
            let stmtHasAssertion = false;
            function checkStmtAssertion(n: ts.Node): void {
              if (ts.isCallExpression(n) && isAssertionCall(n)) {
                stmtHasAssertion = true;
              }
              ts.forEachChild(n, checkStmtAssertion);
            }
            checkStmtAssertion(stmt);

            if (stmtHasAssertion) {
              foundAssertion = true;
            }

            if (ts.isReturnStatement(stmt) && !foundAssertion) {
              const loc = sourceFile.getLineAndCharacterOfPosition(stmt.getStart(sourceFile));
              violations.push({
                rule: "trivial_early_return",
                message: `Test '${testName}' has early return before any assertion was reached.`,
                file: fileName,
                line: loc.line + 1,
                column: loc.character + 1,
                testName,
                snippet: stmt.getText(sourceFile),
              });
              break;
            }
          }
        }

        // Check mock tautologies
        if (enabledRulesSet.has("mock_tautology")) {
          const mocks = detectMockDeclarations(callback, sourceFile);
          if (mocks.length > 0) {
            const mockNames = new Set(mocks.map((m) => m.varName));
            const stubbedMap = new Map<string, string>();
            for (const m of mocks) {
              if (m.stubbedReturnValue !== undefined) {
                stubbedMap.set(m.varName, m.stubbedReturnValue);
              }
            }

            let mockUsedInSut = false;
            const assertions: ts.CallExpression[] = [];

            function checkMockUsage(n: ts.Node): void {
              if (ts.isCallExpression(n)) {
                if (isAssertionCall(n)) {
                  assertions.push(n);
                } else {
                  let isDirectMock = false;
                  if (ts.isIdentifier(n.expression)) {
                    if (mockNames.has(n.expression.text)) {
                      isDirectMock = true;
                    }
                  }
                  let isDirectMethod = false;
                  if (ts.isPropertyAccessExpression(n.expression)) {
                    if (ts.isIdentifier(n.expression.expression)) {
                      if (mockNames.has(n.expression.expression.text)) {
                        isDirectMethod = true;
                      }
                    }
                  }

                  if (!isDirectMock && !isDirectMethod) {
                    for (const arg of n.arguments) {
                      if (ts.isIdentifier(arg)) {
                        if (mockNames.has(arg.text)) {
                          mockUsedInSut = true;
                        }
                      }
                    }
                  }
                }
              } else if (ts.isNewExpression(n)) {
                let newArgs: readonly ts.Expression[] = [];
                if (n.arguments !== undefined && n.arguments !== null) {
                  newArgs = n.arguments;
                }
                for (const arg of newArgs) {
                  if (ts.isIdentifier(arg)) {
                    if (mockNames.has(arg.text)) {
                      mockUsedInSut = true;
                    }
                  }
                }
              }
              ts.forEachChild(n, checkMockUsage);
            }

            if (callback.body) {
              checkMockUsage(callback.body);
            }

            let foundStubbedViolation = false;
            for (const assertion of assertions) {
              const rootArg = getRootExpectArg(assertion);
              if (rootArg !== undefined) {
                if (ts.isCallExpression(rootArg)) {
                  if (ts.isIdentifier(rootArg.expression)) {
                    const calledName = rootArg.expression.text;
                    const stubbed = stubbedMap.get(calledName);
                    if (stubbed !== undefined && assertion.arguments.length > 0) {
                      const expectedArg = assertion.arguments[0];
                      if (
                        expectedArg !== undefined &&
                        expectedArg.getText(sourceFile) === stubbed
                      ) {
                        const loc = sourceFile.getLineAndCharacterOfPosition(
                          assertion.getStart(sourceFile),
                        );
                        violations.push({
                          rule: "mock_tautology",
                          message: `Test '${testName}' asserts stubbed mock '${calledName}()' return value (${stubbed}) directly without exercising implementation logic.`,
                          file: fileName,
                          line: loc.line + 1,
                          column: loc.character + 1,
                          testName,
                          snippet: assertion.getText(sourceFile),
                        });
                        foundStubbedViolation = true;
                      }
                    }
                  }
                }
              }
            }

            if (!foundStubbedViolation && !mockUsedInSut && assertions.length > 0) {
              let onlyMockAsserts = true;
              for (const assertion of assertions) {
                const rootArg = getRootExpectArg(assertion);
                if (rootArg === undefined) {
                  onlyMockAsserts = false;
                  break;
                }
                const rootText = rootArg.getText(sourceFile);
                let matchesAnyMock = false;
                for (const name of mockNames) {
                  if (matchesMockTarget(rootText, name)) {
                    matchesAnyMock = true;
                    break;
                  }
                }
                if (!matchesAnyMock) {
                  onlyMockAsserts = false;
                  break;
                }
              }

              if (onlyMockAsserts) {
                const firstMock = mocks[0];
                const varName = firstMock !== undefined ? firstMock.varName : "mock";
                const firstAssert = assertions[0];
                const pos =
                  firstAssert !== undefined
                    ? firstAssert.getStart(sourceFile)
                    : callback.getStart(sourceFile);
                const loc = sourceFile.getLineAndCharacterOfPosition(pos);
                violations.push({
                  rule: "mock_tautology",
                  message: `Test '${testName}' asserts mock '${varName}' directly without passing it to any implementation under test.`,
                  file: fileName,
                  line: loc.line + 1,
                  column: loc.character + 1,
                  testName,
                  snippet:
                    firstAssert !== undefined
                      ? firstAssert.getText(sourceFile)
                      : callback.getText(sourceFile),
                });
              }
            }
          }
        }
      }

      // Check trivial assertions in general
      if (enabledRulesSet.has("trivial_assertion")) {
        const expr = node.expression;
        if (ts.isIdentifier(expr) && expr.text === "assert") {
          const firstArg = node.arguments[0];
          if (firstArg !== undefined && firstArg.kind === ts.SyntaxKind.TrueKeyword) {
            const loc = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            violations.push({
              rule: "trivial_assertion",
              message: "Trivial constant assertion 'assert(true)' detected.",
              file: fileName,
              line: loc.line + 1,
              column: loc.character + 1,
              snippet: node.getText(sourceFile),
            });
          }
        }

        if (ts.isPropertyAccessExpression(expr)) {
          const methodName = expr.name.text;
          const rootArg = getRootExpectArg(node);

          if (rootArg !== undefined) {
            const expectedArg = node.arguments[0];

            if (
              EQUALITY_MATCHERS.has(methodName) &&
              expectedArg !== undefined &&
              isLiteralOrConstant(rootArg) &&
              isLiteralOrConstant(expectedArg) &&
              rootArg.getText(sourceFile) === expectedArg.getText(sourceFile)
            ) {
              const loc = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
              violations.push({
                rule: "trivial_assertion",
                message: `Trivial constant assertion comparing literal against itself: '${node.getText(sourceFile)}'.`,
                file: fileName,
                line: loc.line + 1,
                column: loc.character + 1,
                snippet: node.getText(sourceFile),
              });
            }

            if (
              EQUALITY_MATCHERS.has(methodName) &&
              expectedArg !== undefined &&
              ts.isIdentifier(rootArg) &&
              ts.isIdentifier(expectedArg) &&
              rootArg.text === expectedArg.text
            ) {
              const loc = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
              violations.push({
                rule: "trivial_assertion",
                message: `Trivial assertion comparing variable '${rootArg.text}' against itself: '${node.getText(sourceFile)}'.`,
                file: fileName,
                line: loc.line + 1,
                column: loc.character + 1,
                snippet: node.getText(sourceFile),
              });
            }

            if (isTrivialLiteralMatch(methodName, rootArg)) {
              const loc = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
              violations.push({
                rule: "trivial_assertion",
                message: `Trivial constant assertion '${node.getText(sourceFile)}'.`,
                file: fileName,
                line: loc.line + 1,
                column: loc.character + 1,
                snippet: node.getText(sourceFile),
              });
            }
          }
        }
      }
    }

    ts.forEachChild(node, walk);
  }

  walk(sourceFile);

  const summaryByRule = createEmptyRuleSummary();
  for (const violation of violations) {
    const prev = summaryByRule[violation.rule];
    summaryByRule[violation.rule] = prev + 1;
  }

  const passed = violations.length === 0;

  return {
    valid: passed,
    passed,
    filePath: fileName,
    violations,
    totalViolations: violations.length,
    summaryByRule,
  };
}

export function lintFile(filePath: string, options?: AstLintOptions): AstLintResult {
  if (!existsSync(filePath)) {
    throw new HarnessError("PATH_SAFETY", `Target file does not exist: ${filePath}`, [
      { filePath },
    ]);
  }
  const content = readFileSync(filePath, "utf-8");
  return lintSourceCode(content, filePath, options);
}

function collectSourceFiles(
  dirPath: string,
  extensions: readonly string[],
  excludePatterns: readonly string[],
  maxDepth: number,
  currentDepth: number,
): readonly string[] {
  if (currentDepth > maxDepth) {
    return [];
  }
  if (!existsSync(dirPath)) {
    return [];
  }

  const results: string[] = [];
  const entries = readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);

    let isExcluded = false;
    for (const pattern of excludePatterns) {
      if (matchesExcludePattern(entry.name, fullPath, pattern)) {
        isExcluded = true;
        break;
      }
    }
    if (isExcluded) {
      continue;
    }

    if (entry.isDirectory()) {
      const nestedFiles = collectSourceFiles(
        fullPath,
        extensions,
        excludePatterns,
        maxDepth,
        currentDepth + 1,
      );
      for (const nested of nestedFiles) {
        results.push(nested);
      }
    } else if (entry.isFile()) {
      let matchesExtension = false;
      for (const ext of extensions) {
        if (entry.name.endsWith(ext)) {
          matchesExtension = true;
          break;
        }
      }
      if (matchesExtension) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

export function lintDirectory(dirPath: string, options?: AstLintOptions): DirectoryLintResult {
  if (!existsSync(dirPath)) {
    throw new HarnessError("PATH_SAFETY", `Target directory does not exist: ${dirPath}`, [
      { dirPath },
    ]);
  }

  const stat = statSync(dirPath);
  if (!stat.isDirectory()) {
    throw new HarnessError("PATH_SAFETY", `Target path is not a directory: ${dirPath}`, [
      { dirPath },
    ]);
  }

  let extensions: readonly string[] = DEFAULT_EXTENSIONS;
  if (options !== undefined && options !== null) {
    if (options.includeExtensions !== undefined && options.includeExtensions !== null) {
      extensions = options.includeExtensions;
    }
  }

  let excludePatterns: readonly string[] = ["node_modules", ".git", ".capsules", "dist", "build"];
  if (options !== undefined && options !== null) {
    if (options.excludePatterns !== undefined && options.excludePatterns !== null) {
      excludePatterns = options.excludePatterns;
    }
  }

  let maxDepth = 20;
  if (options !== undefined && options !== null) {
    if (typeof options.maxDepth === "number" && options.maxDepth >= 0) {
      maxDepth = options.maxDepth;
    }
  }

  const files = collectSourceFiles(dirPath, extensions, excludePatterns, maxDepth, 0);

  const fileResults: AstLintResult[] = [];
  let totalViolations = 0;
  let cleanFiles = 0;
  let failedFiles = 0;
  const aggregatedSummary = createEmptyRuleSummary();

  for (const file of files) {
    const result = lintFile(file, options);
    fileResults.push(result);
    totalViolations = totalViolations + result.totalViolations;

    if (result.valid) {
      cleanFiles = cleanFiles + 1;
    } else {
      failedFiles = failedFiles + 1;
    }

    for (const rule of ALL_AST_LINT_RULES) {
      const count = result.summaryByRule[rule];
      const prevTotal = aggregatedSummary[rule];
      aggregatedSummary[rule] = prevTotal + count;
    }
  }

  const passed = totalViolations === 0;

  return {
    valid: passed,
    passed,
    directoryPath: dirPath,
    totalFiles: files.length,
    cleanFiles,
    failedFiles,
    totalViolations,
    fileResults,
    summaryByRule: aggregatedSummary,
  };
}

export function generateFixSuggestion(
  violation: AstLintViolation,
  _sourceCode?: string,
): FixSuggestion {
  let suggestedReplacement = "";
  let explanation = "";

  switch (violation.rule) {
    case "nullish_coalescing": {
      const parts = violation.snippet.split("??").map((s) => s.trim());
      if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
        const left = parts[0];
        const right = parts[1];
        suggestedReplacement = `(${left} !== undefined && ${left} !== null ? ${left} : ${right})`;
      } else {
        suggestedReplacement = "/* Use explicit if-check or ternary condition */";
      }
      explanation =
        "Replace nullish coalescing operator (??) with explicit nullish checks or explicit branching.";
      break;
    }
    case "logical_or_fallback": {
      const parts = violation.snippet.split("||").map((s) => s.trim());
      if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
        const left = parts[0];
        const right = parts[1];
        suggestedReplacement = `(Boolean(${left}) ? ${left} : ${right})`;
      } else {
        suggestedReplacement = "/* Use explicit branching instead of || */";
      }
      explanation = "Replace logical OR fallback operator (||) with explicit boolean verification.";
      break;
    }
    case "any_type": {
      if (violation.snippet.includes("as any")) {
        suggestedReplacement = violation.snippet.replace(/\bas\s+any\b/gu, "as unknown");
      } else if (violation.snippet.includes(": any")) {
        suggestedReplacement = violation.snippet.replace(/:\s*any\b/gu, ": unknown");
      } else if (violation.snippet.includes("<any>")) {
        suggestedReplacement = violation.snippet.replace(/<any>/gu, "<unknown>");
      } else {
        suggestedReplacement = "unknown";
      }
      explanation = "Replace 'any' with 'unknown', strict generic types, or safe type guards.";
      break;
    }
    case "non_null_assertion": {
      suggestedReplacement = "/* verify value !== undefined before access */";
      explanation =
        "Replace non-null assertion (!) with explicit conditional guard or runtime check.";
      break;
    }
    case "vendor_leak": {
      suggestedReplacement = "/* Replace vendor-specific identifier with neutral naming */";
      explanation = "Sanitize vendor identifier to maintain host/vendor neutrality.";
      break;
    }
    case "compiler_suppression": {
      suggestedReplacement = "";
      explanation =
        "Remove compiler suppression directive and fix underlying TypeScript type issue.";
      break;
    }
    case "mock_tautology": {
      suggestedReplacement = "/* Pass mock to system under test and assert on output */";
      explanation =
        "Avoid asserting on mocks directly without exercising production implementation logic.";
      break;
    }
    case "trivial_assertion": {
      suggestedReplacement = "/* Assert on dynamic computed result from function under test */";
      explanation =
        "Replace trivial literal comparison with meaningful assertions on actual business logic.";
      break;
    }
    case "empty_test_body": {
      suggestedReplacement = "/* Add test statements and assertions */";
      explanation = "Provide test statements and assertions verifying behavior.";
      break;
    }
    case "trivial_early_return": {
      suggestedReplacement = "/* Execute assertions before returning */";
      explanation = "Ensure test executes assertions before any return statement.";
      break;
    }
    default: {
      suggestedReplacement = "";
      explanation = "Refactor code to satisfy zero-fallback structural invariants.";
      break;
    }
  }

  return {
    rule: violation.rule,
    file: violation.file,
    line: violation.line,
    column: violation.column,
    originalSnippet: violation.snippet,
    suggestedReplacement,
    explanation,
  };
}

export function suggestRefactorings(
  result: AstLintResult | DirectoryLintResult,
  sourceCode?: string,
): readonly FixSuggestion[] {
  const suggestions: FixSuggestion[] = [];

  if (isDirectoryLintResult(result)) {
    for (const fileRes of result.fileResults) {
      for (const v of fileRes.violations) {
        suggestions.push(generateFixSuggestion(v, sourceCode));
      }
    }
  } else {
    for (const v of result.violations) {
      suggestions.push(generateFixSuggestion(v, sourceCode));
    }
  }

  return suggestions;
}

export function autoFixSourceCode(
  sourceCode: string,
  filePath?: string,
  options?: AstLintOptions,
): AutoFixResult {
  const fileName = typeof filePath === "string" && filePath.length > 0 ? filePath : "source.ts";
  const initialResult = lintSourceCode(sourceCode, fileName, options);
  if (initialResult.valid) {
    return {
      originalCode: sourceCode,
      fixedCode: sourceCode,
      appliedFixesCount: 0,
      fixedViolations: [],
      remainingResult: initialResult,
    };
  }

  let modifiedCode = sourceCode;
  const appliedSuggestions: FixSuggestion[] = [];

  // Fix 1: Auto-fix compiler suppression comments
  for (const directive of COMPILER_SUPPRESSION_DIRECTIVES) {
    if (modifiedCode.includes(directive)) {
      const regex = new RegExp(`//\\s*${directive}[^\\n]*\\n?`, "gu");
      modifiedCode = modifiedCode.replace(regex, "");
    }
  }

  // Fix 2: Auto-fix `as any` -> `as unknown`
  modifiedCode = modifiedCode.replace(/\bas\s+any\b/gu, "as unknown");

  // Fix 3: Auto-fix simple `a ?? b` -> `(a !== undefined && a !== null ? a : b)`
  modifiedCode = modifiedCode.replace(
    /([A-Za-z0-9_$.]+)\s*\?\?\s*([A-Za-z0-9_$.'"]+)/gu,
    "($1 !== undefined && $1 !== null ? $1 : $2)",
  );

  const remainingResult = lintSourceCode(modifiedCode, fileName, options);
  const fixedCount = initialResult.totalViolations - remainingResult.totalViolations;
  let appliedCount = 0;
  if (fixedCount > 0) {
    appliedCount = fixedCount;
  }

  for (const v of initialResult.violations) {
    appliedSuggestions.push(generateFixSuggestion(v, sourceCode));
  }

  return {
    originalCode: sourceCode,
    fixedCode: modifiedCode,
    appliedFixesCount: appliedCount,
    fixedViolations: appliedSuggestions,
    remainingResult,
  };
}

export function formatAstLintReport(result: DirectoryLintResult | AstLintResult): string {
  const lines: string[] = [];

  if (isDirectoryLintResult(result)) {
    lines.push("================================================================================");
    lines.push(`AST LINT DIRECTORY REPORT: ${result.directoryPath}`);
    let statusText = `FAILED (${result.totalViolations} violations)`;
    if (result.valid) {
      statusText = "PASSED (0 violations)";
    }
    lines.push(`Status: ${statusText}`);
    lines.push(
      `Files scanned: ${result.totalFiles} (Clean: ${result.cleanFiles}, Failed: ${result.failedFiles})`,
    );
    lines.push("--------------------------------------------------------------------------------");
    lines.push("Summary by rule:");
    for (const rule of ALL_AST_LINT_RULES) {
      lines.push(`  - ${rule}: ${result.summaryByRule[rule]}`);
    }

    if (!result.valid) {
      lines.push(
        "--------------------------------------------------------------------------------",
      );
      lines.push("Violations by file:");
      for (const fileRes of result.fileResults) {
        if (!fileRes.valid) {
          lines.push(`\nFile: ${fileRes.filePath} (${fileRes.totalViolations} violations)`);
          for (const v of fileRes.violations) {
            lines.push(`  Line ${v.line}:${v.column} [${v.rule}] ${v.message}`);
            lines.push(`    Snippet: ${v.snippet}`);
          }
        }
      }
    }
    lines.push("================================================================================");
  } else {
    lines.push("================================================================================");
    lines.push(`AST LINT FILE REPORT: ${result.filePath}`);
    let statusText = `FAILED (${result.totalViolations} violations)`;
    if (result.valid) {
      statusText = "PASSED (0 violations)";
    }
    lines.push(`Status: ${statusText}`);
    lines.push("--------------------------------------------------------------------------------");
    lines.push("Summary by rule:");
    for (const rule of ALL_AST_LINT_RULES) {
      lines.push(`  - ${rule}: ${result.summaryByRule[rule]}`);
    }

    if (!result.valid) {
      lines.push(
        "--------------------------------------------------------------------------------",
      );
      lines.push("Violations:");
      for (const v of result.violations) {
        lines.push(`  Line ${v.line}:${v.column} [${v.rule}] ${v.message}`);
        lines.push(`    Snippet: ${v.snippet}`);
      }
    }
    lines.push("================================================================================");
  }

  return lines.join("\n");
}

export function formatViolationMarkdown(violation: AstLintViolation): string {
  const parts: string[] = [];
  parts.push(
    `- **[${violation.rule}]** \`${violation.file}:${violation.line}:${violation.column}\``,
  );
  parts.push(`  ${violation.message}`);
  parts.push(`  \`\`\`ts\n  ${violation.snippet}\n  \`\`\``);
  return parts.join("\n");
}

export function formatSummaryTable(summaryByRule: Readonly<Record<AstLintRule, number>>): string {
  const rows: string[] = ["| Rule | Violations |", "| :--- | :--- |"];
  for (const rule of ALL_AST_LINT_RULES) {
    rows.push(`| \`${rule}\` | ${summaryByRule[rule]} |`);
  }
  return rows.join("\n");
}

export function assertZeroFallbackCompliance(
  filePathOrSource: string,
  options?: AstLintOptions,
): void {
  let result: AstLintResult;

  if (typeof filePathOrSource === "string" && existsSync(filePathOrSource)) {
    const stat = statSync(filePathOrSource);
    if (stat.isDirectory()) {
      const dirResult = lintDirectory(filePathOrSource, options);
      if (!dirResult.valid) {
        const report = formatAstLintReport(dirResult);
        throw new HarnessError(
          "INTEGRITY",
          `Zero-fallback compliance check failed for directory '${filePathOrSource}' with ${dirResult.totalViolations} violations:\n${report}`,
          [{ directory: filePathOrSource, totalViolations: dirResult.totalViolations }],
        );
      }
      return;
    }
    result = lintFile(filePathOrSource, options);
  } else {
    result = lintSourceCode(filePathOrSource, "anonymous.ts", options);
  }

  if (!result.valid) {
    const report = formatAstLintReport(result);
    throw new HarnessError(
      "INTEGRITY",
      `Zero-fallback compliance check failed for '${result.filePath}' with ${result.totalViolations} violations:\n${report}`,
      [{ file: result.filePath, totalViolations: result.totalViolations }],
    );
  }
}

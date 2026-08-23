import ts from "typescript";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";
import { isNonblank, isRecord } from "../requirements/predicates.ts";

export type AstLintRule =
  | "nullish_coalescing"
  | "logical_or_fallback"
  | "any_type"
  | "non_null_assertion"
  | "vendor_leak"
  | "compiler_suppression";

export const ALL_AST_LINT_RULES: readonly AstLintRule[] = [
  "nullish_coalescing",
  "logical_or_fallback",
  "any_type",
  "non_null_assertion",
  "vendor_leak",
  "compiler_suppression",
] as const;

export const DEFAULT_PROHIBITED_VENDORS: readonly string[] = [
  "anthropic",
  "openai",
  "gemini",
  "claude",
  "chatgpt",
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
] as const;

export interface AstLintViolation {
  readonly rule: AstLintRule;
  readonly message: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly snippet: string;
  readonly identifier?: string | undefined;
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

  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    languageVariant,
    sourceCode,
  );

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

  // Check 2: AST traversal
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
        message: "Prohibited nullish coalescing operator (??) detected. Use explicit branching instead.",
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
    if (
      enabledRulesSet.has("any_type") &&
      node.kind === ts.SyntaxKind.AnyKeyword
    ) {
      const loc = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        rule: "any_type",
        message: "Prohibited 'any' type annotation detected. Use strict types or type guards instead.",
        file: fileName,
        line: loc.line + 1,
        column: loc.character + 1,
        snippet: node.getText(sourceFile),
      });
    }

    // Non-null assertion operator !
    if (
      enabledRulesSet.has("non_null_assertion") &&
      ts.isNonNullExpression(node)
    ) {
      const loc = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        rule: "non_null_assertion",
        message: "Prohibited non-null assertion operator (!) detected. Use explicit branching and runtime verification.",
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
          const loc = sourceFile.getLineAndCharacterOfPosition(node.moduleSpecifier.getStart(sourceFile));
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
      if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
        const modVendor = findVendorInWordList(node.moduleSpecifier.text, vendorSet);
        if (modVendor !== undefined && modVendor !== null) {
          const loc = sourceFile.getLineAndCharacterOfPosition(node.moduleSpecifier.getStart(sourceFile));
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
    throw new HarnessError(
      "PATH_SAFETY",
      `Target file does not exist: ${filePath}`,
      [{ filePath }],
    );
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

export function lintDirectory(
  dirPath: string,
  options?: AstLintOptions,
): DirectoryLintResult {
  if (!existsSync(dirPath)) {
    throw new HarnessError(
      "PATH_SAFETY",
      `Target directory does not exist: ${dirPath}`,
      [{ dirPath }],
    );
  }

  const stat = statSync(dirPath);
  if (!stat.isDirectory()) {
    throw new HarnessError(
      "PATH_SAFETY",
      `Target path is not a directory: ${dirPath}`,
      [{ dirPath }],
    );
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

export function formatAstLintReport(
  result: DirectoryLintResult | AstLintResult,
): string {
  const lines: string[] = [];

  if (isDirectoryLintResult(result)) {
    lines.push("================================================================================");
    lines.push(`AST LINT DIRECTORY REPORT: ${result.directoryPath}`);
    lines.push(`Status: ${result.valid ? "PASSED (0 violations)" : `FAILED (${result.totalViolations} violations)`}`);
    lines.push(`Files scanned: ${result.totalFiles} (Clean: ${result.cleanFiles}, Failed: ${result.failedFiles})`);
    lines.push("--------------------------------------------------------------------------------");
    lines.push("Summary by rule:");
    for (const rule of ALL_AST_LINT_RULES) {
      lines.push(`  - ${rule}: ${result.summaryByRule[rule]}`);
    }

    if (!result.valid) {
      lines.push("--------------------------------------------------------------------------------");
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
    lines.push(`Status: ${result.valid ? "PASSED (0 violations)" : `FAILED (${result.totalViolations} violations)`}`);
    lines.push("--------------------------------------------------------------------------------");
    lines.push("Summary by rule:");
    for (const rule of ALL_AST_LINT_RULES) {
      lines.push(`  - ${rule}: ${result.summaryByRule[rule]}`);
    }

    if (!result.valid) {
      lines.push("--------------------------------------------------------------------------------");
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

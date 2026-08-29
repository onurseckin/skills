import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { HarnessError } from "../errors/index.ts";

export interface TypeSafetyViolation {
  readonly rule: "any_type" | "compiler_suppression";
  readonly message: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly snippet: string;
}

export interface TypeSafetyScanResult {
  readonly valid: boolean;
  readonly passed: boolean;
  readonly filePath: string;
  readonly violations: readonly TypeSafetyViolation[];
  readonly totalViolations: number;
}

export interface TypeSafetyScanOptions {
  readonly checkCompilerSuppressions?: boolean;
  readonly includeExtensions?: readonly string[];
  readonly excludePatterns?: readonly string[];
  readonly maxDepth?: number;
}

const DEFAULT_TS_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts"];
const DEFAULT_EXCLUDE_PATTERNS: readonly string[] = [
  "node_modules",
  ".git",
  ".capsules",
  "dist",
  "build",
];
const DEFAULT_SUPPRESSIONS: readonly string[] = [
  "@ts-ignore",
  "@ts-nocheck",
  "@ts-expect-error",
  "@ts-check",
  "eslint-disable",
  "eslint-disable-line",
  "eslint-disable-next-line",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuleValid(rule: unknown): rule is "any_type" | "compiler_suppression" {
  if (rule === "any_type") return true;
  if (rule === "compiler_suppression") return true;
  return false;
}

export function isTypeSafetyViolation(value: unknown): value is TypeSafetyViolation {
  if (!isRecord(value)) return false;
  return (
    isRuleValid(value["rule"]) &&
    typeof value["message"] === "string" &&
    typeof value["file"] === "string" &&
    typeof value["line"] === "number" &&
    typeof value["column"] === "number" &&
    typeof value["snippet"] === "string"
  );
}

export function isTypeSafetyScanResult(value: unknown): value is TypeSafetyScanResult {
  if (!isRecord(value)) return false;
  const violations = value["violations"];
  return (
    typeof value["valid"] === "boolean" &&
    typeof value["passed"] === "boolean" &&
    typeof value["filePath"] === "string" &&
    typeof value["totalViolations"] === "number" &&
    Array.isArray(violations) &&
    violations.every(isTypeSafetyViolation)
  );
}

function isTsxFile(fileName: string): boolean {
  if (fileName.endsWith(".tsx")) return true;
  if (fileName.endsWith(".jsx")) return true;
  return false;
}

function isCommentTrivia(token: ts.SyntaxKind): boolean {
  if (token === ts.SyntaxKind.SingleLineCommentTrivia) return true;
  if (token === ts.SyntaxKind.MultiLineCommentTrivia) return true;
  return false;
}

function matchesPattern(entryName: string, fullPath: string, pattern: string): boolean {
  if (entryName === pattern) return true;
  if (fullPath.includes(`/${pattern}/`)) return true;
  if (fullPath.endsWith(`/${pattern}`)) return true;
  return false;
}

function checkCompilerSuppressions(
  sourceCode: string,
  sourceFile: ts.SourceFile,
  fileName: string,
  violations: TypeSafetyViolation[],
): void {
  const languageVariant = isTsxFile(fileName)
    ? ts.LanguageVariant.JSX
    : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, languageVariant, sourceCode);
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (isCommentTrivia(token)) {
      const commentText = scanner.getTokenText();
      const commentPos = scanner.getTokenPos();
      for (const suppression of DEFAULT_SUPPRESSIONS) {
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
}

export function collectTypescriptFiles(
  dirPath: string,
  extensions: readonly string[] = DEFAULT_TS_EXTENSIONS,
  excludePatterns: readonly string[] = DEFAULT_EXCLUDE_PATTERNS,
  maxDepth = 20,
  currentDepth = 0,
): readonly string[] {
  if (currentDepth > maxDepth) return [];
  if (!existsSync(dirPath)) return [];
  const results: string[] = [];
  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    let isExcluded = false;
    for (const pattern of excludePatterns) {
      if (matchesPattern(entry.name, fullPath, pattern)) {
        isExcluded = true;
        break;
      }
    }
    if (isExcluded) continue;
    if (entry.isDirectory()) {
      const nested = collectTypescriptFiles(
        fullPath,
        extensions,
        excludePatterns,
        maxDepth,
        currentDepth + 1,
      );
      for (const file of nested) results.push(file);
    } else if (entry.isFile()) {
      for (const ext of extensions) {
        if (entry.name.endsWith(ext)) {
          results.push(fullPath);
          break;
        }
      }
    }
  }
  return results;
}

export function scanSourceCodeForTypescriptAny(
  sourceCode: string,
  fileName = "source.ts",
  options?: TypeSafetyScanOptions,
): TypeSafetyScanResult {
  const scriptKind = isTsxFile(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const violations: TypeSafetyViolation[] = [];

  function walk(node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const loc = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const snippet = node.parent ? node.parent.getText(sourceFile) : node.getText(sourceFile);
      violations.push({
        rule: "any_type",
        message:
          "Prohibited 'any' type annotation detected. Use strict types or type guards instead.",
        file: fileName,
        line: loc.line + 1,
        column: loc.character + 1,
        snippet: snippet.length > 120 ? `${snippet.slice(0, 117)}...` : snippet,
      });
    }
    ts.forEachChild(node, walk);
  }
  walk(sourceFile);

  let checkSuppressions = true;
  if (options !== undefined && options.checkCompilerSuppressions !== undefined) {
    checkSuppressions = options.checkCompilerSuppressions;
  }
  if (checkSuppressions) {
    checkCompilerSuppressions(sourceCode, sourceFile, fileName, violations);
  }

  const passed = violations.length === 0;
  return {
    valid: passed,
    passed,
    filePath: fileName,
    violations,
    totalViolations: violations.length,
  };
}

export function scanFileForTypescriptAny(
  filePath: string,
  options?: TypeSafetyScanOptions,
): TypeSafetyScanResult {
  if (!existsSync(filePath)) {
    throw new HarnessError("PATH_SAFETY", `Target file does not exist: ${filePath}`, [
      { filePath },
    ]);
  }
  return scanSourceCodeForTypescriptAny(readFileSync(filePath, "utf-8"), filePath, options);
}

export function scanDirectoryForTypescriptAny(
  dirPath: string,
  options?: TypeSafetyScanOptions,
): TypeSafetyScanResult {
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
  let extensions = DEFAULT_TS_EXTENSIONS;
  if (options !== undefined && options.includeExtensions !== undefined) {
    extensions = options.includeExtensions;
  }
  let excludePatterns = DEFAULT_EXCLUDE_PATTERNS;
  if (options !== undefined && options.excludePatterns !== undefined) {
    excludePatterns = options.excludePatterns;
  }
  let maxDepth = 20;
  if (options !== undefined && options.maxDepth !== undefined) {
    maxDepth = options.maxDepth;
  }
  const files = collectTypescriptFiles(dirPath, extensions, excludePatterns, maxDepth);
  const allViolations: TypeSafetyViolation[] = [];
  for (const file of files) {
    const fileResult = scanFileForTypescriptAny(file, options);
    for (const v of fileResult.violations) allViolations.push(v);
  }
  return {
    valid: allViolations.length === 0,
    passed: allViolations.length === 0,
    filePath: dirPath,
    violations: allViolations,
    totalViolations: allViolations.length,
  };
}

export function assertZeroTypescriptAny(
  filePathOrSource: string,
  options?: TypeSafetyScanOptions,
): void {
  let result: TypeSafetyScanResult;
  if (typeof filePathOrSource === "string" && existsSync(filePathOrSource)) {
    const stat = statSync(filePathOrSource);
    result = stat.isDirectory()
      ? scanDirectoryForTypescriptAny(filePathOrSource, options)
      : scanFileForTypescriptAny(filePathOrSource, options);
  } else {
    result = scanSourceCodeForTypescriptAny(filePathOrSource, "inline.ts", options);
  }

  if (!result.valid) {
    const formattedViolations = result.violations
      .map(
        (v) =>
          `  - [${v.rule}] ${v.file}:${v.line}:${v.column}: ${v.message} (snippet: '${v.snippet}')`,
      )
      .join("\n");
    throw new HarnessError(
      "INTEGRITY",
      `Zero TypeScript 'any' compliance check failed for '${result.filePath}' with ${result.totalViolations} violation(s):\n${formattedViolations}`,
      [
        {
          target: result.filePath,
          totalViolations: result.totalViolations,
          violations: result.violations.map((v) => ({
            rule: v.rule,
            file: v.file,
            line: v.line,
            column: v.column,
            snippet: v.snippet,
          })),
        },
      ],
      3,
      "Eliminate all 'any' types and compiler suppression directives. Use strict types, generics, or unknown with type guards.",
    );
  }
}

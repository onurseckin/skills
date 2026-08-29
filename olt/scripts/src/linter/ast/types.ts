import ts from "typescript";
import { isRecord } from "../../requirements/predicates.ts";

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

export interface RuleContext {
  readonly sourceFile: ts.SourceFile;
  readonly fileName: string;
  readonly enabledRulesSet: ReadonlySet<AstLintRule>;
  readonly vendorSet: ReadonlySet<string>;
  readonly violations: AstLintViolation[];
}

export interface AstLintRuleModule {
  readonly rule: AstLintRule;
  readonly checkNode?: (node: ts.Node, context: RuleContext) => void;
  readonly checkSourceFile?: (sourceCode: string, context: RuleContext) => void;
  readonly generateFixSuggestion?: (
    violation: AstLintViolation,
  ) => Pick<FixSuggestion, "suggestedReplacement" | "explanation">;
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

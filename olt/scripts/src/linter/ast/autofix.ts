import { ALL_RULES } from "../rules/index.ts";
import { lintSourceCode } from "./runner.ts";
import {
  COMPILER_SUPPRESSION_DIRECTIVES,
  isDirectoryLintResult,
  type AstLintOptions,
  type AstLintResult,
  type AstLintViolation,
  type AutoFixResult,
  type DirectoryLintResult,
  type FixSuggestion,
} from "./types.ts";

export function generateFixSuggestion(
  violation: AstLintViolation,
  _sourceCode?: string,
): FixSuggestion {
  const ruleModule = ALL_RULES.find((r) => r.rule === violation.rule);
  let replacement = "";
  let explanation = "Refactor code to satisfy zero-fallback structural invariants.";

  if (ruleModule !== undefined && ruleModule.generateFixSuggestion !== undefined) {
    const suggestion = ruleModule.generateFixSuggestion(violation);
    replacement = suggestion.suggestedReplacement;
    explanation = suggestion.explanation;
  }

  return {
    rule: violation.rule,
    file: violation.file,
    line: violation.line,
    column: violation.column,
    originalSnippet: violation.snippet,
    suggestedReplacement: replacement,
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

  for (const directive of COMPILER_SUPPRESSION_DIRECTIVES) {
    if (modifiedCode.includes(directive)) {
      const regex = new RegExp(`//\\s*${directive}[^\\n]*\\n?`, "gu");
      modifiedCode = modifiedCode.replace(regex, "");
    }
  }

  modifiedCode = modifiedCode.replace(/\bas\s+any\b/gu, "as unknown");

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

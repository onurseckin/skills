export {
  ALL_AST_LINT_RULES,
  COMPILER_SUPPRESSION_DIRECTIVES,
  DEFAULT_EXTENSIONS,
  DEFAULT_PROHIBITED_VENDORS,
  isAstLintResult,
  isAstLintViolation,
  isAutoFixResult,
  isDirectoryLintResult,
  isFixSuggestion,
  type AstLintOptions,
  type AstLintResult,
  type AstLintRule,
  type AstLintRuleModule,
  type AstLintViolation,
  type AutoFixResult,
  type DirectoryLintResult,
  type FixSuggestion,
  type RuleContext,
} from "./types.ts";

export {
  createEmptyRuleSummary,
  extractIdentifierWords,
  findVendorInWordList,
  isAccessOrCall,
  isCommentToken,
  isIdentifierNode,
  isInsideVendorConfigDefinition,
  isJsFile,
  isJsxFile,
  matchesExcludePattern,
} from "./utils.ts";

export {
  ASSERTION_NAMES,
  detectMockDeclarations,
  EQUALITY_MATCHERS,
  extractTestName,
  findCallback,
  getRootExpectArg,
  identifyTestCall,
  isAssertionCall,
  isLiteralOrConstant,
  isTestIdentifier,
  isTestPropertyTarget,
  isTrivialLiteralMatch,
  LITERAL_SYNTAX_KINDS,
  matchesMockTarget,
  MOCK_FACTORIES,
  MOCK_FRAMEWORK_NAMES,
  MOCK_RETURN_PROPS,
  TEST_IDENTIFIERS,
  type MockInfo,
  type TestCallInfo,
} from "./test-utils.ts";

export { formatAstLintReport, formatSummaryTable, formatViolationMarkdown } from "./formatters.ts";

export { collectSourceFiles, lintDirectory } from "./scanner.ts";

export { assertZeroFallbackCompliance, lintFile, lintSourceCode } from "./runner.ts";

export { autoFixSourceCode, generateFixSuggestion, suggestRefactorings } from "./autofix.ts";

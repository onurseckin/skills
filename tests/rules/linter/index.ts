/**
 * Rules Linter Subdomain Test Facade.
 * Explicit named exports for AST static analysis rules and runner modules.
 */

export {
  ALL_RULES,
  anyTypeRule,
  compilerSuppressionRule,
  logicalOrFallbackRule,
  nonNullAssertionRule,
  nullishCoalescingRule,
  vendorLeakRule,
  emptyTestBodyRule,
  mockTautologyRule,
  trivialAssertionRule,
  trivialEarlyReturnRule,
} from "../../../olt/scripts/src/linter/rules/index.ts";

export {
  lintSourceCode,
  lintFile,
} from "../../../olt/scripts/src/linter/ast/runner.ts";

export {
  lintDirectory,
  collectSourceFiles,
} from "../../../olt/scripts/src/linter/ast/scanner.ts";

export type {
  AstLintRuleModule,
  AstLintResult,
  AstViolation,
  DirectoryLintResult,
} from "../../../olt/scripts/src/linter/ast/index.ts";

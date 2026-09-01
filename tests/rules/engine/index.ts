/**
 * Rules Engine Subdomain Test Facade.
 * Explicit named exports for rule execution engine, invariant runners, and scanner utilities.
 */

export {
  lintSourceCode,
  lintFile,
  assertZeroFallbackCompliance,
} from "../../../olt/scripts/src/linter/ast/runner.ts";
export { lintDirectory, collectSourceFiles } from "../../../olt/scripts/src/linter/ast/scanner.ts";

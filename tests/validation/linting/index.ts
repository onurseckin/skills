/**
 * Linting Facade.
 */
export {
  lintTestAst,
  isTestIdentifier,
  identifyTestCall,
  extractTestName,
  findCallback,
  checkTrivialConstantAssertion,
  checkMockTautology,
  detectMockDeclarations,
} from "../../../olt/scripts/src/validation/ast-linter/index.ts";

export {
  validateCapsuleDiskHygiene,
  validateDensityBudgets,
  validateFacadeExports,
  validateNoBackwardsCompatibilityShims,
  validateRepositoryCodingConventions,
  validateZeroCommentsInCode,
} from "../../../olt/scripts/src/validation/coding-conventions.ts";

export { extractDomViolations } from "../../../olt/scripts/src/validation/channels/dom-violation-extractor.ts";

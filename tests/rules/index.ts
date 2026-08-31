/**
 * Lane 10: Rules Domain Root Test Facade.
 * Re-exports domain facades across all 4 subdomains:
 * - linter/
 * - design/
 * - supervisory/
 * - engine/
 */

// 1. Linter Rules Subdomain
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
} from "./linter/index.ts";

// 2. Design Rules Subdomain
export {
  getExpectedAppleTracking,
  validateAppleOpticalTracking,
  validateFloatingUiCollision,
  validateGeistTokens,
  validateMaterialStateLayers,
  validateWaiAriaFocusTrap,
  validateCustom,
} from "./design/index.ts";

// 3. Supervisory Rules Subdomain
export {
  evaluateRulesBatch1,
  evaluateRulesBatch2,
  readFrontmatter,
} from "./supervisory/index.ts";

// 4. Engine Subdomain
export {
  lintSourceCode,
  lintFile,
  assertZeroFallbackCompliance,
  lintDirectory,
  collectSourceFiles,
} from "./engine/index.ts";

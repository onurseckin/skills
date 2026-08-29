import type { AstLintRuleModule } from "../ast/index.ts";
import { anyTypeRule } from "./any_type.ts";
import { compilerSuppressionRule } from "./compiler_suppression.ts";
import { logicalOrFallbackRule } from "./logical_or_fallback.ts";
import { nonNullAssertionRule } from "./non_null_assertion.ts";
import { nullishCoalescingRule } from "./nullish_coalescing.ts";
import {
  emptyTestBodyRule,
  mockTautologyRule,
  trivialAssertionRule,
  trivialEarlyReturnRule,
} from "./testing/index.ts";
import { vendorLeakRule } from "./vendor_leak.ts";

export { anyTypeRule } from "./any_type.ts";
export { compilerSuppressionRule } from "./compiler_suppression.ts";
export { logicalOrFallbackRule } from "./logical_or_fallback.ts";
export { nonNullAssertionRule } from "./non_null_assertion.ts";
export { nullishCoalescingRule } from "./nullish_coalescing.ts";
export {
  emptyTestBodyRule,
  mockTautologyRule,
  trivialAssertionRule,
  trivialEarlyReturnRule,
} from "./testing/index.ts";
export { vendorLeakRule } from "./vendor_leak.ts";

export const ALL_RULES: readonly AstLintRuleModule[] = [
  nullishCoalescingRule,
  logicalOrFallbackRule,
  anyTypeRule,
  nonNullAssertionRule,
  vendorLeakRule,
  compilerSuppressionRule,
  mockTautologyRule,
  trivialAssertionRule,
  emptyTestBodyRule,
  trivialEarlyReturnRule,
];

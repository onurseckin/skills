/**
 * Common superficial patterns and canned phrases that indicate rubber-stamping or lack of concrete verification.
 */
export const SUPERFICIAL_PATTERNS: readonly RegExp[] = [
  /^(lgtm|looks good|looks fine|looks ok|looks okay)\b/i,
  /^(all tests pass|tests pass|all passing|tests green)\b/i,
  /^(done|verified|approved|passed|complete|finished)\b/i,
  /^(everything works|works as expected|no issues found|no problems)\b/i,
  /^(passed without issues|all requirements met|looks good to me)\b/i,
  /^(checked and verified|verified manually|good to go)\b/i,
];

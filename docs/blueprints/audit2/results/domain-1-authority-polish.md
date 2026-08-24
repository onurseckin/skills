# Domain 1: Authority & Policy Polish

## Objective

Resolve residual edge cases in the authority and policy core files:

- `olt/scripts/src/authority/`
- `olt/scripts/src/policy/`

## Completed Tasks

1. **Explicit Step-by-Step Resolution Paths in Markdown:**
   - Updated `olt/scripts/src/authority/review-pushback.ts` to replace generic guidance strings with structured Markdown instructions under `**Resolution Path:**`.
   - Updated `olt/scripts/src/authority/supervisory-persona-reminder.ts` to format `correctiveDirective` fields as explicit step-by-step resolution paths in clean Markdown.

2. **Persona Verification Cache Invalidation:**
   - Appended `invalidatePersonaVerificationCaches()` to `olt/scripts/src/authority/persona-grounding.ts`.
   - Configured this function to cleanly invoke `clearManifestCache()` from `manifest-parser.ts` to ensure session role transitions do not preserve stale verification data.

3. **Strict TypeScript Compliance:**
   - Verified 0 instances of `any`, `@ts-ignore`, or `@ts-expect-error` were introduced.
   - Verified that the implemented changes pass typechecking (note: existing external syntax errors in `state-ledger.ts` and `state-machine.ts` remain outside the disjoint write scope).

## Files Modified

- `olt/scripts/src/authority/review-pushback.ts`
- `olt/scripts/src/authority/supervisory-persona-reminder.ts`
- `olt/scripts/src/authority/persona-grounding.ts`

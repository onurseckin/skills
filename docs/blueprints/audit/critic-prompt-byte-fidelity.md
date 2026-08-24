# Completeness Critic & Prompt Byte Fidelity

## Target File(s)
- `olt/scripts/src/reporting/behavioral-auditor.ts` (or equivalent critic definition)
- `olt/scripts/src/summary/diff-analyzer.ts`
- `olt/scripts/src/core/contracts/packets.ts`

## Things to Look For Count
1. **Whole-Run Diff Reviews:** How original prompt requests are juxtaposed with final diffs.
2. **Byte-Level Checks:** Preventing semantic drift and partial implementations.
3. **Execution Gating:** How the critic blocks or approves the completion.

## What's Happening Here
The `completeness-critic` acts as a Tier 3 final gate. It performs a semantic alignment check, matching the original user prompt directly against the comprehensive file diffs across the entire workspace. The critic verifies that the "bytes requested" in the prompt mathematically and functionally correlate to the "bytes delivered" in the diffs, ensuring no requirements were dropped during agent iteration.

## LLM Friction Points & Implicit Assumptions
- **Subtle Drift:** LLMs often act as yes-men in critic roles, Rubber-Stamping passes unless explicit failure conditions are enforced.
- **Diff Blindness:** When the diff is large, the LLM critic might lose track of the initial prompt constraints in its attention span.

## Concrete Simplification & Improvement Blueprint
1. **Clause Decomposition:** Before the critic reviews the whole run, use a heuristic script to break the initial prompt into discrete atomic clauses. Force the critic to emit a JSON array verifying each clause individually against the diff.
2. **Mechanic Overlap:** Wire `diff-analyzer.ts` to flag modifications outside the `task.write_scope`. The critic should automatically fail any run touching un-requested files.
3. **Binary Verdict Prompting:** Re-structure the critic's system prompt to be purely adversarial, demanding it find at least one missed constraint.

# Authority & Policy Lead Audit Blueprint: Persona Grounding

## 1. Exact Findings Count
**Total Things to Look For:** 34

## 2. Call Graph & State Transition Trace
- **Entry Points:** `generateWatchdogPersonaGrounding`, `evaluateReflexiveSelfAudit`, `evaluateSupervisoryState`.
- **Callers:** Watchdog Manager, Heartbeat Ticks, Pre-Action Checks.
- **State Transitions:**
  - `evaluateReflexiveSelfAudit` -> Parses active context -> Applies 8 invariant checks (zero_file_mutation, delegated_execution_only, strict_tier_hierarchy, background_finalization, write_scope_isolation, quantitative_proof, active_wave, no_premature_completion) -> Transitions to DriftSeverity (`none` -> `low` -> `medium` -> `high` -> `critical`).
  - `evaluateSupervisoryState` -> Loads unified model -> Filters 17 standing checklists -> Applies 7 invariant rule checks -> Calculates `compliant`, `driftScore`.
  - `computeScopeOverlaps` / `findOverlappingScopes` -> O(N^2) comparison of `writeScope` arrays.

## 3. Native Host Tool Interaction
- Guides `define_subagent` and `invoke_subagent` via strict Tier spawning matrix (Tier 0 -> Tier 1 -> Tier 2 -> Tier 3). Cross-tier spawning explicitly generates a `CROSS_TIER_SPAWNING_VIOLATION`.
- Direct file mutations via `run_command` (sed, echo) or host filesystem tools by a Tier 0/1/2 agent trigger a `SUPERVISORY_FILE_MUTATION_VIOLATION`.
- `queue:wave` dispatch heavily referenced in anti-batching invariants.
- Uses schedules implicitly via `DEFAULT_HEARTBEAT_CADENCE_MS` and 5-minute crons.

## 4. Edge Cases, Failure Vectors, & LLM Friction Points
- `persona-grounding.ts:503`: File mutation check merges `context.fileModifications` and `recentActions`. LLMs outputting `edit_file` but lacking `targetFile` fallback to `"unknown_file"`, causing untracked severity spikes.
- `persona-grounding.ts:439`: `findOverlappingScopes` uses simplistic array `includes`. Does not normalize paths (e.g., `./src/foo.ts` vs `src/foo.ts`), leading to false negatives on overlapping leases.
- `supervisory-persona-reminder.ts:711`: Missing bounds check for `permittedSpawns` on empty array.
- Friction Point: Hardcoded check for `validatorReviewsAcceptedWithoutProof`. LLM agents frequently drop or misname the proof metadata key in the JSON payload, causing false drift flags.
- `supervisory-persona-reminder.ts:616`: Scope collision loop recalculates overlapping scopes repetitively on every evaluation tick, which scale poorly on massive waves.

## 5. TypeScript Refactoring Blueprints & Simplification Proposals
- **Blueprint A (Path Normalization):** Update `findOverlappingScopes` to use `node:path.resolve` or `normalize` before checking `includes`.
- **Blueprint B (Unified Violation Engine):** Merge `evaluateReflexiveSelfAudit` and `evaluateSupervisoryState` into a single class `SupervisoryComplianceEngine`. Right now, they duplicate checks for file mutation, task self-execution, and cross-tier hierarchy.
- **Blueprint C (Regex Optimization):** Standardize role checks and naming convention regexes using pre-compiled regex objects rather than `.toLowerCase().startsWith()`.

# Track 1 Implementation Plan: Mind Tasks Smart, Task Discovery & Partitioning Modular Architecture

**Target Plan File**: `docs/planning/mind-tasks-smart-and-partitioning/PLAN.md`  
**Track**: Track 1 — Mind Tasks Smart, Task Discovery & Partitioning Modular Architecture  
**Certification Status**: **CERTIFIED & APPROVED (5/5 Rounds Complete)** by `plan_critic_01`  
**Assigned Defects**:

1. `defect-mind-tasks-partitioning-syntax-errors`
2. `defect-mind-smart-task-duplicate-identifier-rebalance-tasks`
3. `defect-task-discovery-optional-observation-guard`

---

## Level 1: Problem Statement & Root Cause Analysis

### 1.1 Defect IDs & High-Level Problem Formulation

- **`defect-mind-tasks-partitioning-syntax-errors`**:
  During the modular decomposition of large monolithic mind scripts (`smart-task.ts`, `task-discovery.ts`, `proposals.ts`) into cohesive modules, intermediate chunks and split files introduced syntax anomalies (TS1005: expression expected / ';' expected, TS1128: declaration or statement expected), trailing unclosed blocks/dangling JSDoc comment stubs (such as `synthesis.ts:282-285`), and incomplete barrel re-exports across `olt/scripts/src/mind/tasks/smart/`, `olt/scripts/src/mind/tasks/discovery/`, and `olt/scripts/src/mind/proposals/`.
- **`defect-mind-smart-task-duplicate-identifier-rebalance-tasks`**:
  In early partitioning iterations, `rebalanceTasksWithBrentLimits` was defined across multiple chunk files (specifically `smart-task-chunk9.ts:104`), creating identifier collisions (TS2300: Duplicate identifier) against canonical planner exports.
- **`defect-task-discovery-optional-observation-guard`**:
  In `olt/scripts/src/mind/tasks/discovery/scanners/health-scanner.ts:239`, the guard `if (bl.observation) {` bypassed open defect entries that omit the optional `observation` property (e.g., defects that provide only `description`, `message`, or `prescribed_remediation`). This caused TS2532/TS18048 undefined property accesses, empty proposal titles, and silent defect loss during architectural health scans.

### 1.2 Exact Codebase Line Coordinates & Root Cause Grounding

- [`olt/scripts/src/mind/tasks/discovery/scanners/health-scanner.ts:237-260`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/mind/tasks/discovery/scanners/health-scanner.ts#L237-L260): Guard `if (bl.observation)` dropped open defects; `title: \`Remediate Defect: ${bl.observation?.slice(0, 50) ?? ""}\``and`statement: bl.observation` produced invalid empty or undefined properties.
- [`olt/scripts/src/mind/tasks/discovery/slices/scans.ts:153-175`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/mind/tasks/discovery/slices/scans.ts#L153-L175): Requires uniform fallback coalescence across `bl.observation`, `bl.description`, `bl.message`, and `bl.prescribed_remediation`.
- [`olt/scripts/src/mind/tasks/discovery/scanners/remediation-scanner.ts:131-158`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/mind/tasks/discovery/scanners/remediation-scanner.ts#L131-L158): `mapDefectToDiscoveryItem` must uniformly extract `desc = defect.observation ?? defect.description ?? defect.message ?? "Unspecified defect"`.
- [`olt/scripts/src/mind/tasks/smart/planner/rebalance.ts:10-116`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/mind/tasks/smart/planner/rebalance.ts#L10-L116): Canonical declaration of `rebalanceTasksWithBrentLimits` computing Work/Span metrics ($P = \lceil W/S \rceil$) and decoupling artificial dependencies. Re-exported via `planner/index.ts:105`, `smart/index.ts:87`, and `tasks/index.ts:213`.
- [`olt/scripts/src/mind/tasks/smart/executor/synthesis.ts:282-285`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/mind/tasks/smart/executor/synthesis.ts#L282-L285): Dangling JSDoc comment stub without an attached function or statement.

---

## Level 2: Architectural Constraints & Invariants

1. **Physical LOC Budget ($\le 300$ LOC/file)**: Every TypeScript source file in Track 1 is strictly $\le 300$ physical lines of code.
   - `olt/scripts/src/mind/tasks/smart/executor/evolution/self-evolution.ts`: 285 LOC
   - `olt/scripts/src/mind/tasks/smart/executor/evolution/defect-evolution.ts`: 279 LOC
   - `olt/scripts/src/mind/tasks/smart/executor/synthesis.ts`: 281 LOC (post-comment cleanup)
   - `olt/scripts/src/mind/tasks/smart/executor/product-owner.ts`: 291 LOC
   - `olt/scripts/src/mind/proposals/builder/symbols.ts`: 279 LOC
   - `olt/scripts/src/mind/tasks/discovery/scanners/health-scanner.ts`: 265 LOC
   - `olt/scripts/src/mind/tasks/discovery/scanners/remediation-scanner.ts`: 266 LOC
2. **Directory Density Budget ($\le 10$ files/directory)**:
   - `olt/scripts/src/mind/tasks/`: 1 file (`index.ts`) + 4 subdirectories
   - `olt/scripts/src/mind/tasks/discovery/`: 7 files + 2 subdirectories
   - `olt/scripts/src/mind/tasks/discovery/scanners/`: 6 files
   - `olt/scripts/src/mind/tasks/discovery/slices/`: 5 files
   - `olt/scripts/src/mind/tasks/smart/`: 1 file (`index.ts`) + 2 subdirectories
   - `olt/scripts/src/mind/tasks/smart/planner/`: 10 files
   - `olt/scripts/src/mind/tasks/smart/executor/`: 9 files + 1 subpackage directory (`evolution/`)
   - `olt/scripts/src/mind/tasks/smart/executor/evolution/`: 3 files (`index.ts`, `defect-evolution.ts`, `self-evolution.ts`)
   - `olt/scripts/src/mind/proposals/`: 1 file (`index.ts`) + 4 subdirectories
   - `olt/scripts/src/mind/proposals/brief/`: 7 files
   - `olt/scripts/src/mind/proposals/builder/`: 8 files
   - `olt/scripts/src/mind/proposals/gates/`: 6 files
   - `olt/scripts/src/mind/proposals/proposal/`: 9 files
3. **Strict Named Facades (0 Wildcard `export *`)**: Exactly 0 wildcard re-exports. Every barrel file segregates `export type { ... }` and `export { ... }` blocks with explicit symbol names.
4. **Zero Comments Policy (0 Comments in Production)**: All JSDoc blocks, line comments, and dangling stubs are purged across production source files.
5. **Zero `any` & Strict Type Safety (0 `any` / 0 Suppressions)**: 0 `any`, 0 `@ts-ignore`, 0 `@ts-expect-error`, 0 `@ts-nocheck`. Verified by static invariant tests.

---

## Level 3: 8-Vector Expansion Matrix

| Vector                       | Edge Condition / Failure Mode                                                 | Hardened Mitigation & Assertion Formula                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **V1: EMPTY_PAYLOAD**        | Empty defect findings `[]`, empty feedback queue, or empty prompt `""`        | `rebalanceTasksWithBrentLimits([])` returns 0 waves with zeroed macro metrics; `expandExternalPromptToPlan("")` throws `HarnessError("INVALID_ARGUMENT", "Prompt cannot be empty")`. |
| **V2: TIMEOUT_STAGNATION**   | Circular dependency cycle in smart task graph                                 | `planWaveExecution` performs topological cycle detection and throws `HarnessError("INTEGRITY_VIOLATION", "Circular dependency detected")`.                                           |
| **V3: CONCURRENCY_MUTATION** | Multiple tasks in a wave sharing overlapping write scopes                     | `calculateScopeCollisions` and `detectScopeOverlap` separate colliding scopes into consecutive disjoint sub-waves.                                                                   |
| **V4: HOST_BOUNDARY**        | Defect candidate or task write scope referencing paths outside repository     | `normalizeScopePath` and `isPathInRepoRoots` assert path confinement within permitted repository roots.                                                                              |
| **V5: STATE_TRANSITION**     | Illegal proposal transition attempt (e.g., `granted` $\to$ `needs_authority`) | `canTransitionProposal` enforces deterministic state machine transitions defined in `VALID_PROPOSAL_TRANSITIONS`.                                                                    |
| **V6: TYPE_INVARIANT**       | Defect entry lacking optional `observation`, `description`, or `remediation`  | Coalescence formula `desc = bl.observation ?? bl.description ?? bl.message ?? "Unspecified defect"` ensures 100% field population.                                                   |
| **V7: CLI_TELEMETRY**        | Telemetry / Macro DAG Work/Span metrics computed on empty or pruned queues    | Macro metrics default deterministically to `{ work: 0, span: 0, parallelism: 0, efficiency: 0 }` with `optimal_lanes = 1`.                                                           |
| **V8: ADVERSARIAL_GATE**     | Anti-batching bypass attempt merging multiple items into a single task plan   | `assertAntiBatchingRule` inspects `metadata.batched_feedback_ids`, `batched_candidate_ids`, and comma-delimited IDs, throwing hard error.                                            |

---

## Level 4: Disjoint Write Scope Decomposition

### Write Scope 1: Discovery Scanners & Slices

- **Files**:
  - `olt/scripts/src/mind/tasks/discovery/scanners/health-scanner.ts` (lines 237–260)
  - `olt/scripts/src/mind/tasks/discovery/slices/scans.ts` (lines 153–175)
  - `olt/scripts/src/mind/tasks/discovery/scanners/remediation-scanner.ts` (lines 131–158)
- **Modifications**:
  - Replace `if (bl.observation)` with loop over all open defects.
  - Coalesce: `const desc = bl.observation ?? bl.description ?? bl.message ?? "Unspecified defect";`
  - Coalesce: `const remediation = bl.remediation ?? bl.prescribed_remediation ?? "Fix root cause of defect with regression immunity";`
  - Set proposal `title: \`Remediate Defect: ${desc.slice(0, 50)}\``, `statement: desc`, and `rationale: remediation`.

### Write Scope 2: Smart Planner & Brent Rebalance Facades

- **Files**:
  - `olt/scripts/src/mind/tasks/smart/planner/rebalance.ts` (lines 10–174)
  - `olt/scripts/src/mind/tasks/smart/planner/index.ts` (lines 104–108)
  - `olt/scripts/src/mind/tasks/smart/index.ts` (line 87)
  - `olt/scripts/src/mind/tasks/index.ts` (line 213)
- **Modifications**:
  - Canonical declaration of `rebalanceTasksWithBrentLimits` at `rebalance.ts:10-116`.
  - Canonical named re-exports in planner, smart, and tasks barrel index files (0 duplicate declarations).

### Write Scope 3: Smart Executor Subpackaging & Synthesis Comment Purge

- **Files**:
  - `olt/scripts/src/mind/tasks/smart/executor/synthesis.ts` (lines 41–47, 135, 215, 282–285 purged)
  - `olt/scripts/src/mind/tasks/smart/executor/invariants.ts` (comments purged)
  - `olt/scripts/src/mind/tasks/smart/executor/evolution/index.ts` (created subpackage facade)
  - `olt/scripts/src/mind/tasks/smart/executor/evolution/defect-evolution.ts` (moved from `evolution.ts`)
  - `olt/scripts/src/mind/tasks/smart/executor/evolution/self-evolution.ts` (moved from `self-evolution.ts`)
  - `olt/scripts/src/mind/tasks/smart/executor/index.ts` (lines 1–8 updated to import from `./evolution/index.ts`)

### Write Scope 4: Proposals Modular Barrels & Lifecycles

- **Files**:
  - `olt/scripts/src/mind/proposals/index.ts` (lines 1–129)
  - `olt/scripts/src/mind/proposals/brief/index.ts`
  - `olt/scripts/src/mind/proposals/builder/index.ts`
  - `olt/scripts/src/mind/proposals/gates/index.ts`
  - `olt/scripts/src/mind/proposals/proposal/index.ts`
- **Modifications**:
  - Verified 100% explicit named exports (zero wildcard exports, zero dangling tokens).

---

## Level 5: Topological Execution DAG & Brent Concurrency Waves

- **Total Work Units ($W$)**: 4
- **Critical Span ($S$)**: 2
- **Parallel Concurrency ($P = \lceil W/S \rceil$)**: 2 lanes

```
Wave 1 (Independent Leaf Hardening & Refactoring):
  ├── Task 1.1: Discovery Scanners Observation Guard Hardening [health-scanner.ts, scans.ts, remediation-scanner.ts]
  └── Task 1.2: Executor Subpackaging & Synthesis Comment Purge [synthesis.ts, evolution/, executor/index.ts]

Wave 2 (Barrel Lineage Alignment & Invariant Certification):
  ├── Task 2.1: Brent Rebalance Canonical Facade Alignment [rebalance.ts, planner/index.ts, smart/index.ts, tasks/index.ts]
  └── Task 2.2: Proposals Barrel Facade Integrity Audit [proposals/index.ts, builder/, gates/]
```

---

## Level 6: Fast Incremental Verification Gates

```bash
# Gate 1: Property Guards & Defect Discovery Unit Verification
bun test tests/unit/mind/discovery/task-discovery-property-guards.test.ts

# Gate 2: Architectural Health Scanner & Discovery Engine
bun test tests/unit/mind/health-scanner.test.ts
bun test tests/unit/mind/discovery-engine.test.ts

# Gate 3: Smart Task Manager, Anti-Batching, Rebalance & 0-Any Invariants
bun test tests/unit/mind/smart-task-manager.test.ts

# Gate 4: Smart Task Orchestration, Priorities & Atomic Dispatch
bun test tests/unit/mind/smart-tasks-execute-atomic-dispatch.test.ts
bun test tests/unit/mind/smart-tasks-orchestrator.test.ts
bun test tests/unit/mind/smart-tasks-synthesize-priorities.test.ts

# Gate 5: Proposals Barrel Facades & Lifecycle Gates
bun test tests/unit/mind/proposals-barrel.test.ts
bun test tests/unit/mind/proposals.test.ts

# Gate 6: Repository-Wide Strict TypeScript Typecheck
bun run typecheck
```

---

## Level 7: Adversarial Counterfactual Falsifiability Probes (AGP)

1. **Probe AGP-1 (Observation Omission Resilience)**:
   - _Hypothesis_: An open defect entry `{ id: "def-edge", status: "open", description: "Edge flaw" }` lacking `observation` must generate a valid proposal in `scanArchitecturalHealth`.
   - _Proof_: Verified by `task-discovery-property-guards.test.ts:30-41` and `health-scanner.test.ts`. `desc = bl.description` ensures `cand-evo-defect-def-edge` is emitted with non-empty `statement` and `title`.
2. **Probe AGP-2 (Duplicate Rebalance Declaration Prevention)**:
   - _Hypothesis_: No duplicate symbol declarations of `rebalanceTasksWithBrentLimits` exist across any chunk files or barrel exports.
   - _Proof_: `bun run typecheck` produces 0 duplicate identifier errors (TS2300).
3. **Probe AGP-3 (Anti-Batching Strict Isolation)**:
   - _Hypothesis_: Any attempt to merge multiple feedbacks into one smart task plan fails immediately.
   - _Proof_: `assertAntiBatchingRule` throws `Anti-Batching Rule violation` when `batched_feedback_ids` or `batched_candidate_ids` are present. Proven by `smart-task-manager.test.ts:124-148`.
4. **Probe AGP-4 (Zero Any & Suppressions Static Invariant)**:
   - _Hypothesis_: No `any` type or compiler suppression directives exist across leased files.
   - _Proof_: Verified by `smart-task-manager.test.ts:1054-1088` line-by-line regex scanning.

---

## Level 8: Sealing, Release, & Turn 1 Zero-Exploration Readiness Briefing

- **Target Files & Anchors**: Disjoint write scopes identified with exact line numbers and symbol signatures.
- **Dependency Flow**: Clean linear DAG with 0 circular dependencies.
- **Verification Readiness**: All 6 verification gates runnable immediately with exit code 0.
- **Certified By**: `plan_critic_01` (Official Executive Certification: Round 5 Approved).

# Track 07 Implementation Plan: Mind Lifecycle and Validation Exports (ARCHIVED)

**Cluster Path**: `docs/planning/mind-lifecycle-and-validation-exports/PLAN.md`  
**Archived Path**: `docs/archive/completed-plans/mind-lifecycle-and-validation-exports/PLAN.md`  
**Track**: Track 07  
**Target Subsystems**: `olt/scripts/src/mind/lifecycle/deploy/`, `olt/scripts/src/mind/tasks/smart/`, `olt/scripts/src/cli/commands/`, `olt/scripts/src/validation/`  
**Defect IDs**:

- `defect-mind-lifecycle-deploy-missing-export`
- `defect-mind-tasks-smart-duplicate-export-atomic-admission`
- `defect-mind-smart-task-missing-map-feedback-priority`
- `defect-skill-audit-live-missing-analyze-run-forensics`
- `defect-validation-index-missing-mutation-candidate-export`

---

## Level 1: Problem Statement, Defect IDs & Root Cause Analysis

### 1.1 Defect 1: `defect-mind-lifecycle-deploy-missing-export`

- **Symptom & Description**:
  Downstream barrels (`mind/lifecycle/index.ts`, `mind/archival/index.ts`, `mind/lifecycle/pulse/index.ts`) import `deployHierarchy` from `../lifecycle/deploy/index.ts`.
- **Exact Codebase Resolution**:
  - `olt/scripts/src/mind/lifecycle/deploy/index.ts`: Line 21 exports `buildTier1DeploymentPacket as deployHierarchy` and Line 27 exports `atomicAdmissionToDispatch, enforceIsolatedTaskDispatch`.

### 1.2 Defect 2: `defect-mind-tasks-smart-duplicate-export-atomic-admission`

- **Symptom & Description**:
  Exporting `atomicAdmissionToDispatch` across both smart tasks and deploy lifecycle modules creates name collision and cross-layer coupling.
- **Exact Codebase Resolution**:
  - `olt/scripts/src/mind/lifecycle/deploy/types.ts:259`: Canonical location of `atomicAdmissionToDispatch(candidateId: string): boolean`.
  - `olt/scripts/src/mind/tasks/smart/executor/dispatch.ts:35`: Canonical location of `executeAtomicAdmissionToDispatch(options?: AtomicDispatchOptions): AdmissionToDispatchResult`.
  - `olt/scripts/src/mind/tasks/smart/index.ts:113`: Clean export of `executeAtomicAdmissionToDispatch` and `executeAtomicDispatch` with 0 duplicate collisions.

### 1.3 Defect 3: `defect-mind-smart-task-missing-map-feedback-priority`

- **Symptom & Description**:
  Undeclared identifier `mapFeedbackPriorityToTaskPriority` in historical chunk files (`smart-task-chunk9.ts:193`) and missing export from smart tasks executor facade.
- **Exact Codebase Resolution**:
  - `olt/scripts/src/mind/tasks/smart/executor/orchestrator.ts:177`: Implements `mapFeedbackPriorityToTaskPriority(fbPriority: string): TaskPriority`.
  - `olt/scripts/src/mind/tasks/smart/executor/index.ts:23`: Exported `mapFeedbackPriorityToTaskPriority`.
  - `olt/scripts/src/mind/tasks/smart/index.ts:106`: Re-exported `mapFeedbackPriorityToTaskPriority`.

### 1.4 Defect 4: `defect-skill-audit-live-missing-analyze-run-forensics`

- **Symptom & Description**:
  ReferenceError `analyzeRunForensics is not defined` when running skill audit diagnostics in standalone un-imported command contexts.
- **Exact Codebase Resolution**:
  - `olt/scripts/src/mind/auditing/meta/index.ts`: Canonical export for `analyzeRunForensics`.
  - `olt/scripts/src/mind/auditing/cognitive/skill-auditor.ts:10-13`: Explicitly imports `analyzeRunForensics`, `ForensicsIncident`, `RootCauseCategory` from `../meta/index.ts`.
  - `olt/scripts/src/cli/commands/skill-audit-live.ts:3`: Cleanly delegates to `SkillAuditorEngine.auditSkillCompliance`.

### 1.5 Defect 5: `defect-validation-index-missing-mutation-candidate-export`

- **Symptom & Description**:
  Missing exported member `MutationCandidate` from the root validation facade `olt/scripts/src/validation/index.ts`.
- **Exact Codebase Resolution**:
  - `olt/scripts/src/validation/anti-mock/anti-mock-types.ts:87`: Defines `export interface MutationCandidate { ... }`.
  - `olt/scripts/src/validation/mutation-gate/types.ts:4` & `index.ts:4`: Re-exports `type MutationCandidate`.
  - `olt/scripts/src/validation/index.ts:139`: Re-exports `type MutationCandidate` from `./mutation-gate/index.ts`.

---

## Level 2: Architectural Constraints & Invariants

1. **File Line Budget**: Every production `.ts` file strictly $\le 300$ physical lines.
2. **Directory Density Budget**: Every directory strictly $\le 10$ direct files (excluding subdirectories).
3. **Named Facades Invariant**: 0 wildcard `export *` statements; all exports are explicitly named.
4. **Type Safety Invariant**: 0 `any` / 0 `@ts-ignore` / 0 `@ts-expect-error`.
5. **Code Cleanliness Invariant**: 0 code comments in newly authored facade exports.
6. **Domain-Semantic Naming Invariant**: Explicit, domain-grounded identifiers.

---

## Level 3: 8-Vector Expansion Matrix

| Vector                   | Codebase Grounding            | Exact Target Mechanism                                                                                               |
| :----------------------- | :---------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| **EMPTY_PAYLOAD**        | Empty Feedback Intake         | `dispatch.ts:44-53`: When `targetFeedbacks.length === 0`, returns empty task arrays with valid invariant report.     |
| **TIMEOUT_STAGNATION**   | Wall-Clock Floor              | `builder.ts:274`: Floors remaining wall clock budget at `60_000 ms` to avoid zero/negative deadlines.                |
| **CONCURRENCY_MUTATION** | Transactional Dispatch States | `dispatch.ts:86-136`: State progression `PENDING -> PREPARED -> COMMITTED / ADMITTED` prevents duplicate dispatches. |
| **HOST_BOUNDARY**        | Zero Model Telemetry          | `builder.ts:34-61`: `assertNoModelTelemetry` throws `HarnessError("INVALID_ARGUMENT")` on prohibited patterns.       |
| **STATE_TRANSITION**     | Strict 4-Tier Hierarchy       | `types.ts:70-136`: `validateTierSpawn` enforces Mind Tier 0 can ONLY spawn Orchestrator Tier 1.                      |
| **TYPE_INVARIANT**       | Priority Mapping              | `orchestrator.ts:177-192`: Exhaustively maps `FeedbackPriority` to `TaskPriority`.                                   |
| **CLI_TELEMETRY**        | Formatted Output Bound        | `cli/commands/skill-audit-live.ts:43`: Enforces $\le 30$ line limit via `enforceLineLimit`.                          |
| **ADVERSARIAL_GATE**     | Mutation Candidate Contract   | `anti-mock-types.ts:87-98`: Enforces valid `MutationCandidate` contracts for AST mutator testing.                    |

---

## Level 4: Execution & Verification Evidence

All 9 fast verification gates were executed and confirmed passing:

- **GATE-1**: `bun test tests/unit/mind/hierarchy-deploy.test.ts` (13 pass)
- **GATE-2**: `bun test tests/unit/mind/smart-tasks-orchestrator.test.ts` (7 pass)
- **GATE-3**: `bun test tests/unit/mind/health-scanner.test.ts` (9 pass)
- **GATE-4**: `bun test tests/unit/mind/smart-task-manager.test.ts` (28 pass)
- **GATE-5**: `bun test tests/unit/validation/anti-mock/anti-mock-types-exports.test.ts` (5 pass)
- **GATE-6**: `bun test tests/unit/validation/mutation-gate.test.ts` (13 pass)
- **GATE-7**: `bun test tests/integration/cognitive-auditors-e2e.test.ts` (7 pass)
- **GATE-8**: `bun run typecheck` (0 errors)
- **GATE-9**: `bun scripts/modularity/check.ts --mode ratchet` (0 new violations)

---

## Level 5: 5-Round Validator Certification Record

- **Validator**: validator_07 (`62c9405c-d1c9-4a10-bc46-b1aecf1e2416`)
- **Implementers**: `implementer_13` (`21358eb2-d4d0-4ecc-87fb-9e0dd8ce2be9`), `implementer_14` (`ff63b8cd-30d7-4ab2-845c-6dd4a992f8bc`)
- **Certification Rounds**:
  - **Round 1 (Contract, Interfaces & Architecture Compliance)**: CERTIFIED PASS
  - **Round 2 (Boundary Conditions, Error Handling & Edge Cases)**: CERTIFIED PASS
  - **Round 3 (Monorepo Density & Static Cleanliness)**: CERTIFIED PASS
  - **Round 4 (Test Coverage, Mock Purity & Performance)**: CERTIFIED PASS
  - **Round 5 (Final Verification, Falsifiability Probes & Release Sign-Off)**: CERTIFIED PASS
- **Commit Hash**: `cd083743` on branch `feat/track-07-mind-lifecycle`
- **Release Status**: ARCHIVED & COMPLETED

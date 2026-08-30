# Track 7 / Track 10 Implementation Plan: Engine Store and Scheduler Barrels Stabilization (Completed & Certified)

**Target Artifact**: `docs/archive/completed-plans/engine-store-and-scheduler-barrels/PLAN.md`  
**Plan Drafter**: `plan_drafter_05`  
**Plan Critic**: `plan_critic_05`  
**Implementer**: `implementer_19`  
**Validator**: `validator_10` (5/5 Review Rounds Passed - Certified)  
**Assigned Defect IDs**: `defect-engine-store-barrel-unresolved-subdirectories`, `defect-engine-scheduler-core-export-types-as-values`, `defect-engine-store-unresolved-write-blob-export`, `defect-workflow-integrity-evidence-unresolved-store-import`  
**Certification Status**: Certified by `validator_10` (5/5 Review Rounds Passed)

---

## 5-Round Adversarial Validation Execution Report

| Round | Review Dimension | Focus Area | Verdict |
| :---: | :--- | :--- | :---: |
| **1** | **Contract & Architecture Compliance** | Named directory re-exports, pure type exports, blob write contract, integrity evidence resolution | **CERTIFIED PASS** |
| **2** | **Boundary Conditions & Error Handling** | Zero-byte files, concurrency safety, 256MB limits, non-regular file guards, path traversal defense | **CERTIFIED PASS** |
| **3** | **Monorepo Density & AST Invariants** | $\le$ 300 LOC/file, $\le$ 10 items/dir, zero `any`, zero suppressions, zero comments | **CERTIFIED PASS** |
| **4** | **Test Coverage & Mock Purity** | 99 passing tests, scratch root isolation, spy cleanup, $O(1)$ streaming performance | **CERTIFIED PASS** |
| **5** | **Final Certification & Release Sign-Off** | Release manifest, branch sealing, and end-to-end invariant validation | **CERTIFIED PASS** |

---

## Level 1: Problem Statement, Defect IDs, & Root Cause Analysis

### 1.1 Problem Statement & Background

Track 7 / Track 10 focuses on repairing, certifying, and sealing module resolution and export contracts across the core engine store, scheduler barrels, blob storage APIs, and workflow completion integrity evidence:

1. **Engine Store Barrel Modularization & Resolution (`defect-engine-store-barrel-unresolved-subdirectories`)**:
   Following directory partitioning into `capsule/`, `recovery/`, `events/`, `integrity/`, `projections/`, `layout/`, and `hierarchy/`, `olt/scripts/src/engine/store/index.ts` maintains 100% explicit named exports pointing to valid subdirectory paths (`./capsule/capsule.ts`, `./recovery/recovery.ts`, `./events/transaction.ts`, `./integrity/integrity.ts`, `./projections/materialized-projections.ts`, `./layout/blobs.ts`, `./hierarchy/storage-paths.ts`), eliminating any stale flat relative paths and ensuring zero runtime import errors.
2. **Scheduler Core Type Export Syntax (`defect-engine-scheduler-core-export-types-as-values`)**:
   In `olt/scripts/src/engine/scheduler/core/index.ts`, all TypeScript interfaces/types (`GraphHealthIssue`, `OrphanedTasksProbeResult`, `StaleLeaseInfo`, `StaleLeasesProbeResult`, `CircularDependenciesProbeResult`, `GateCoverageProbeResult`, `ScopeCollisionHazard`, `ScopeCollisionProbeResult`, `GraphHealthAuditReport`, `SupervisoryWatchdogAuditReport`, `PulseLoopOptions`) are strictly exported using `export type { ... }` to prevent bundler runtime erasure crashes.
3. **Blob Write API Export Integrity (`defect-engine-store-unresolved-write-blob-export`)**:
   In `olt/scripts/src/engine/store/layout/blobs.ts` and `olt/scripts/src/engine/store/index.ts`, `writeBlob` (value function) and `BlobWriteResult` (type alias) are explicitly exported and re-exported.
4. **Workflow Completion Integrity Evidence Resolution (`defect-workflow-integrity-evidence-unresolved-store-import`)**:
   In `olt/scripts/src/workflow/completion/integrity-evidence.ts`, `verifyIntegrity` imports directly from `../../engine/store/index.ts` to evaluate capsule layout, manifest, event stream, and state projection integrity.

---

## Level 2: Architectural Constraints & Invariants

1. **File Density Budget**: <= 300 physical lines of code per TypeScript file.
   - `olt/scripts/src/engine/store/index.ts`: 163 lines (<= 300 LOC).
   - `olt/scripts/src/engine/scheduler/core/index.ts`: 73 lines (<= 300 LOC).
   - `olt/scripts/src/engine/store/layout/blobs.ts`: 237 lines (<= 300 LOC).
   - `olt/scripts/src/workflow/completion/integrity-evidence.ts`: 25 lines (<= 300 LOC).
2. **Directory Density Budget**: <= 10 files per directory.
   - `engine/store/`: 8 subdirectories + 1 file = 9 items (<= 10 limit).
   - `engine/store/capsule/`: 9 files (<= 10 limit).
   - `engine/store/recovery/`: 5 files (<= 10 limit).
   - `engine/store/events/`: 6 files (<= 10 limit).
   - `engine/store/integrity/`: 4 files (<= 10 limit).
   - `engine/store/projections/`: 3 files (<= 10 limit).
   - `engine/store/layout/`: 9 files (<= 10 limit).
   - `engine/store/hierarchy/`: 8 files (<= 10 limit).
   - `engine/scheduler/core/`: 7 files + 1 subfolder = 8 items (<= 10 limit).
3. **Facade Export Invariant**: 0 wildcard `export *` statements across all facade files; 100% explicit named exports.
4. **Type Safety**: 0 TypeScript `any` types; 0 `@ts-ignore` / `@ts-expect-error` / `eslint-disable` suppressions; `export type` used strictly for interface/type re-exports.
5. **Code Hygiene**: 0 code comments in TypeScript files (`//`, `/* */`, `/** */`).
6. **Domain-Semantic Naming**: Strict kebab-case filenames and explicit domain-bound function exports.

---

## Level 3: Verification Results

- `bun test tests/unit/store/capsule/blobs.test.ts`: PASS (23 tests)
- `tests/unit/store/layout/layout-integrity.test.ts`: PASS (16 tests)
- `tests/unit/scheduler/core/core-engine.test.ts`: PASS (11 tests)
- `tests/unit/scheduler/core/core-engine-probes.test.ts`: PASS (18 tests)
- `tests/unit/workflow/completion/readiness-issues.test.ts`: PASS (6 tests)
- `tests/unit/validation/coding-conventions.test.ts`: PASS (18 tests)
- `tests/unit/architecture/file-size.test.ts`: PASS (7 tests)
- Total Suite: **99 passed**, 0 failed
- `tsc -p tsconfig.json --noEmit`: Clean exit code 0

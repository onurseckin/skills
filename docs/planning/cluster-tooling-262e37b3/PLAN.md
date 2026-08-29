# Tooling Continuous Pre-Planning Domain Cluster Master Plan

> **Tracking ID:** `fb-cluster-tooling-262e37b3`  
> **Status:** `PHASE 1 - EXHAUSTIVE ARCHITECTURAL SPECIFICATION & TASK BREAKDOWN`  
> **Target Subsystems:** `olt/scripts/src/tooling/`, `tests/unit/tooling/`  
> **Author:** Tier 0 Strategic Mind Supervisor & Infinite Product Owner  
> **Created:** 2026-08-29

---

## 1. Executive Summary & The Assembly Pipeline Vision

This Phase 1 blueprint coordinates the implementation of the TOOLING domain cluster.
It addresses 0 backlog requirement(s) and 9 defect remediation(s) under the zero-idle asynchronous pre-planning pipeline.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                    TOOLING DOMAIN ARCHITECTURAL ASSEMBLY MATRIX                             │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│  Cluster ID: cluster-tooling-262e37b3                                                    │
│  Planned At: 2026-08-29T15:05:58.831Z                                                    │
│  Backlog Count: 0                                                                        │
│  Defect Count:  9                                                                        │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Architectural Pillars & Design Specifications

1. **Zero TypeScript `any` & Zero Suppressions**: Strictly enforced across all domain components.
2. **Subdomain Git Staging Invariant (Reflog Safety)**: Execute `git add -A` upon task verification.
3. **5-Minute Straggler SLA**: Partition any work exceeding 300s into parallel subagents ($P = \lceil W/S \rceil$).
4. **Deterministic Traceability**: Every requirement and defect maps to verified unit and integration tests.

---

## 3. Work Breakdown & Disjoint Task Specifications

### Task 1.1: Defect Remediation: Unresolved import '../../engine/scheduler/core-engine.ts' in cli/commands/watchdog-ops.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-watchdog-ops-unresolved-core-engine-import` (Error Code: `UNRESOLVED_MODULE_IMPORT_IN_CLI`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-watchdog-ops-unresolved-core-engine-import.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/cli/commands/watchdog-ops.ts imports '../../engine/scheduler/core-engine.ts', which was moved to engine/scheduler/core/ without a facade export.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/tooling/defect-cli-watchdog-ops-unresolved-core-engine-import.test.ts` (100% PASS).

### Task 1.2: Defect Remediation: Type mismatches with exactOptionalPropertyTypes in autonomic-watchdog and time-telemetry

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-exact-optional-property-types-in-watchdog-and-telemetry` (Error Code: `EXACT_OPTIONAL_PROPERTY_TYPE_MISMATCH`)
- **Write Scope:** `olt/scripts/src/tooling/defect-exact-optional-property-types-in-watchdog-and-telemetry.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: watchdog/autonomic-watchdog/watchdog-engine.ts (TS2412) and reporting/time-telemetry/collector.ts (TS2379) pass 'type | undefined' to exact optional properties, triggering TypeScript compilation errors.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/tooling/defect-exact-optional-property-types-in-watchdog-and-telemetry.test.ts` (100% PASS).

### Task 1.3: Defect Remediation: Type 'SugiyamaDagReport' declared locally in reporting/unified/types.ts but not exported

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-reporting-unified-sections-missing-sugiyama-export` (Error Code: `UNEXPORTED_TYPE_DECLARATION`)
- **Write Scope:** `olt/scripts/src/tooling/defect-reporting-unified-sections-missing-sugiyama-export.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/reporting/unified/sections.ts imports SugiyamaDagReport from './types.ts', but types.ts does not export SugiyamaDagReport.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/tooling/defect-reporting-unified-sections-missing-sugiyama-export.test.ts` (100% PASS).

### Task 1.4: Defect Remediation: SyntaxError exporting TypeScript interfaces as runtime values in engine/scheduler/core/index.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-engine-scheduler-core-export-types-as-values` (Error Code: `SYNTAX_ERROR_TYPE_EXPORT_AS_VALUE`)
- **Write Scope:** `olt/scripts/src/tooling/defect-engine-scheduler-core-export-types-as-values.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: engine/scheduler/core/index.ts exports TypeScript interfaces (GraphHealthIssue, OrphanedTasksProbeResult, etc.) using 'export { ... } from "./types.ts"' instead of 'export type { ... }', causing Bun runtime SyntaxError.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/tooling/defect-engine-scheduler-core-export-types-as-values.test.ts` (100% PASS).

### Task 1.5: Defect Remediation: SyntaxError: export 'writeBlob' not found in './layout/blobs.ts' in engine/store/index.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-engine-store-unresolved-write-blob-export` (Error Code: `UNEXPORTED_MEMBER_IN_BARREL`)
- **Write Scope:** `olt/scripts/src/tooling/defect-engine-store-unresolved-write-blob-export.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: engine/store/index.ts re-exports writeBlob and BlobWriteResult from ./layout/blobs.ts, which does not declare or export writeBlob. This causes a Bun runtime SyntaxError when loading harness CLI commands.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/tooling/defect-engine-store-unresolved-write-blob-export.test.ts` (100% PASS).

### Task 1.6: Defect Remediation: Unresolved import '../../engine/store/index.ts' in workflow/completion/integrity-evidence.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-workflow-integrity-evidence-unresolved-store-import` (Error Code: `UNRESOLVED_MODULE_IMPORT_IN_WORKFLOW`)
- **Write Scope:** `olt/scripts/src/tooling/defect-workflow-integrity-evidence-unresolved-store-import.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/workflow/completion/integrity-evidence.ts attempts to import from non-existent '../../engine/store/index.ts' after store modularization.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/tooling/defect-workflow-integrity-evidence-unresolved-store-import.test.ts` (100% PASS).

### Task 1.7: Defect Remediation: Missing exported member 'ReplayContext' in reporting/living-tracer/types.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-living-tracer-unresolved-replay-context` (Error Code: `UNEXPORTED_MEMBER_IMPORT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-living-tracer-unresolved-replay-context.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/reporting/living-tracer/task-state-transitions.ts imports 'ReplayContext' from './types.ts' which does not declare or export it, and references undeclared identifier 'role'.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/tooling/defect-living-tracer-unresolved-replay-context.test.ts` (100% PASS).

### Task 1.8: Defect Remediation: Stale imports after engine/runner/models directory modularization

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-engine-runner-models-modularization-import-paths` (Error Code: `UNRESOLVED_MODULE_IMPORT_AFTER_REFACTOR`)
- **Write Scope:** `olt/scripts/src/tooling/defect-engine-runner-models-modularization-import-paths.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: engine/runner/models files were moved into attempt/, command/, and execution/ subdirectories. Callers in workflow/completion/, workflow/gates/, workflow/review/, and integration/ fail to resolve old flat model paths.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/tooling/defect-engine-runner-models-modularization-import-paths.test.ts` (100% PASS).

### Task 1.9: Defect Remediation: Orchestrator and worker subagents auto-terminating upon task completion without enforcing commits, upstream push, and global skill sync

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-subagent-premature-termination-without-commit-push` (Error Code: `PREMATURE_TERMINATION_WITHOUT_COMMIT_PUSH`)
- **Write Scope:** `olt/scripts/src/tooling/defect-subagent-premature-termination-without-commit-push.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Subagents and Tier 1 Orchestrators have historically terminated or been killed upon completing task logic without executing the mandatory end-of-run release pipeline: (1) Verification receipt generation, (2) Conventional Commit, (3) Git push to origin/main, and (4) Global skill sync via scripts/sync-global.ts. This leaves uncommitted working-tree modifications vulnerable to local terminal crashes and session resets. Fix required: Establish a hard pre-termination release gate in the orchestrator lifecycle that blocks subagent teardown until git commits, push to main, and global sync have verified exit code 0.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/tooling/defect-subagent-premature-termination-without-commit-push.test.ts` (100% PASS).

---

## 4. Sequential Execution Order & Critical Path

```text
Execution Order: [Task 1.1] ──► [Verification] ──► [Git Staging: git add -A] ──► [Landing]
```

---

## 5. Exhaustive Traceability Matrix

| Defect / Backlog ID | Resolved By Task | Verification Test File |
| :--- | :--- | :--- |
| `defect-cli-watchdog-ops-unresolved-core-engine-import` | Task 1.x | `tests/unit/tooling/defect-cli-watchdog-ops-unresolved-core-engine-import.test.ts` |
| `defect-exact-optional-property-types-in-watchdog-and-telemetry` | Task 1.x | `tests/unit/tooling/defect-exact-optional-property-types-in-watchdog-and-telemetry.test.ts` |
| `defect-reporting-unified-sections-missing-sugiyama-export` | Task 1.x | `tests/unit/tooling/defect-reporting-unified-sections-missing-sugiyama-export.test.ts` |
| `defect-engine-scheduler-core-export-types-as-values` | Task 1.x | `tests/unit/tooling/defect-engine-scheduler-core-export-types-as-values.test.ts` |
| `defect-engine-store-unresolved-write-blob-export` | Task 1.x | `tests/unit/tooling/defect-engine-store-unresolved-write-blob-export.test.ts` |
| `defect-workflow-integrity-evidence-unresolved-store-import` | Task 1.x | `tests/unit/tooling/defect-workflow-integrity-evidence-unresolved-store-import.test.ts` |
| `defect-living-tracer-unresolved-replay-context` | Task 1.x | `tests/unit/tooling/defect-living-tracer-unresolved-replay-context.test.ts` |
| `defect-engine-runner-models-modularization-import-paths` | Task 1.x | `tests/unit/tooling/defect-engine-runner-models-modularization-import-paths.test.ts` |
| `defect-subagent-premature-termination-without-commit-push` | Task 1.x | `tests/unit/tooling/defect-subagent-premature-termination-without-commit-push.test.ts` |

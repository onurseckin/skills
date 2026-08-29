# Engine Continuous Pre-Planning Domain Cluster Master Plan

> **Tracking ID:** `fb-cluster-engine-794ff920`  
> **Status:** `PHASE 1 - EXHAUSTIVE ARCHITECTURAL SPECIFICATION & TASK BREAKDOWN`  
> **Target Subsystems:** `olt/scripts/src/engine/`, `tests/unit/engine/`  
> **Author:** Tier 0 Strategic Mind Supervisor & Infinite Product Owner  
> **Created:** 2026-08-29

---

## 1. Executive Summary & The Assembly Pipeline Vision

This Phase 1 blueprint coordinates the implementation of the ENGINE domain cluster.
It addresses 0 backlog requirement(s) and 9 defect remediation(s) under the zero-idle asynchronous pre-planning pipeline.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                    ENGINE DOMAIN ARCHITECTURAL ASSEMBLY MATRIX                             │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│  Cluster ID: cluster-engine-794ff920                                                     │
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

### Task 1.1: Defect Remediation: Stale flat module paths in engine/store/index.ts barrel exports after directory modularization

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-engine-store-barrel-unresolved-subdirectories` (Error Code: `UNRESOLVED_MODULE_IMPORT_IN_STORE`)
- **Write Scope:** `olt/scripts/src/engine/defect-engine-store-barrel-unresolved-subdirectories.ts`
- **Read-Only Scope:** `olt/scripts/src/engine/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: engine/store/index.ts attempts flat imports ('./capsule.ts', './load.ts', './recovery.ts', './transaction.ts', './event-append.ts', './integrity.ts', './layout-integrity.ts', './materialized-projections.ts', './capsule-index.ts', './defect-store.ts') after files were moved into nested subdirectories (capsule/, recovery/, events/, integrity/, projections/).
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/engine/defect-engine-store-barrel-unresolved-subdirectories.test.ts` (100% PASS).

### Task 1.2: Defect Remediation: Stale relative import to capsule-chainer in rotate-chunk1.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-archival-rotate-stale-relative-import` (Error Code: `UNRESOLVED_RELATIVE_MODULE_IMPORT`)
- **Write Scope:** `olt/scripts/src/engine/defect-mind-archival-rotate-stale-relative-import.ts`
- **Read-Only Scope:** `olt/scripts/src/engine/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: rotate-chunk1.ts imports '../../../engine/orchestrator/capsule-chainer.ts' which does not exist at that relative path depth.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/engine/defect-mind-archival-rotate-stale-relative-import.test.ts` (100% PASS).

### Task 1.3: Defect Remediation: Monolithic multi-subsystem bundling in docs/planning/central-repo-policy-json-engine/PLAN.md

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-plan-granularity-monolithic-central-policy` (Error Code: `MONOLITHIC_PLAN_DEFECT`)
- **Write Scope:** `olt/scripts/src/engine/defect-plan-granularity-monolithic-central-policy.ts`
- **Read-Only Scope:** `olt/scripts/src/engine/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Plan "Central Authoritative Policy JSON Configuration Engine" bundles 5 orthogonal subsystems (Platform host autodetect, RBAC policy engine, Docker health & capture profiles, Pushback quotas, Policy doctor diagnostics) into a single monolithic plan. Requires decomposition into atomic sub-plans.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/engine/defect-plan-granularity-monolithic-central-policy.test.ts` (100% PASS).

### Task 1.4: Defect Remediation: Plan scope exceeds 5-Minute Execution SLA (>3 files) in docs/planning/central-repo-policy-json-engine/PLAN.md

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-plan-granularity-straggler-central-policy` (Error Code: `STRAGGLER_PLAN_DEFECT`)
- **Write Scope:** `olt/scripts/src/engine/defect-plan-granularity-straggler-central-policy.ts`
- **Read-Only Scope:** `olt/scripts/src/engine/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Plan "Central Authoritative Policy JSON Configuration Engine" spans 23 files without sub-plan partitioning, violating the <=3 files per sub-plan invariant and exceeding the 5-Minute Execution SLA.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/engine/defect-plan-granularity-straggler-central-policy.test.ts` (100% PASS).

### Task 1.5: Defect Remediation: Plan scope exceeds 5-Minute Execution SLA (>3 files) in docs/planning/documentation-orchestrator-engine/PLAN.md

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-plan-granularity-straggler-docs-orchestrator` (Error Code: `STRAGGLER_PLAN_DEFECT`)
- **Write Scope:** `olt/scripts/src/engine/defect-plan-granularity-straggler-docs-orchestrator.ts`
- **Read-Only Scope:** `olt/scripts/src/engine/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Plan "Dedicated Documentation Orchestrator Engine" spans 19 files without sub-plan partitioning, violating the <=3 files per sub-plan invariant and exceeding the 5-Minute Execution SLA.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/engine/defect-plan-granularity-straggler-docs-orchestrator.test.ts` (100% PASS).

### Task 1.6: Defect Remediation: Monolithic multi-subsystem bundling in docs/planning/unified-master-doctor-engine/PLAN.md

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-plan-granularity-monolithic-master-doctor` (Error Code: `MONOLITHIC_PLAN_DEFECT`)
- **Write Scope:** `olt/scripts/src/engine/defect-plan-granularity-monolithic-master-doctor.ts`
- **Read-Only Scope:** `olt/scripts/src/engine/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Plan "Unified Master Doctor Engine, Auto-Healing & Flock-Locked Defect Lifecycle" bundles 8 orthogonal subsystems (Auto-heal quarantine, Lock cleaner & lease recovery, Root hygiene, Git index engine, AST purity engine, Planning DAG engine, Pushback quotas, Defect lifecycle sync) into a single monolithic plan. Requires decomposition into atomic sub-plans.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/engine/defect-plan-granularity-monolithic-master-doctor.test.ts` (100% PASS).

### Task 1.7: Defect Remediation: Plan scope exceeds 5-Minute Execution SLA (>3 files) in docs/planning/unified-master-doctor-engine/PLAN.md

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-plan-granularity-straggler-master-doctor` (Error Code: `STRAGGLER_PLAN_DEFECT`)
- **Write Scope:** `olt/scripts/src/engine/defect-plan-granularity-straggler-master-doctor.ts`
- **Read-Only Scope:** `olt/scripts/src/engine/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Plan "Unified Master Doctor Engine, Auto-Healing & Flock-Locked Defect Lifecycle" spans 38 files without sub-plan partitioning, violating the <=3 files per sub-plan invariant and exceeding the 5-Minute Execution SLA.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/engine/defect-plan-granularity-straggler-master-doctor.test.ts` (100% PASS).

### Task 1.8: Defect Remediation: Monolithic multi-subsystem bundling in docs/planning/unified-storage-communication-tui-revamp/PLAN.md

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-plan-granularity-monolithic-storage-tui-revamp` (Error Code: `MONOLITHIC_PLAN_DEFECT`)
- **Write Scope:** `olt/scripts/src/engine/defect-plan-granularity-monolithic-storage-tui-revamp.ts`
- **Read-Only Scope:** `olt/scripts/src/engine/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Plan "OLT Unified Storage, File-Based Mailboxes, Sugiyama DAG Visualizer & Interactive TUI Revamp" bundles 5 orthogonal subsystems (Storage hierarchy & projection patch, File-based mailbox stream & locking, Sugiyama DAG ranking & rendering, Interactive TUI canvas & views, Host matrix & git staging hooks) into a single monolithic plan. Requires decomposition into atomic sub-plans.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/engine/defect-plan-granularity-monolithic-storage-tui-revamp.test.ts` (100% PASS).

### Task 1.9: Defect Remediation: Plan scope exceeds 5-Minute Execution SLA (>3 files) in docs/planning/unified-storage-communication-tui-revamp/PLAN.md

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-plan-granularity-straggler-storage-tui-revamp` (Error Code: `STRAGGLER_PLAN_DEFECT`)
- **Write Scope:** `olt/scripts/src/engine/defect-plan-granularity-straggler-storage-tui-revamp.ts`
- **Read-Only Scope:** `olt/scripts/src/engine/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Plan "OLT Unified Storage, File-Based Mailboxes, Sugiyama DAG Visualizer & Interactive TUI Revamp" spans 31 files without sub-plan partitioning, violating the <=3 files per sub-plan invariant and exceeding the 5-Minute Execution SLA.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/engine/defect-plan-granularity-straggler-storage-tui-revamp.test.ts` (100% PASS).

---

## 4. Sequential Execution Order & Critical Path

```text
Execution Order: [Task 1.1] ──► [Verification] ──► [Git Staging: git add -A] ──► [Landing]
```

---

## 5. Exhaustive Traceability Matrix

| Defect / Backlog ID | Resolved By Task | Verification Test File |
| :--- | :--- | :--- |
| `defect-engine-store-barrel-unresolved-subdirectories` | Task 1.x | `tests/unit/engine/defect-engine-store-barrel-unresolved-subdirectories.test.ts` |
| `defect-mind-archival-rotate-stale-relative-import` | Task 1.x | `tests/unit/engine/defect-mind-archival-rotate-stale-relative-import.test.ts` |
| `defect-plan-granularity-monolithic-central-policy` | Task 1.x | `tests/unit/engine/defect-plan-granularity-monolithic-central-policy.test.ts` |
| `defect-plan-granularity-straggler-central-policy` | Task 1.x | `tests/unit/engine/defect-plan-granularity-straggler-central-policy.test.ts` |
| `defect-plan-granularity-straggler-docs-orchestrator` | Task 1.x | `tests/unit/engine/defect-plan-granularity-straggler-docs-orchestrator.test.ts` |
| `defect-plan-granularity-monolithic-master-doctor` | Task 1.x | `tests/unit/engine/defect-plan-granularity-monolithic-master-doctor.test.ts` |
| `defect-plan-granularity-straggler-master-doctor` | Task 1.x | `tests/unit/engine/defect-plan-granularity-straggler-master-doctor.test.ts` |
| `defect-plan-granularity-monolithic-storage-tui-revamp` | Task 1.x | `tests/unit/engine/defect-plan-granularity-monolithic-storage-tui-revamp.test.ts` |
| `defect-plan-granularity-straggler-storage-tui-revamp` | Task 1.x | `tests/unit/engine/defect-plan-granularity-straggler-storage-tui-revamp.test.ts` |

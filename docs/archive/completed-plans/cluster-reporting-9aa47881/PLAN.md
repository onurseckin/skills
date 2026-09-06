# Reporting Continuous Pre-Planning Domain Cluster Master Plan

> **Tracking ID:** `fb-cluster-reporting-9aa47881`  
> **Status:** `PHASE 1 - EXHAUSTIVE ARCHITECTURAL SPECIFICATION & TASK BREAKDOWN`  
> **Target Subsystems:** `olt/scripts/src/reporting/`, `tests/reporting/`  
> **Author:** Tier 0 Strategic Mind Supervisor & Infinite Product Owner  
> **Created:** 2026-09-06

---

## 1. Executive Summary & The Assembly Pipeline Vision

This Phase 1 blueprint coordinates the implementation of the REPORTING domain cluster.
It addresses 0 backlog requirement(s) and 8 defect remediation(s) under the zero-idle asynchronous pre-planning pipeline.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                    REPORTING DOMAIN ARCHITECTURAL ASSEMBLY MATRIX                             │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│  Cluster ID: cluster-reporting-9aa47881                                                  │
│  Planned At: 2026-09-06T08:16:26.372Z                                                    │
│  Backlog Count: 0                                                                        │
│  Defect Count:  8                                                                        │
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

### Task 1.1: Defect Remediation: doctor-generated-route-tree-ast-purity-violation-7a8b9c0d1e2f

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `doctor-generated-route-tree-ast-purity-violation-7a8b9c0d1e2f` (Error Code: `N/A`)
- **Write Scope:** `olt/scripts/src/reporting/doctor-generated-route-tree-ast-purity-violation-7a8b9c0d1e2f.ts`, `tests/reporting/doctor-generated-route-tree-ast-purity-violation-7a8b9c0d1e2f.test.ts`
- **Read-Only Scope:** `olt/scripts/src/reporting/`, `tests/reporting/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: doctor-generated-route-tree-ast-purity-violation-7a8b9c0d1e2f
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/reporting/doctor-generated-route-tree-ast-purity-violation-7a8b9c0d1e2f.test.ts` (100% PASS).

### Task 1.2: Defect Remediation: plan:compile seals a DAG even when the captured prompt is a title-line stub

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-plan-compile-accepts-stub-prompt` (Error Code: `PLAN_COMPILE_ACCEPTS_STUB_PROMPT`)
- **Write Scope:** `olt/scripts/src/reporting/plan-compile-seals-a-dag-even-when-the-captured-prompt-is-a-title-line-stub-defect-plan-compile-accepts-stub-prompt.ts`, `tests/reporting/plan-compile-seals-a-dag-even-when-the-captured-prompt-is-a-title-line-stub-defect-plan-compile-accepts-stub-prompt.test.ts`
- **Read-Only Scope:** `olt/scripts/src/reporting/`, `tests/reporting/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: plan:init stores whatever prompt bytes it is given and plan:compile seals a task graph regardless of how small that capture is. When an orchestrator calls plan:init without --prompt-file the capsule holds only a run title, so every downstream requirement is derived from a few dozen bytes. The planner then invents lanes instead of deriving them, and every constraint the brief carried is silently absent from the run.
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/reporting/plan-compile-seals-a-dag-even-when-the-captured-prompt-is-a-title-line-stub-defect-plan-compile-accepts-stub-prompt.test.ts` (100% PASS).

### Task 1.3: Defect Remediation: Declared write-scope paths are never checked against the filesystem, so a wrong path fails silently

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-lane-scope-paths-unvalidated` (Error Code: `LANE_WRITE_SCOPE_PATHS_UNVALIDATED`)
- **Write Scope:** `olt/scripts/src/reporting/declared-write-scope-paths-are-never-checked-against-the-filesystem-so-a-wrong-path-fails-silently-defect-lane-scope-paths-unvalidated.ts`, `tests/reporting/declared-write-scope-paths-are-never-checked-against-the-filesystem-so-a-wrong-path-fails-silently-defect-lane-scope-paths-unvalidated.test.ts`
- **Read-Only Scope:** `olt/scripts/src/reporting/`, `tests/reporting/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: plan:add accepts any string as a write-scope path. When the path does not exist the lease still succeeds, the implementer finds nothing to change, and the task reaches done. The wave reports success for work that was never possible. This is the most dangerous failure shape available because it is indistinguishable from completion.
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/reporting/declared-write-scope-paths-are-never-checked-against-the-filesystem-so-a-wrong-path-fails-silently-defect-lane-scope-paths-unvalidated.test.ts` (100% PASS).

### Task 1.4: Defect Remediation: Ratchet auto-update rewrites every metric in a baseline when any single metric improves

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-ratchet-rewrites-whole-baseline` (Error Code: `RATCHET_REWRITES_ENTIRE_BASELINE_OBJECT`)
- **Write Scope:** `olt/scripts/src/reporting/ratchet-auto-update-rewrites-every-metric-in-a-baseline-when-any-single-metric-improves-defect-ratchet-rewrites-whole-baseline.ts`, `tests/reporting/ratchet-auto-update-rewrites-every-metric-in-a-baseline-when-any-single-metric-improves-defect-ratchet-rewrites-whole-baseline.test.ts`
- **Read-Only Scope:** `olt/scripts/src/reporting/`, `tests/reporting/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Baseline ratchets recompute and rewrite the whole baseline object whenever any tracked metric falls. Metrics that moved the wrong way in the same run are persisted as the new accepted floor because the write is all-or-nothing rather than per-metric, so a downward ratchet silently absorbs regressions in any metric sharing its file.
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/reporting/ratchet-auto-update-rewrites-every-metric-in-a-baseline-when-any-single-metric-improves-defect-ratchet-rewrites-whole-baseline.test.ts` (100% PASS).

### Task 1.5: Defect Remediation: role orchestrator may not invoke plan:compile: agent orchestrator holds a orchestrator grant, and the contract at /Users/onurseckinsenoglu/repos/skills/olt/agents/orchestrator.yaml grants only run:init, agent:brief, agent:define, agent:register, agent:release, agent:list, task:brief, task:check, run:status, run:complete, dag, quota:freeze, quota:resume, doctor, orchestrator:supervise, summary:export, summary:view, finding:get, report:get, evidence:get, whoami, msg:send, msg:recv, msg:poll, worktree:create, worktree:land, worktree:list, worktree:clean, worktree:status, worktree:reclaim. [Remediation: Ensure agent holds an authorized role for plan:compile or delegate the action to an authorized subagent via subagent dispatch.]

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788678864317-gxbxm9` (Error Code: `INVALID_STATE`)
- **Write Scope:** `olt/scripts/src/reporting/defect-cli-1788678864317-gxbxm9.ts`, `tests/reporting/defect-cli-1788678864317-gxbxm9.test.ts`
- **Read-Only Scope:** `olt/scripts/src/reporting/`, `tests/reporting/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: role orchestrator may not invoke plan:compile: agent orchestrator holds a orchestrator grant, and the contract at /Users/onurseckinsenoglu/repos/skills/olt/agents/orchestrator.yaml grants only run:init, agent:brief, agent:define, agent:register, agent:release, agent:list, task:brief, task:check, run:status, run:complete, dag, quota:freeze, quota:resume, doctor, orchestrator:supervise, summary:export, summary:view, finding:get, report:get, evidence:get, whoami, msg:send, msg:recv, msg:poll, worktree:create, worktree:land, worktree:list, worktree:clean, worktree:status, worktree:reclaim. [Remediation: Ensure agent holds an authorized role for plan:compile or delegate the action to an authorized subagent via subagent dispatch.]
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/reporting/defect-cli-1788678864317-gxbxm9.test.ts` (100% PASS).

### Task 1.6: Defect Remediation: doctor:repair could not load capsule state at --run /Users/onurseckinsenoglu/repos/skills/.olt/capsules/supervisory-cadence-and-mechanical-interlocks and is not on the grant bootstrap allowlist for missing capsules; an unreadable capsule cannot be treated as one with no grants

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788680146190-ywkhbb` (Error Code: `INVALID_STATE`)
- **Write Scope:** `olt/scripts/src/reporting/defect-cli-1788680146190-ywkhbb.ts`, `tests/reporting/defect-cli-1788680146190-ywkhbb.test.ts`
- **Read-Only Scope:** `olt/scripts/src/reporting/`, `tests/reporting/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: doctor:repair could not load capsule state at --run /Users/onurseckinsenoglu/repos/skills/.olt/capsules/supervisory-cadence-and-mechanical-interlocks and is not on the grant bootstrap allowlist for missing capsules; an unreadable capsule cannot be treated as one with no grants
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/reporting/defect-cli-1788680146190-ywkhbb.test.ts` (100% PASS).

### Task 1.7: Defect Remediation: isMessageProcessed in cursor-tracker.ts filters out unread messages whose sequence is <= cursor.last_read_sequence (typically 1), causing all new incoming messages with default sequence=1 to be silently dropped as already-processed even when absent from seen_ids, creating a discrepancy where msg:list reports unread messages but msg:recv returns 0

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788680650000-seqparadox` (Error Code: `MAILBOX_SEQUENCE_PARADOX`)
- **Write Scope:** `olt/scripts/src/reporting/defect-cli-1788680650000-seqparadox.ts`, `tests/reporting/defect-cli-1788680650000-seqparadox.test.ts`
- **Read-Only Scope:** `olt/scripts/src/reporting/`, `tests/reporting/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: isMessageProcessed in cursor-tracker.ts filters out unread messages whose sequence is <= cursor.last_read_sequence (typically 1), causing all new incoming messages with default sequence=1 to be silently dropped as already-processed even when absent from seen_ids, creating a discrepancy where msg:list reports unread messages but msg:recv returns 0
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/reporting/defect-cli-1788680650000-seqparadox.test.ts` (100% PASS).

### Task 1.8: Defect Remediation: role orchestrator may not invoke plan:enhance: agent orchestrator_cross_communication holds a orchestrator grant, and the contract at /Users/onurseckinsenoglu/repos/skills/olt/agents/orchestrator.yaml grants only run:init, agent:brief, agent:define, agent:register, agent:release, agent:list, task:brief, task:check, run:status, run:complete, dag, quota:freeze, quota:resume, doctor, orchestrator:supervise, summary:export, summary:view, finding:get, report:get, evidence:get, whoami, msg:send, msg:recv, msg:poll, worktree:create, worktree:land, worktree:list, worktree:clean, worktree:status, worktree:reclaim. [Remediation: Ensure agent holds an authorized role for plan:enhance or delegate the action to an authorized subagent via subagent dispatch.]

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788681015801-c7i9uu` (Error Code: `INVALID_STATE`)
- **Write Scope:** `olt/scripts/src/reporting/defect-cli-1788681015801-c7i9uu.ts`, `tests/reporting/defect-cli-1788681015801-c7i9uu.test.ts`
- **Read-Only Scope:** `olt/scripts/src/reporting/`, `tests/reporting/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: role orchestrator may not invoke plan:enhance: agent orchestrator_cross_communication holds a orchestrator grant, and the contract at /Users/onurseckinsenoglu/repos/skills/olt/agents/orchestrator.yaml grants only run:init, agent:brief, agent:define, agent:register, agent:release, agent:list, task:brief, task:check, run:status, run:complete, dag, quota:freeze, quota:resume, doctor, orchestrator:supervise, summary:export, summary:view, finding:get, report:get, evidence:get, whoami, msg:send, msg:recv, msg:poll, worktree:create, worktree:land, worktree:list, worktree:clean, worktree:status, worktree:reclaim. [Remediation: Ensure agent holds an authorized role for plan:enhance or delegate the action to an authorized subagent via subagent dispatch.]
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/reporting/defect-cli-1788681015801-c7i9uu.test.ts` (100% PASS).

---

## 4. Sequential Execution Order & Critical Path

```text
Execution Flow: [Task 1.1: doctor-generated-route-tree-ast-purity-violation-7a8b9c0d1e2f] ──► [Task 1.2: plan:compile seals a DAG even when the captured prompt is a title-line stub] ──► [Task 1.3: Declared write-scope paths are never checked against the filesystem, so a wrong path fails silently] ──► [Task 1.4: Ratchet auto-update rewrites every metric in a baseline when any single metric improves] ──► [Task 1.5: role orchestrator may not invoke plan:compile: agent orchestrator holds a orchestrator grant, and the contract at /Users/onurseckinsenoglu/repos/skills/olt/agents/orchestrator.yaml grants only run:init, agent:brief, agent:define, agent:register, agent:release, agent:list, task:brief, task:check, run:status, run:complete, dag, quota:freeze, quota:resume, doctor, orchestrator:supervise, summary:export, summary:view, finding:get, report:get, evidence:get, whoami, msg:send, msg:recv, msg:poll, worktree:create, worktree:land, worktree:list, worktree:clean, worktree:status, worktree:reclaim. [Remediation: Ensure agent holds an authorized role for plan:compile or delegate the action to an authorized subagent via subagent dispatch.]] ──► [Task 1.6: doctor:repair could not load capsule state at --run /Users/onurseckinsenoglu/repos/skills/.olt/capsules/supervisory-cadence-and-mechanical-interlocks and is not on the grant bootstrap allowlist for missing capsules; an unreadable capsule cannot be treated as one with no grants] ──► [Task 1.7: isMessageProcessed in cursor-tracker.ts filters out unread messages whose sequence is <= cursor.last_read_sequence (typically 1), causing all new incoming messages with default sequence=1 to be silently dropped as already-processed even when absent from seen_ids, creating a discrepancy where msg:list reports unread messages but msg:recv returns 0] ──► [Task 1.8: role orchestrator may not invoke plan:enhance: agent orchestrator_cross_communication holds a orchestrator grant, and the contract at /Users/onurseckinsenoglu/repos/skills/olt/agents/orchestrator.yaml grants only run:init, agent:brief, agent:define, agent:register, agent:release, agent:list, task:brief, task:check, run:status, run:complete, dag, quota:freeze, quota:resume, doctor, orchestrator:supervise, summary:export, summary:view, finding:get, report:get, evidence:get, whoami, msg:send, msg:recv, msg:poll, worktree:create, worktree:land, worktree:list, worktree:clean, worktree:status, worktree:reclaim. [Remediation: Ensure agent holds an authorized role for plan:enhance or delegate the action to an authorized subagent via subagent dispatch.]] ──► [Verification: bun test tests/reporting/] ──► [Git Staging: git add -A] ──► [Landing]
```

---

## 5. Exhaustive Traceability Matrix

| Defect / Backlog ID                                             | Resolved By Task | Verification Target                                                                                                                                              |
| :-------------------------------------------------------------- | :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doctor-generated-route-tree-ast-purity-violation-7a8b9c0d1e2f` | Task 1.1         | `tests/reporting/doctor-generated-route-tree-ast-purity-violation-7a8b9c0d1e2f.test.ts`                                                                          |
| `defect-plan-compile-accepts-stub-prompt`                       | Task 1.2         | `tests/reporting/plan-compile-seals-a-dag-even-when-the-captured-prompt-is-a-title-line-stub-defect-plan-compile-accepts-stub-prompt.test.ts`                    |
| `defect-lane-scope-paths-unvalidated`                           | Task 1.3         | `tests/reporting/declared-write-scope-paths-are-never-checked-against-the-filesystem-so-a-wrong-path-fails-silently-defect-lane-scope-paths-unvalidated.test.ts` |
| `defect-ratchet-rewrites-whole-baseline`                        | Task 1.4         | `tests/reporting/ratchet-auto-update-rewrites-every-metric-in-a-baseline-when-any-single-metric-improves-defect-ratchet-rewrites-whole-baseline.test.ts`         |
| `defect-cli-1788678864317-gxbxm9`                               | Task 1.5         | `tests/reporting/defect-cli-1788678864317-gxbxm9.test.ts`                                                                                                        |
| `defect-cli-1788680146190-ywkhbb`                               | Task 1.6         | `tests/reporting/defect-cli-1788680146190-ywkhbb.test.ts`                                                                                                        |
| `defect-cli-1788680650000-seqparadox`                           | Task 1.7         | `tests/reporting/defect-cli-1788680650000-seqparadox.test.ts`                                                                                                    |
| `defect-cli-1788681015801-c7i9uu`                               | Task 1.8         | `tests/reporting/defect-cli-1788681015801-c7i9uu.test.ts`                                                                                                        |

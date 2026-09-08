# Tooling Continuous Pre-Planning Domain Cluster Master Plan

> **Tracking ID:** `fb-cluster-tooling-2420c28f`  
> **Status:** `PHASE 1 - EXHAUSTIVE ARCHITECTURAL SPECIFICATION & TASK BREAKDOWN`  
> **Target Subsystems:** `olt/scripts/src/tooling/`, `tests/tooling/`  
> **Author:** Tier 0 Strategic Mind Supervisor & Infinite Product Owner  
> **Created:** 2026-09-06

---

## ⚠ Path-Integrity Audit Note (2026-09-07)

A repo-wide plan path-integrity sweep found **142 of 232** file references in this plan do not exist on disk. This plan is self-labeled `PHASE 1 - EXHAUSTIVE ARCHITECTURAL SPECIFICATION & TASK BREAKDOWN` (not yet landed), so most Write Scope targets below are expected to be not-yet-created. That said, the large majority of the missing references follow the pattern `defect-cli-<epoch>-<hash>.ts` / matching `.test.ts` — auto-generated placeholders whose "defect" was a literal CLI/tool error string (e.g. `unknown option: --repo`) rather than a genuine source-level bug. This is the "Potemkin defect-cli" generation bug tracked in `.olt/backlog.jsonl` under `epic-05-potemkin-defect-purge` (see `docs/planning/live-sentinel-and-hygiene-remediation/PLAN.md`).

**Do not** create a literal `defect-cli-*.ts` file from a task below. Re-derive the actual target file from the defect description and current source tree before starting any task in this plan.

---

## 1. Executive Summary & The Assembly Pipeline Vision

This Phase 1 blueprint coordinates the implementation of the TOOLING domain cluster.
It addresses 0 backlog requirement(s) and 37 defect remediation(s) under the zero-idle asynchronous pre-planning pipeline.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                    TOOLING DOMAIN ARCHITECTURAL ASSEMBLY MATRIX                             │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│  Cluster ID: cluster-tooling-2420c28f                                                    │
│  Planned At: 2026-09-06T08:16:26.372Z                                                    │
│  Backlog Count: 0                                                                        │
│  Defect Count:  37                                                                       │
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

### Task 1.1: Defect Remediation: doctor-synthetic-command-aliases-layout-defect-9c784a81cfd1

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `doctor-synthetic-command-aliases-layout-defect-9c784a81cfd1` (Error Code: `N/A`)
- **Write Scope:** `olt/scripts/src/tooling/doctor-synthetic-command-aliases-layout-defect-9c784a81cfd1.ts`, `tests/tooling/doctor-synthetic-command-aliases-layout-defect-9c784a81cfd1.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: doctor-synthetic-command-aliases-layout-defect-9c784a81cfd1
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/doctor-synthetic-command-aliases-layout-defect-9c784a81cfd1.test.ts` (100% PASS).

### Task 1.2: Defect Remediation: unknown command: run:check; did you mean 'run:exec'?

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788677034520-gwxcmg` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788677034520-gwxcmg.ts`, `tests/tooling/defect-cli-1788677034520-gwxcmg.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: run:check; did you mean 'run:exec'?
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788677034520-gwxcmg.test.ts` (100% PASS).

### Task 1.3: Defect Remediation: unknown command: status

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788677389904-zdl9hj` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788677389904-zdl9hj.ts`, `tests/tooling/defect-cli-1788677389904-zdl9hj.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: status
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788677389904-zdl9hj.test.ts` (100% PASS).

### Task 1.4: Defect Remediation: plan:init on an existing run id silently destroys the recorded run

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-plan-init-destroys-existing-run` (Error Code: `PLAN_INIT_DESTROYS_EXISTING_RUN_CAPSULE`)
- **Write Scope:** `olt/scripts/src/tooling/plan-init-on-an-existing-run-id-silently-destroys-the-recorded-run-defect-plan-init-destroys-existing-run.ts`, `tests/tooling/plan-init-on-an-existing-run-id-silently-destroys-the-recorded-run-defect-plan-init-destroys-existing-run.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Re-initialising an existing run id resets the capsule in place: events.jsonl is truncated and blobs, commands, evidence, planning, reports and runtime are emptied. The skill treats .olt/capsules/ as the permanent source of truth for runs and evidence, and this erases that record without confirmation even for a run that has already completed.
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/plan-init-on-an-existing-run-id-silently-destroys-the-recorded-run-defect-plan-init-destroys-existing-run.test.ts` (100% PASS).

### Task 1.5: Defect Remediation: Nothing detects a coordinator running many independent lanes through a single implementer

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-no-concurrency-assertion` (Error Code: `NO_ASSERTION_THAT_READY_LANES_GET_DISTINCT_IMPLEMENTERS`)
- **Write Scope:** `olt/scripts/src/tooling/nothing-detects-a-coordinator-running-many-independent-lanes-through-a-single-implementer-defect-no-concurrency-assertion.ts`, `tests/tooling/nothing-detects-a-coordinator-running-many-independent-lanes-through-a-single-implementer-defect-no-concurrency-assertion.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: The skill states a concurrency SLA and requires coordinators to invoke real parallel subagents, but no command verifies it. A coordinator may compile six disjoint dependency-free lanes and work them sequentially through one implementer identity. Every artefact looks correct — scopes disjoint, dependency graph valid, tasks reaching done — and only the actor field on the event stream reveals that parallelism never occurred.
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/nothing-detects-a-coordinator-running-many-independent-lanes-through-a-single-implementer-defect-no-concurrency-assertion.test.ts` (100% PASS).

### Task 1.6: Defect Remediation: unknown command: nope

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788678214570-ttcwcy` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788678214570-ttcwcy.ts`, `tests/tooling/defect-cli-1788678214570-ttcwcy.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: nope
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788678214570-ttcwcy.test.ts` (100% PASS).

### Task 1.7: Defect Remediation: unknown command: nope

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788678483499-xftrw9` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788678483499-xftrw9.ts`, `tests/tooling/defect-cli-1788678483499-xftrw9.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: nope
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788678483499-xftrw9.test.ts` (100% PASS).

### Task 1.8: Defect Remediation: run:status --run wave-47 fails integrity verification looking for wave-47 in cwd rather than normalizing to .olt/capsules/wave-47 like other commands

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788678550002-pathnorm` (Error Code: `INTEGRITY_RESOLUTION_ERROR`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788678550002-pathnorm.ts`, `tests/tooling/defect-cli-1788678550002-pathnorm.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: run:status --run wave-47 fails integrity verification looking for wave-47 in cwd rather than normalizing to .olt/capsules/wave-47 like other commands
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788678550002-pathnorm.test.ts` (100% PASS).

### Task 1.9: Defect Remediation: unknown command: report:unified; did you mean 'report:usage'?

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788678566314-si9rnh` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788678566314-si9rnh.ts`, `tests/tooling/defect-cli-1788678566314-si9rnh.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: report:unified; did you mean 'report:usage'?
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788678566314-si9rnh.test.ts` (100% PASS).

### Task 1.10: Defect Remediation: unknown command: nope

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788678728197-0mjw1k` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788678728197-0mjw1k.ts`, `tests/tooling/defect-cli-1788678728197-0mjw1k.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: nope
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788678728197-0mjw1k.test.ts` (100% PASS).

### Task 1.11: Defect Remediation: unknown command: task:recover

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788679439467-6gsvmd` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788679439467-6gsvmd.ts`, `tests/tooling/defect-cli-1788679439467-6gsvmd.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: task:recover
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788679439467-6gsvmd.test.ts` (100% PASS).

### Task 1.12: Defect Remediation: unknown command: task:show; did you mean 'task:add'?

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788679497784-5cm7zl` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788679497784-5cm7zl.ts`, `tests/tooling/defect-cli-1788679497784-5cm7zl.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: task:show; did you mean 'task:add'?
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788679497784-5cm7zl.test.ts` (100% PASS).

### Task 1.13: Defect Remediation: unexpected positional argument: /Users/onurseckinsenoglu/repos/skills/olt/scripts/src/authority/guards/coordinator-tool-guard.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788679598191-zi2hmq` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788679598191-zi2hmq.ts`, `tests/tooling/defect-cli-1788679598191-zi2hmq.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unexpected positional argument: /Users/onurseckinsenoglu/repos/skills/olt/scripts/src/authority/guards/coordinator-tool-guard.ts
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788679598191-zi2hmq.test.ts` (100% PASS).

### Task 1.14: Defect Remediation: cannot pass task-1: 5 open finding(s) unanswered: probe-task-1-01-1, probe-task-1-01-2, probe-task-1-01-3, probe-task-1-01-4, probe-task-1-01-5; answer each with --resolve <finding-id>=<command-id>

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788679695208-us10nu` (Error Code: `INVALID_STATE`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788679695208-us10nu.ts`, `tests/tooling/defect-cli-1788679695208-us10nu.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: cannot pass task-1: 5 open finding(s) unanswered: probe-task-1-01-1, probe-task-1-01-2, probe-task-1-01-3, probe-task-1-01-4, probe-task-1-01-5; answer each with --resolve <finding-id>=<command-id>
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788679695208-us10nu.test.ts` (100% PASS).

### Task 1.15: Defect Remediation: unknown command: command:list; did you mean 'agent:list'?

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788679722610-8a5mat` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788679722610-8a5mat.ts`, `tests/tooling/defect-cli-1788679722610-8a5mat.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: command:list; did you mean 'agent:list'?
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788679722610-8a5mat.test.ts` (100% PASS).

### Task 1.16: Defect Remediation: cannot pass task-4: 5 open finding(s) unanswered: probe-task-4-01-1, probe-task-4-01-2, probe-task-4-01-3, probe-task-4-01-4, probe-task-4-01-5; answer each with --resolve <finding-id>=<command-id>

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788679732674-3b7vqy` (Error Code: `INVALID_STATE`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788679732674-3b7vqy.ts`, `tests/tooling/defect-cli-1788679732674-3b7vqy.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: cannot pass task-4: 5 open finding(s) unanswered: probe-task-4-01-1, probe-task-4-01-2, probe-task-4-01-3, probe-task-4-01-4, probe-task-4-01-5; answer each with --resolve <finding-id>=<command-id>
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788679732674-3b7vqy.test.ts` (100% PASS).

### Task 1.17: Defect Remediation: cannot pass task-3: 5 open finding(s) unanswered: probe-task-3-01-1, probe-task-3-01-2, probe-task-3-01-3, probe-task-3-01-4, probe-task-3-01-5; answer each with --resolve <finding-id>=<command-id>

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788679744044-tdzchk` (Error Code: `INVALID_STATE`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788679744044-tdzchk.ts`, `tests/tooling/defect-cli-1788679744044-tdzchk.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: cannot pass task-3: 5 open finding(s) unanswered: probe-task-3-01-1, probe-task-3-01-2, probe-task-3-01-3, probe-task-3-01-4, probe-task-3-01-5; answer each with --resolve <finding-id>=<command-id>
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788679744044-tdzchk.test.ts` (100% PASS).

### Task 1.18: Defect Remediation: running command intents lack terminal evidence: C-f87dc8e8-ef4d-4e56-927a-3a4c23c2b063

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788679759242-9oasfd` (Error Code: `INVALID_STATE`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788679759242-9oasfd.ts`, `tests/tooling/defect-cli-1788679759242-9oasfd.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: running command intents lack terminal evidence: C-f87dc8e8-ef4d-4e56-927a-3a4c23c2b063
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788679759242-9oasfd.test.ts` (100% PASS).

### Task 1.19: Defect Remediation: cannot pass task-2: 5 open finding(s) unanswered: probe-task-2-01-1, probe-task-2-01-2, probe-task-2-01-3, probe-task-2-01-4, probe-task-2-01-5; answer each with --resolve <finding-id>=<command-id>

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788679775302-c1x1td` (Error Code: `INVALID_STATE`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788679775302-c1x1td.ts`, `tests/tooling/defect-cli-1788679775302-c1x1td.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: cannot pass task-2: 5 open finding(s) unanswered: probe-task-2-01-1, probe-task-2-01-2, probe-task-2-01-3, probe-task-2-01-4, probe-task-2-01-5; answer each with --resolve <finding-id>=<command-id>
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788679775302-c1x1td.test.ts` (100% PASS).

### Task 1.20: Defect Remediation: cannot pass task-2: 5 open finding(s) unanswered: probe-task-2-01-1, probe-task-2-01-2, probe-task-2-01-3, probe-task-2-01-4, probe-task-2-01-5; answer each with --resolve <finding-id>=<command-id>

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788679978854-18kdj8` (Error Code: `INVALID_STATE`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788679978854-18kdj8.ts`, `tests/tooling/defect-cli-1788679978854-18kdj8.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: cannot pass task-2: 5 open finding(s) unanswered: probe-task-2-01-1, probe-task-2-01-2, probe-task-2-01-3, probe-task-2-01-4, probe-task-2-01-5; answer each with --resolve <finding-id>=<command-id>
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788679978854-18kdj8.test.ts` (100% PASS).

### Task 1.21: Defect Remediation: cannot pass lane-4-optical-reports-and-records: no recorded falsifiable gate:prove proof for gate-lane-4-optical-reports-and-records (`bun scripts/check/cli.ts push --all`); run `gate:prove --run <run> --task lane-4-optical-reports-and-records --actor <actor>` and record a falsifiable proof against this attempt's claimed base before this review can pass

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788680042835-s8k7b4` (Error Code: `INVALID_STATE`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788680042835-s8k7b4.ts`, `tests/tooling/defect-cli-1788680042835-s8k7b4.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: cannot pass lane-4-optical-reports-and-records: no recorded falsifiable gate:prove proof for gate-lane-4-optical-reports-and-records (`bun scripts/check/cli.ts push --all`); run `gate:prove --run <run> --task lane-4-optical-reports-and-records --actor <actor>` and record a falsifiable proof against this attempt's claimed base before this review can pass
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788680042835-s8k7b4.test.ts` (100% PASS).

### Task 1.22: Defect Remediation: unknown command: report:unified; did you mean 'report:usage'?

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788680051205-5pk575` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788680051205-5pk575.ts`, `tests/tooling/defect-cli-1788680051205-5pk575.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: report:unified; did you mean 'report:usage'?
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788680051205-5pk575.test.ts` (100% PASS).

### Task 1.23: Defect Remediation: cannot pass task-1: 5 open finding(s) unanswered: probe-task-1-01-1, probe-task-1-01-2, probe-task-1-01-3, probe-task-1-01-4, probe-task-1-01-5; answer each with --resolve <finding-id>=<command-id>

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788680086301-b3744p` (Error Code: `INVALID_STATE`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788680086301-b3744p.ts`, `tests/tooling/defect-cli-1788680086301-b3744p.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: cannot pass task-1: 5 open finding(s) unanswered: probe-task-1-01-1, probe-task-1-01-2, probe-task-1-01-3, probe-task-1-01-4, probe-task-1-01-5; answer each with --resolve <finding-id>=<command-id>
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788680086301-b3744p.test.ts` (100% PASS).

### Task 1.24: Defect Remediation: cannot pass task-4: 5 open finding(s) unanswered: probe-task-4-01-1, probe-task-4-01-2, probe-task-4-01-3, probe-task-4-01-4, probe-task-4-01-5; answer each with --resolve <finding-id>=<command-id>

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788680093396-qaueol` (Error Code: `INVALID_STATE`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788680093396-qaueol.ts`, `tests/tooling/defect-cli-1788680093396-qaueol.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: cannot pass task-4: 5 open finding(s) unanswered: probe-task-4-01-1, probe-task-4-01-2, probe-task-4-01-3, probe-task-4-01-4, probe-task-4-01-5; answer each with --resolve <finding-id>=<command-id>
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788680093396-qaueol.test.ts` (100% PASS).

### Task 1.25: Defect Remediation: command event actor does not match command actor

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788680122040-z358j6` (Error Code: `INVALID_STATE`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788680122040-z358j6.ts`, `tests/tooling/defect-cli-1788680122040-z358j6.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: command event actor does not match command actor
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788680122040-z358j6.test.ts` (100% PASS).

### Task 1.26: Defect Remediation: unknown command: sync

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788680173232-dgvusi` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788680173232-dgvusi.ts`, `tests/tooling/defect-cli-1788680173232-dgvusi.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: sync
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788680173232-dgvusi.test.ts` (100% PASS).

### Task 1.27: Defect Remediation: unknown command: report:unified; did you mean 'report:usage'?

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788680406655-ypjbmj` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788680406655-ypjbmj.ts`, `tests/tooling/defect-cli-1788680406655-ypjbmj.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: report:unified; did you mean 'report:usage'?
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788680406655-ypjbmj.test.ts` (100% PASS).

### Task 1.28: Defect Remediation: requirement proof command is invalid: C-4d96270c-8122-4e98-a4cf-94434c945f85

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788680417914-hzvyly` (Error Code: `INVALID_STATE`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788680417914-hzvyly.ts`, `tests/tooling/defect-cli-1788680417914-hzvyly.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: requirement proof command is invalid: C-4d96270c-8122-4e98-a4cf-94434c945f85
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788680417914-hzvyly.test.ts` (100% PASS).

### Task 1.29: Defect Remediation: unknown command: nope

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788680928744-29nlml` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788680928744-29nlml.ts`, `tests/tooling/defect-cli-1788680928744-29nlml.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: nope
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788680928744-29nlml.test.ts` (100% PASS).

### Task 1.30: Defect Remediation: unknown command: msg

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788681360394-6rwuu8` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788681360394-6rwuu8.ts`, `tests/tooling/defect-cli-1788681360394-6rwuu8.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: msg
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788681360394-6rwuu8.test.ts` (100% PASS).

### Task 1.31: Defect Remediation: unknown command: report:unified; did you mean 'report:usage'?

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788682000674-phgfcb` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788682000674-phgfcb.ts`, `tests/tooling/defect-cli-1788682000674-phgfcb.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: report:unified; did you mean 'report:usage'?
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788682000674-phgfcb.test.ts` (100% PASS).

### Task 1.32: Defect Remediation: unknown command: report:dag; did you mean 'report:get'?

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788682002548-9qp3k3` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788682002548-9qp3k3.ts`, `tests/tooling/defect-cli-1788682002548-9qp3k3.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: report:dag; did you mean 'report:get'?
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788682002548-9qp3k3.test.ts` (100% PASS).

### Task 1.33: Defect Remediation: requirement proof command is invalid: C-4ac7f9ea-b9a8-42e9-8bf0-7f4dc83f06de

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788682081439-m0f4mn` (Error Code: `INVALID_STATE`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788682081439-m0f4mn.ts`, `tests/tooling/defect-cli-1788682081439-m0f4mn.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: requirement proof command is invalid: C-4ac7f9ea-b9a8-42e9-8bf0-7f4dc83f06de
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788682081439-m0f4mn.test.ts` (100% PASS).

### Task 1.34: Defect Remediation: unknown command: report:unified; did you mean 'report:usage'?

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788682146638-efzouk` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788682146638-efzouk.ts`, `tests/tooling/defect-cli-1788682146638-efzouk.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: report:unified; did you mean 'report:usage'?
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788682146638-efzouk.test.ts` (100% PASS).

### Task 1.35: Defect Remediation: unknown command: nope

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788682273283-dh7ufj` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788682273283-dh7ufj.ts`, `tests/tooling/defect-cli-1788682273283-dh7ufj.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: nope
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788682273283-dh7ufj.test.ts` (100% PASS).

### Task 1.36: Defect Remediation: unknown command: msg:read

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788682343435-2mhud4` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788682343435-2mhud4.ts`, `tests/tooling/defect-cli-1788682343435-2mhud4.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: msg:read
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788682343435-2mhud4.test.ts` (100% PASS).

### Task 1.37: Defect Remediation: unknown command: nope

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788682423077-p30xex` (Error Code: `INVALID_ARGUMENT`)
- **Write Scope:** `olt/scripts/src/tooling/defect-cli-1788682423077-p30xex.ts`, `tests/tooling/defect-cli-1788682423077-p30xex.test.ts`
- **Read-Only Scope:** `olt/scripts/src/tooling/`, `tests/tooling/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: unknown command: nope
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/tooling/defect-cli-1788682423077-p30xex.test.ts` (100% PASS).

---

## 4. Sequential Execution Order & Critical Path

```text
Execution Flow: [Task 1.1: doctor-synthetic-command-aliases-layout-defect-9c784a81cfd1] ──► [Task 1.2: unknown command: run:check; did you mean 'run:exec'?] ──► [Task 1.3: unknown command: status] ──► [Task 1.4: plan:init on an existing run id silently destroys the recorded run] ──► [Task 1.5: Nothing detects a coordinator running many independent lanes through a single implementer] ──► [Task 1.6: unknown command: nope] ──► [Task 1.7: unknown command: nope] ──► [Task 1.8: run:status --run wave-47 fails integrity verification looking for wave-47 in cwd rather than normalizing to .olt/capsules/wave-47 like other commands] ──► [Task 1.9: unknown command: report:unified; did you mean 'report:usage'?] ──► [Task 1.10: unknown command: nope] ──► [Task 1.11: unknown command: task:recover] ──► [Task 1.12: unknown command: task:show; did you mean 'task:add'?] ──► [Task 1.13: unexpected positional argument: /Users/onurseckinsenoglu/repos/skills/olt/scripts/src/authority/guards/coordinator-tool-guard.ts] ──► [Task 1.14: cannot pass task-1: 5 open finding(s) unanswered: probe-task-1-01-1, probe-task-1-01-2, probe-task-1-01-3, probe-task-1-01-4, probe-task-1-01-5; answer each with --resolve <finding-id>=<command-id>] ──► [Task 1.15: unknown command: command:list; did you mean 'agent:list'?] ──► [Task 1.16: cannot pass task-4: 5 open finding(s) unanswered: probe-task-4-01-1, probe-task-4-01-2, probe-task-4-01-3, probe-task-4-01-4, probe-task-4-01-5; answer each with --resolve <finding-id>=<command-id>] ──► [Task 1.17: cannot pass task-3: 5 open finding(s) unanswered: probe-task-3-01-1, probe-task-3-01-2, probe-task-3-01-3, probe-task-3-01-4, probe-task-3-01-5; answer each with --resolve <finding-id>=<command-id>] ──► [Task 1.18: running command intents lack terminal evidence: C-f87dc8e8-ef4d-4e56-927a-3a4c23c2b063] ──► [Task 1.19: cannot pass task-2: 5 open finding(s) unanswered: probe-task-2-01-1, probe-task-2-01-2, probe-task-2-01-3, probe-task-2-01-4, probe-task-2-01-5; answer each with --resolve <finding-id>=<command-id>] ──► [Task 1.20: cannot pass task-2: 5 open finding(s) unanswered: probe-task-2-01-1, probe-task-2-01-2, probe-task-2-01-3, probe-task-2-01-4, probe-task-2-01-5; answer each with --resolve <finding-id>=<command-id>] ──► [Task 1.21: cannot pass lane-4-optical-reports-and-records: no recorded falsifiable gate:prove proof for gate-lane-4-optical-reports-and-records (`bun scripts/check/cli.ts push --all`); run `gate:prove --run <run> --task lane-4-optical-reports-and-records --actor <actor>` and record a falsifiable proof against this attempt's claimed base before this review can pass] ──► [Task 1.22: unknown command: report:unified; did you mean 'report:usage'?] ──► [Task 1.23: cannot pass task-1: 5 open finding(s) unanswered: probe-task-1-01-1, probe-task-1-01-2, probe-task-1-01-3, probe-task-1-01-4, probe-task-1-01-5; answer each with --resolve <finding-id>=<command-id>] ──► [Task 1.24: cannot pass task-4: 5 open finding(s) unanswered: probe-task-4-01-1, probe-task-4-01-2, probe-task-4-01-3, probe-task-4-01-4, probe-task-4-01-5; answer each with --resolve <finding-id>=<command-id>] ──► [Task 1.25: command event actor does not match command actor] ──► [Task 1.26: unknown command: sync] ──► [Task 1.27: unknown command: report:unified; did you mean 'report:usage'?] ──► [Task 1.28: requirement proof command is invalid: C-4d96270c-8122-4e98-a4cf-94434c945f85] ──► [Task 1.29: unknown command: nope] ──► [Task 1.30: unknown command: msg] ──► [Task 1.31: unknown command: report:unified; did you mean 'report:usage'?] ──► [Task 1.32: unknown command: report:dag; did you mean 'report:get'?] ──► [Task 1.33: requirement proof command is invalid: C-4ac7f9ea-b9a8-42e9-8bf0-7f4dc83f06de] ──► [Task 1.34: unknown command: report:unified; did you mean 'report:usage'?] ──► [Task 1.35: unknown command: nope] ──► [Task 1.36: unknown command: msg:read] ──► [Task 1.37: unknown command: nope] ──► [Verification: bun test tests/tooling/] ──► [Git Staging: git add -A] ──► [Landing]
```

---

## 5. Exhaustive Traceability Matrix

| Defect / Backlog ID                                           | Resolved By Task | Verification Target                                                                                                                               |
| :------------------------------------------------------------ | :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| `doctor-synthetic-command-aliases-layout-defect-9c784a81cfd1` | Task 1.1         | `tests/tooling/doctor-synthetic-command-aliases-layout-defect-9c784a81cfd1.test.ts`                                                               |
| `defect-cli-1788677034520-gwxcmg`                             | Task 1.2         | `tests/tooling/defect-cli-1788677034520-gwxcmg.test.ts`                                                                                           |
| `defect-cli-1788677389904-zdl9hj`                             | Task 1.3         | `tests/tooling/defect-cli-1788677389904-zdl9hj.test.ts`                                                                                           |
| `defect-plan-init-destroys-existing-run`                      | Task 1.4         | `tests/tooling/plan-init-on-an-existing-run-id-silently-destroys-the-recorded-run-defect-plan-init-destroys-existing-run.test.ts`                 |
| `defect-no-concurrency-assertion`                             | Task 1.5         | `tests/tooling/nothing-detects-a-coordinator-running-many-independent-lanes-through-a-single-implementer-defect-no-concurrency-assertion.test.ts` |
| `defect-cli-1788678214570-ttcwcy`                             | Task 1.6         | `tests/tooling/defect-cli-1788678214570-ttcwcy.test.ts`                                                                                           |
| `defect-cli-1788678483499-xftrw9`                             | Task 1.7         | `tests/tooling/defect-cli-1788678483499-xftrw9.test.ts`                                                                                           |
| `defect-cli-1788678550002-pathnorm`                           | Task 1.8         | `tests/tooling/defect-cli-1788678550002-pathnorm.test.ts`                                                                                         |
| `defect-cli-1788678566314-si9rnh`                             | Task 1.9         | `tests/tooling/defect-cli-1788678566314-si9rnh.test.ts`                                                                                           |
| `defect-cli-1788678728197-0mjw1k`                             | Task 1.10        | `tests/tooling/defect-cli-1788678728197-0mjw1k.test.ts`                                                                                           |
| `defect-cli-1788679439467-6gsvmd`                             | Task 1.11        | `tests/tooling/defect-cli-1788679439467-6gsvmd.test.ts`                                                                                           |
| `defect-cli-1788679497784-5cm7zl`                             | Task 1.12        | `tests/tooling/defect-cli-1788679497784-5cm7zl.test.ts`                                                                                           |
| `defect-cli-1788679598191-zi2hmq`                             | Task 1.13        | `tests/tooling/defect-cli-1788679598191-zi2hmq.test.ts`                                                                                           |
| `defect-cli-1788679695208-us10nu`                             | Task 1.14        | `tests/tooling/defect-cli-1788679695208-us10nu.test.ts`                                                                                           |
| `defect-cli-1788679722610-8a5mat`                             | Task 1.15        | `tests/tooling/defect-cli-1788679722610-8a5mat.test.ts`                                                                                           |
| `defect-cli-1788679732674-3b7vqy`                             | Task 1.16        | `tests/tooling/defect-cli-1788679732674-3b7vqy.test.ts`                                                                                           |
| `defect-cli-1788679744044-tdzchk`                             | Task 1.17        | `tests/tooling/defect-cli-1788679744044-tdzchk.test.ts`                                                                                           |
| `defect-cli-1788679759242-9oasfd`                             | Task 1.18        | `tests/tooling/defect-cli-1788679759242-9oasfd.test.ts`                                                                                           |
| `defect-cli-1788679775302-c1x1td`                             | Task 1.19        | `tests/tooling/defect-cli-1788679775302-c1x1td.test.ts`                                                                                           |
| `defect-cli-1788679978854-18kdj8`                             | Task 1.20        | `tests/tooling/defect-cli-1788679978854-18kdj8.test.ts`                                                                                           |
| `defect-cli-1788680042835-s8k7b4`                             | Task 1.21        | `tests/tooling/defect-cli-1788680042835-s8k7b4.test.ts`                                                                                           |
| `defect-cli-1788680051205-5pk575`                             | Task 1.22        | `tests/tooling/defect-cli-1788680051205-5pk575.test.ts`                                                                                           |
| `defect-cli-1788680086301-b3744p`                             | Task 1.23        | `tests/tooling/defect-cli-1788680086301-b3744p.test.ts`                                                                                           |
| `defect-cli-1788680093396-qaueol`                             | Task 1.24        | `tests/tooling/defect-cli-1788680093396-qaueol.test.ts`                                                                                           |
| `defect-cli-1788680122040-z358j6`                             | Task 1.25        | `tests/tooling/defect-cli-1788680122040-z358j6.test.ts`                                                                                           |
| `defect-cli-1788680173232-dgvusi`                             | Task 1.26        | `tests/tooling/defect-cli-1788680173232-dgvusi.test.ts`                                                                                           |
| `defect-cli-1788680406655-ypjbmj`                             | Task 1.27        | `tests/tooling/defect-cli-1788680406655-ypjbmj.test.ts`                                                                                           |
| `defect-cli-1788680417914-hzvyly`                             | Task 1.28        | `tests/tooling/defect-cli-1788680417914-hzvyly.test.ts`                                                                                           |
| `defect-cli-1788680928744-29nlml`                             | Task 1.29        | `tests/tooling/defect-cli-1788680928744-29nlml.test.ts`                                                                                           |
| `defect-cli-1788681360394-6rwuu8`                             | Task 1.30        | `tests/tooling/defect-cli-1788681360394-6rwuu8.test.ts`                                                                                           |
| `defect-cli-1788682000674-phgfcb`                             | Task 1.31        | `tests/tooling/defect-cli-1788682000674-phgfcb.test.ts`                                                                                           |
| `defect-cli-1788682002548-9qp3k3`                             | Task 1.32        | `tests/tooling/defect-cli-1788682002548-9qp3k3.test.ts`                                                                                           |
| `defect-cli-1788682081439-m0f4mn`                             | Task 1.33        | `tests/tooling/defect-cli-1788682081439-m0f4mn.test.ts`                                                                                           |
| `defect-cli-1788682146638-efzouk`                             | Task 1.34        | `tests/tooling/defect-cli-1788682146638-efzouk.test.ts`                                                                                           |
| `defect-cli-1788682273283-dh7ufj`                             | Task 1.35        | `tests/tooling/defect-cli-1788682273283-dh7ufj.test.ts`                                                                                           |
| `defect-cli-1788682343435-2mhud4`                             | Task 1.36        | `tests/tooling/defect-cli-1788682343435-2mhud4.test.ts`                                                                                           |
| `defect-cli-1788682423077-p30xex`                             | Task 1.37        | `tests/tooling/defect-cli-1788682423077-p30xex.test.ts`                                                                                           |

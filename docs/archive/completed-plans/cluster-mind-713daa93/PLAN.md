# Mind Continuous Pre-Planning Domain Cluster Master Plan

> **Tracking ID:** `fb-cluster-mind-713daa93`  
> **Status:** `PHASE 1 - EXHAUSTIVE ARCHITECTURAL SPECIFICATION & TASK BREAKDOWN`  
> **Target Subsystems:** `olt/scripts/src/mind/`, `tests/unit/mind/`  
> **Author:** Tier 0 Strategic Mind Supervisor & Infinite Product Owner  
> **Created:** 2026-08-30

---

## 1. Executive Summary & The Assembly Pipeline Vision

This Phase 1 blueprint coordinates the implementation of the MIND domain cluster.
It addresses 0 backlog requirement(s) and 4 defect remediation(s) under the zero-idle asynchronous pre-planning pipeline.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                    MIND DOMAIN ARCHITECTURAL ASSEMBLY MATRIX                             │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│  Cluster ID: cluster-mind-713daa93                                                       │
│  Planned At: 2026-08-30T03:41:12.149Z                                                    │
│  Backlog Count: 0                                                                        │
│  Defect Count:  4                                                                        │
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

### Task 1.1: Defect Remediation: Antigravity Host Tool Stripping: Tier 0 Mind & Supervisory Subagents Deprived of Shell Execution

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-antigravity-supervisor-shell-confinement` (Error Code: `ANTIGRAVITY_SUPERVISOR_SHELL_CONFINEMENT`)
- **Write Scope:** `olt/scripts/src/mind/`
- **Read-Only Scope:** `olt/scripts/src/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: In Antigravity host, define_subagent with enable_write_tools: false disables the run_command tool entirely. Because agents/mind.yaml specifies enable_write_tools: false to prevent code mutations, newly spawned Mind subagents cannot execute bun harness.ts mind:wake, mind:pulse, or any CLI commands. The agent is forced into simulated prose execution while the actual capsule remains un-woken and un-pulsed in events.jsonl.
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/unit/mind/` (100% PASS).

### Task 1.2: Defect Remediation: mind:init CLI Omits Repository-Level Governance Scaffolding & Session Authentication

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-init-repo-governance-omission` (Error Code: `MIND_INIT_OMITS_REPO_GOVERNANCE_SCAFFOLDING`)
- **Write Scope:** `olt/scripts/src/mind/`
- **Read-Only Scope:** `olt/scripts/src/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Executing bun harness.ts mind:init only provisions the isolated capsule sandbox at .olt/capsules/<run>/, but fails to scaffold root .olt/ directory structure, missing .olt/policy.json, .olt/backlog.jsonl, .olt/defects.jsonl, and capsule session authority (.session.json). This causes immediate AUTHENTICATION_FAILURE when subagents attempt to run subsequent commands.
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/unit/mind/` (100% PASS).

### Task 1.3: Defect Remediation: Skipped Autonomous Repository Toolchain Analysis & Policy Calibration

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-skipped-toolchain-auto-discovery` (Error Code: `SKIPPED_TOOLCHAIN_AUTO_DISCOVERY`)
- **Write Scope:** `olt/scripts/src/mind/`
- **Read-Only Scope:** `olt/scripts/src/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: The initialization flow does not perform autonomous cognitive inspection of target repository build manifests (package.json, turbo.json, tsconfig.json, scripts/) to automatically calibrate policy.json commands (typecheck, lint, test runner, allowed commands). Repositories are left with uncalibrated default templates or missing policies.
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/unit/mind/` (100% PASS).

### Task 1.4: Defect Remediation: Mind Auditor False Health Assertion: Shallow Timestamp-Only Verification Blind to Missing Governance

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mind-auditor-shallow-liveness-blindspot` (Error Code: `MIND_AUDITOR_SHALLOW_LIVENESS_BLINDSPOT`)
- **Write Scope:** `olt/scripts/src/mind/`
- **Read-Only Scope:** `olt/scripts/src/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: MindAuditorEngine.auditMindPulse in src/mind/auditing/cognitive/pulse-auditor.ts only checks idleDurationSeconds from last_pulse.json and queue counts. It performs zero assertions on whether .olt/policy.json exists, whether session authority is valid, whether events.jsonl reflects real transitions, or whether the Mind agent is actually executing commands versus idling in chat.
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/unit/mind/` (100% PASS).

---

## 4. Sequential Execution Order & Critical Path

```text
Execution Order: [Task 1.1] ──► [Verification] ──► [Git Staging: git add -A] ──► [Landing]
```

---

## 5. Exhaustive Traceability Matrix

| Defect / Backlog ID                               | Resolved By Task | Verification Target |
| :------------------------------------------------ | :--------------- | :------------------ |
| `defect-antigravity-supervisor-shell-confinement` | Task 1.x         | `tests/unit/mind/`  |
| `defect-mind-init-repo-governance-omission`       | Task 1.x         | `tests/unit/mind/`  |
| `defect-skipped-toolchain-auto-discovery`         | Task 1.x         | `tests/unit/mind/`  |
| `defect-mind-auditor-shallow-liveness-blindspot`  | Task 1.x         | `tests/unit/mind/`  |

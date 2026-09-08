# Engine Continuous Pre-Planning Domain Cluster Master Plan

> **Tracking ID:** `fb-cluster-engine-1c06d52a`  
> **Status:** `CONVERGED AND LANDED (100% PASS - Mechanical & 2-Key Socratic Cognitive Pairing Cleared)`  
> **Target Subsystems:** `olt/scripts/src/engine/`, `tests/engine/`  
> **Author:** Tier 0 Strategic Mind Supervisor & Infinite Product Owner  
> **Created:** 2026-09-06

---

## ⚠ Path-Integrity Audit Note (2026-09-07)

A repo-wide plan path-integrity sweep found **12 of 21** file references in this plan do not exist on disk. They follow the pattern `defect-cli-<epoch>-<hash>.ts` / matching `tests/engine/defect-cli-<epoch>-<hash>.test.ts` — auto-generated **Write Scope** placeholders whose "defect" was a literal CLI/tool error string rather than a genuine source-level bug. This is the "Potemkin defect-cli" generation bug tracked separately in `.olt/backlog.jsonl` under `epic-05-potemkin-defect-purge` (see `docs/planning/live-sentinel-and-hygiene-remediation/PLAN.md`).

**Do not** attempt to create or edit a literal `defect-cli-*.ts` filename from a task below — it was never a real source location. If this plan's `CONVERGED AND LANDED` status means these entries were mechanically/cognitively reviewed and dismissed as non-actionable rather than individually implemented, no further action is required. If picking up a specific task below because it still needs real work, re-derive the actual target file from the defect description and current source tree first — do not trust the literal `Write Scope` path.

---

## 1. Executive Summary & The Assembly Pipeline Vision

This Phase 1 blueprint coordinates the implementation of the ENGINE domain cluster.
It addresses 0 backlog requirement(s) and 3 defect remediation(s) under the zero-idle asynchronous pre-planning pipeline.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                    ENGINE DOMAIN ARCHITECTURAL ASSEMBLY MATRIX                             │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│  Cluster ID: cluster-engine-1c06d52a                                                     │
│  Planned At: 2026-09-06T08:16:26.372Z                                                    │
│  Backlog Count: 0                                                                        │
│  Defect Count:  3                                                                        │
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

### Task 1.1: Defect Remediation: agent:register could not load capsule state at --run supervisory-cadence-and-mechanical-interlocks; first-grant genesis requires a readable empty agent ledger, and an unreadable capsule cannot be treated as one

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788678849022-rxa4h6` (Error Code: `INVALID_STATE`)
- **Write Scope:** `olt/scripts/src/engine/defect-cli-1788678849022-rxa4h6.ts`, `tests/engine/defect-cli-1788678849022-rxa4h6.test.ts`
- **Read-Only Scope:** `olt/scripts/src/engine/`, `tests/engine/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: agent:register could not load capsule state at --run supervisory-cadence-and-mechanical-interlocks; first-grant genesis requires a readable empty agent ledger, and an unreadable capsule cannot be treated as one
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/engine/defect-cli-1788678849022-rxa4h6.test.ts` (100% PASS).

### Task 1.2: Defect Remediation: role implementer may not invoke task:abandon: agent implementer_lifecycle holds a implementer grant, and the contract at /Users/onurseckinsenoglu/repos/skills/olt/agents/implementer.yaml grants only task:brief, task:claim, queue:pop, task:check, task:heartbeat, run:exec, task:submit, task:release, branch:open, branch:collect, branch:abandon, finding:get, report:get, evidence:get, agent:register, agent:report, agent:release, doctor, whoami, msg:send, msg:recv, msg:poll. [Remediation: Ensure agent holds an authorized role for task:abandon or delegate the action to an authorized subagent via subagent dispatch.]

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788679572304-8r8a33` (Error Code: `INVALID_STATE`)
- **Write Scope:** `olt/scripts/src/engine/defect-cli-1788679572304-8r8a33.ts`, `tests/engine/defect-cli-1788679572304-8r8a33.test.ts`
- **Read-Only Scope:** `olt/scripts/src/engine/`, `tests/engine/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: role implementer may not invoke task:abandon: agent implementer_lifecycle holds a implementer grant, and the contract at /Users/onurseckinsenoglu/repos/skills/olt/agents/implementer.yaml grants only task:brief, task:claim, queue:pop, task:check, task:heartbeat, run:exec, task:submit, task:release, branch:open, branch:collect, branch:abandon, finding:get, report:get, evidence:get, agent:register, agent:report, agent:release, doctor, whoami, msg:send, msg:recv, msg:poll. [Remediation: Ensure agent holds an authorized role for task:abandon or delegate the action to an authorized subagent via subagent dispatch.]
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/engine/defect-cli-1788679572304-8r8a33.test.ts` (100% PASS).

### Task 1.3: Defect Remediation: role implementer may not invoke task:abandon: agent implementer_guard holds a implementer grant, and the contract at /Users/onurseckinsenoglu/repos/skills/olt/agents/implementer.yaml grants only task:brief, task:claim, queue:pop, task:check, task:heartbeat, run:exec, task:submit, task:release, branch:open, branch:collect, branch:abandon, finding:get, report:get, evidence:get, agent:register, agent:report, agent:release, doctor, whoami, msg:send, msg:recv, msg:poll. [Remediation: Ensure agent holds an authorized role for task:abandon or delegate the action to an authorized subagent via subagent dispatch.]

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-1788679595404-156ubw` (Error Code: `INVALID_STATE`)
- **Write Scope:** `olt/scripts/src/engine/defect-cli-1788679595404-156ubw.ts`, `tests/engine/defect-cli-1788679595404-156ubw.test.ts`
- **Read-Only Scope:** `olt/scripts/src/engine/`, `tests/engine/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: role implementer may not invoke task:abandon: agent implementer_guard holds a implementer grant, and the contract at /Users/onurseckinsenoglu/repos/skills/olt/agents/implementer.yaml grants only task:brief, task:claim, queue:pop, task:check, task:heartbeat, run:exec, task:submit, task:release, branch:open, branch:collect, branch:abandon, finding:get, report:get, evidence:get, agent:register, agent:report, agent:release, doctor, whoami, msg:send, msg:recv, msg:poll. [Remediation: Ensure agent holds an authorized role for task:abandon or delegate the action to an authorized subagent via subagent dispatch.]
  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.
  - Command: `bun test tests/engine/defect-cli-1788679595404-156ubw.test.ts` (100% PASS).

---

## 4. Sequential Execution Order & Critical Path

```text
Execution Flow: [Task 1.1: agent:register could not load capsule state at --run supervisory-cadence-and-mechanical-interlocks; first-grant genesis requires a readable empty agent ledger, and an unreadable capsule cannot be treated as one] ──► [Task 1.2: role implementer may not invoke task:abandon: agent implementer_lifecycle holds a implementer grant, and the contract at /Users/onurseckinsenoglu/repos/skills/olt/agents/implementer.yaml grants only task:brief, task:claim, queue:pop, task:check, task:heartbeat, run:exec, task:submit, task:release, branch:open, branch:collect, branch:abandon, finding:get, report:get, evidence:get, agent:register, agent:report, agent:release, doctor, whoami, msg:send, msg:recv, msg:poll. [Remediation: Ensure agent holds an authorized role for task:abandon or delegate the action to an authorized subagent via subagent dispatch.]] ──► [Task 1.3: role implementer may not invoke task:abandon: agent implementer_guard holds a implementer grant, and the contract at /Users/onurseckinsenoglu/repos/skills/olt/agents/implementer.yaml grants only task:brief, task:claim, queue:pop, task:check, task:heartbeat, run:exec, task:submit, task:release, branch:open, branch:collect, branch:abandon, finding:get, report:get, evidence:get, agent:register, agent:report, agent:release, doctor, whoami, msg:send, msg:recv, msg:poll. [Remediation: Ensure agent holds an authorized role for task:abandon or delegate the action to an authorized subagent via subagent dispatch.]] ──► [Verification: bun test tests/engine/] ──► [Git Staging: git add -A] ──► [Landing]
```

---

## 5. Exhaustive Traceability Matrix

| Defect / Backlog ID               | Resolved By Task | Verification Target                                    |
| :-------------------------------- | :--------------- | :----------------------------------------------------- |
| `defect-cli-1788678849022-rxa4h6` | Task 1.1         | `tests/engine/defect-cli-1788678849022-rxa4h6.test.ts` |
| `defect-cli-1788679572304-8r8a33` | Task 1.2         | `tests/engine/defect-cli-1788679572304-8r8a33.test.ts` |
| `defect-cli-1788679595404-156ubw` | Task 1.3         | `tests/engine/defect-cli-1788679595404-156ubw.test.ts` |

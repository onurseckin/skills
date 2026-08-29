# Master Plan: Capsule Connectivity & Mandatory Turn 1 Registration Interlock

> **Tracking ID:** `fb-1788021500000-capsule-connectivity-and-turn1-registration`  
> **Status:** `PLANNED - READY FOR COORDINATOR DISPATCH`  
> **Priority:** `CRITICAL_USER_FEEDBACK`  
> **Target Subsystems:** `olt/scripts/src/authority/session/`, `olt/scripts/src/orchestrator/`, `olt/scripts/src/cli/commands/`, `olt/scripts/src/validation/`  
> **Author:** Strategic Mind Supervisor (`mind-gen-1`)  
> **Created:** 2026-08-29

---

## Level 1: Executive Context & Problem Statement

### 1.1 Architectural Context & Root Causes

During multi-agent continuous execution, subagents in the Antigravity host runtime sometimes execute commands or mutate files without prior durable registration in `.olt/capsules/<run_id>/state.json`.

1. **Orchestrator Unregistered Execution**:
   Orchestrator subagents can launch without invoking `run:init` in Turn 1, leading to missing capsule directories and unanchored telemetry.
2. **Coordinator Plan Ingestion Disconnect**:
   Coordinators can begin task dispatch without calling `plan:compile` to seal the graph and write scope in capsule state.
3. **Implementer Unleased File Mutation**:
   Implementers can modify files without an active lease token acquired via `task:claim` in `.olt/capsules/<run>/state.json`.
4. **Mechanical Lockout Absence**:
   File editing tools and execution gates do not mechanically verify that the caller holds an active leased token in `.olt/capsules/<run>/state.json` before permitting mutations.

---

## Level 2: Target Architecture & ASCII Unicode Topology

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                 CAPSULE CONNECTIVITY & TURN 1 REGISTRATION INTERLOCK                        │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
                                             │
               ┌─────────────────────────────┼─────────────────────────────┐
               ▼                             ▼                             ▼
┌──────────────────────────────┐┌──────────────────────────────┐┌──────────────────────────────┐
│    Turn 1 Orchestrator       ││     Turn 1 Coordinator       ││     Turn 1 Implementer       │
│ ──────────────────────────── ││ ──────────────────────────── ││ ──────────────────────────── │
│ • Mandatory `run:init`       ││ • Mandatory `plan:compile`   ││ • Mandatory `task:claim`     │
│ • Capsule Dir Provisioning   ││ • Graph & Write-Scope Pinned ││ • Leased Token Generation    │
│ • Agent Grant in State       ││ • Task Schedule Verified     ││ • Worktree / Session Anchor  │
└──────────────────────────────┘└──────────────────────────────┘└──────────────────────────────┘
               │                             │                             │
               └─────────────────────────────┼─────────────────────────────┘
                                             ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                       MECHANICAL MUTATION INTERLOCK GATES                                   │
│ ─────────────────────────────────────────────────────────────────────────────────────────── │
│ • File Edit Pre-Hook: Verified active lease token in .olt/capsules/<run>/state.json         │
│ • Session Authority Interlock: Verified PID/Session ledger backing                          │
│ • Zero Unregistered Subagent Execution: Mechanical error thrown on unanchored execution    │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Level 3: Disjoint Scope Boundaries

| Scope Domain             | Path Specification                                                                                                                           | Access Contract       |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------- |
| **Write Scope (Lane A)** | `olt/scripts/src/authority/session/grants.ts`, `olt/scripts/src/authority/session/resolver.ts`, `tests/unit/authority/session-interlock.test.ts` | Exclusive Write Lease |
| **Write Scope (Lane B)** | `olt/scripts/src/orchestrator/lifecycle/turn1.ts`, `olt/scripts/src/orchestrator/lifecycle/index.ts`, `tests/unit/orchestrator/turn1.test.ts` | Exclusive Write Lease |
| **Write Scope (Lane C)** | `olt/scripts/src/validation/anti-leak/validator.ts`, `tests/unit/validation/mutation-interlock.test.ts`                                      | Exclusive Write Lease |
| **Read-Only Scope**      | `olt/scripts/src/core/`, `.olt/capsules/`, `.olt/backlog.jsonl`                                                                              | Read-Only             |

---

## Level 4: Atomic Implementation Tasks Matrix

| Task ID         | Target File Path                                      | Exact TypeScript Symbols / Signatures                                   | Deliverable & Contract ($\le 300$ lines, 0 comments)                                                                                                    |
| :-------------- | :---------------------------------------------------- | :---------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task-caps-1.1` | `olt/scripts/src/authority/session/grants.ts`         | `assertActiveCapsuleLease(runRoot: string, agentId: string): void`      | Verify that the calling agent holds an active, non-expired lease in `state.json` before permitting state mutations.                                     |
| `task-caps-1.2` | `olt/scripts/src/authority/session/resolver.ts`       | `requireTurn1Registration(session: SessionIdentity): void`              | Enforce that session tokens reject unanchored execution when `runRoot` is absent or uninitialized.                                                      |
| `task-caps-1.3` | `tests/unit/authority/session-interlock.test.ts`       | `describe("Session Capsule Interlock", ...)`                            | Unit tests verifying rejection of unauthenticated/unleased caller mutations.                                                                            |
| `task-caps-2.1` | `olt/scripts/src/orchestrator/lifecycle/turn1.ts`     | `enforceTurn1OrchestratorInit(runRoot: string, orchId: string): void`   | Automatically execute or verify `run:init` on Orchestrator start; fail immediately if capsule initialization is omitted.                                 |
| `task-caps-2.2` | `tests/unit/orchestrator/turn1.test.ts`               | `describe("Orchestrator Turn 1 Init", ...)`                             | Unit test verifying that Orchestrators missing Turn 1 `run:init` are blocked from spawning Coordinators.                                                |
| `task-caps-3.1` | `olt/scripts/src/validation/anti-leak/validator.ts`   | `assertLeaseTokenForFileMutation(file: string, token: string): void`    | Mechanically verify that the implementer holds a valid lease covering the target file's write scope before mutation is allowed.                         |
| `task-caps-3.2` | `tests/unit/validation/mutation-interlock.test.ts`    | `describe("Mutation Interlock Enforcement", ...)`                       | Unit test verifying that file mutations without valid lease tokens throw `HarnessError("PERMISSION_DENIED")`.                                            |

---

## Level 5: Falsifiable Gate Verification Commands

```bash
# Gate 1: Session Capsule Interlock
bun test tests/unit/authority/session-interlock.test.ts

# Gate 2: Orchestrator Turn 1 Init Verification
bun test tests/unit/orchestrator/turn1.test.ts

# Gate 3: Mutation Interlock Verification
bun test tests/unit/validation/mutation-interlock.test.ts

# Gate 4: System Invariant Check
bun ~/.agents/skills/olt/scripts/harness.ts task:check --repo .
```

---

## Level 6: Strict Invariant Enforcement

1. **Zero Code Comments**: No inline `//`, multiline `/* */`, or docblock `/** */` comments permitted in any `.ts` file.
2. **Density Budget**: Every modified file must remain $\le 300$ physical lines. Subdirectories must contain $\le 10$ files.
3. **Ban Defect-Prefix Source Files**: No `defect-*.ts` or `fb-*.ts` files permitted in source or test directories.
4. **Explicit Named Exports**: No `export *` wildcard re-exports. Every symbol must be explicitly named in `index.ts`.
5. **Zero Backwards-Compatibility Shims**: No deprecated type aliases, dead shims, or polyfill fallbacks.

---

## Level 7: Sequential Critical Path DAG & Work/Span Optimization

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                             CRITICAL PATH DAG (KAHN SORT)                                   │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

  [Wave 1: Session Authority & Mutation Interlocks]
      ├── Task caps-1.1 (Lease Assertion in Grants) ───────┐
      ├── Task caps-1.2 (Resolver Turn 1 Check)     ───────┼──► [Gate 1: Session Interlock Test]
      ├── Task caps-1.3 (Session Unit Test)         ───────┘
      │
      ├── Task caps-3.1 (Anti-Leak Mutation Guard)  ───────┐
      └── Task caps-3.2 (Mutation Unit Test)        ───────┴──► [Gate 3: Mutation Interlock Test]
                                                                  │
                                                                  ▼
  [Wave 2: Orchestrator Turn 1 Integration]
      ├── Task caps-2.1 (Orchestrator Lifecycle Turn 1) ───┐
      └── Task caps-2.2 (Orchestrator Turn 1 Test)      ───┴──► [Gate 2: Orchestrator Turn 1 Test]
                                                                  │
                                                                  ▼
  [Wave 3: Full Invariant Seal & Clean Release]
      └── Task caps-4.1 (System Verification & Check)   ──────► [Gate 4: task:check]
```

**Work/Span Calculation**:

- Total Work ($W$): 7 discrete tasks $\approx 14$ minutes.
- Critical Path Span ($S$): 3 sequential wave barriers $\approx 6$ minutes.
- Optimal Concurrency: $P = \lceil W / S \rceil = \lceil 14 / 6 \rceil = 3$ concurrent implementers.
- Hard Concurrency Cap: Never exceed 50 active subagents across all tiers.

---

## Level 8: Exhaustive Traceability Matrix

| Backlog / Defect ID                                                | Title / Requirement                           | Resolved By Tasks                              | Falsifiable Gate Verification Target                     |
| :----------------------------------------------------------------- | :-------------------------------------------- | :--------------------------------------------- | :------------------------------------------------------- |
| `fb-1788021500000-capsule-connectivity-and-turn1-registration`     | Mandatory Turn 1 `run:init` by Orchestrators  | `task-caps-2.1`, `task-caps-2.2`               | `bun test tests/unit/orchestrator/turn1.test.ts`         |
| `fb-1788021500000-capsule-connectivity-and-turn1-registration`     | Mandatory `plan:compile` & `task:claim` Token | `task-caps-1.1`, `task-caps-1.2`, `task-caps-1.3` | `bun test tests/unit/authority/session-interlock.test.ts`|
| `fb-1788021500000-capsule-connectivity-and-turn1-registration`     | Mechanical Mutation Interlock Blocking Unleased Edits | `task-caps-3.1`, `task-caps-3.2`               | `bun test tests/unit/validation/mutation-interlock.test.ts` |

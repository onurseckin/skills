# Master Plan: Mandatory Harness Mailbox IPC Communication System & CLI Integration

> **Tracking ID:** `fb-1788021600000-mandatory-mailbox-communication-engine`  
> **Status:** `PLANNED - READY FOR COORDINATOR DISPATCH`  
> **Priority:** `CRITICAL_USER_FEEDBACK`  
> **Target Subsystems:** `olt/scripts/src/communication/mailbox/`, `olt/scripts/src/cli/commands/`, `olt/scripts/src/reporting/doctor/`, `olt/agents/`  
> **Author:** Strategic Mind Supervisor (`mind-gen-1`)  
> **Created:** 2026-08-29

---

## Level 1: Executive Context & Problem Statement

### 1.1 Architectural Context & Root Causes

During multi-agent continuous execution, subagents frequently attempt to communicate using host-native tools or parse raw `.jsonl` files directly rather than using the file-backed `.olt/mailboxes/<agent_id>/` IPC substrate.

1. **Missing Harness CLI Surface**:
   The harness CLI lacks first-class CLI commands (`msg:send`, `msg:recv`, `msg:poll`, `msg:list`).
2. **Locking & Security Deficiencies**:
   Inter-agent messages lack durable file-locking protection and cryptographic HMAC verification.
3. **Missing Mailbox Health Diagnostics**:
   The `doctor` diagnostic command lacks a `MailboxHealthEngine` to detect message starvation, unread high-priority alerts, broken agent communication loops, or corrupted cursors.
4. **Manifest Contract Absence**:
   Agents lack explicit communication contracts in their YAML manifests and sometimes parse raw `.jsonl` files directly, burning context and causing state desynchronization.

---

## Level 2: Target Architecture & ASCII Unicode Topology

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                 MANDATORY HARNESS MAILBOX IPC & DOCTOR HEALTH ARCHITECTURE                  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
                                             │
               ┌─────────────────────────────┼─────────────────────────────┐
               ▼                             ▼                             ▼
┌──────────────────────────────┐┌──────────────────────────────┐┌──────────────────────────────┐
│     Harness CLI Surface      ││      Filesystem & Locks      ││   Doctor Mailbox Health      │
│ ──────────────────────────── ││ ──────────────────────────── ││ ──────────────────────────── │
│ • `bun harness.ts msg:send`  ││ • `.olt/mailboxes/<id>/`     ││ • Inbox Latency SLA Audit    │
│ • `bun harness.ts msg:recv`  ││ • Signed MessageEnvelope     ││ • Broken Loop Detection      │
│ • `bun harness.ts msg:poll`  ││ • `.olt/locks/` Centralized  ││ • Auto-Heal Corrupted Cursor │
│ • `bun harness.ts msg:list`  ││ • POSIX flock Mutexes        ││ • Orphaned Mailbox Pruning   │
└──────────────────────────────┘└──────────────────────────────┘└──────────────────────────────┘
               │                             │                             │
               └─────────────────────────────┼─────────────────────────────┘
                                             ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                               ZERO RAW JSONL READING RULE                                   │
│ ─────────────────────────────────────────────────────────────────────────────────────────── │
│ • Agents interact exclusively through Harness CLI commands (`msg:*`, `task:*`, `queue:*`)   │
│ • Direct parsing of raw .jsonl files is strictly banned across all YAML manifests           │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Level 3: Disjoint Scope Boundaries

| Scope Domain             | Path Specification                                                                                                                                                 | Access Contract       |
| :----------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------- |
| **Write Scope (Lane A)** | `olt/scripts/src/cli/commands/msg-send.ts`, `olt/scripts/src/cli/commands/msg-recv.ts`, `olt/scripts/src/cli/commands/msg-poll.ts`, `tests/unit/cli/msg-ops.test.ts` | Exclusive Write Lease |
| **Write Scope (Lane B)** | `olt/scripts/src/communication/mailbox/mailbox-paths.ts`, `olt/scripts/src/policy/io-safety.ts`, `tests/unit/communication/mailbox-locks.test.ts`                  | Exclusive Write Lease |
| **Write Scope (Lane C)** | `olt/scripts/src/reporting/doctor/mailbox-health-engine.ts`, `olt/scripts/src/reporting/doctor/engines.ts`, `tests/unit/doctor/mailbox-health.test.ts`             | Exclusive Write Lease |
| **Write Scope (Lane D)** | `olt/agents/*.yaml` (Manifests communication contract update)                                                                                                      | Exclusive Write Lease |
| **Read-Only Scope**      | `olt/scripts/src/core/`, `.olt/mailboxes/`, `.olt/locks/`                                                                                                          | Read-Only             |

---

## Level 4: Atomic Implementation Tasks Matrix

| Task ID         | Target File Path                                            | Exact TypeScript Symbols / Signatures                               | Deliverable & Contract ($\le 300$ lines, 0 comments)                                                                                                    |
| :-------------- | :---------------------------------------------------------- | :------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task-msg-1.1`  | `olt/scripts/src/cli/commands/msg-send.ts`                  | `msgSendCommand(flags: Flags): Promise<JsonObject>`                | Implement `msg:send` CLI command with HMAC signing and `.olt/locks/` POSIX flock protection.                                                             |
| `task-msg-1.2`  | `olt/scripts/src/cli/commands/msg-recv.ts`                  | `msgRecvCommand(flags: Flags): Promise<JsonObject>`                | Implement `msg:recv` CLI command with cursor tracking and unread message indexing.                                                                      |
| `task-msg-1.3`  | `olt/scripts/src/cli/commands/msg-poll.ts`                  | `msgPollCommand(flags: Flags): Promise<JsonObject>`                | Implement `msg:poll` CLI command supporting polling interval and timeout flags.                                                                          |
| `task-msg-1.4`  | `tests/unit/cli/msg-ops.test.ts`                            | `describe("Mailbox CLI Ops", ...)`                                  | Unit test validating end-to-end `msg:send`, `msg:recv`, `msg:poll`, and `msg:list`.                                                                      |
| `task-msg-2.1`  | `olt/scripts/src/communication/mailbox/mailbox-paths.ts`    | `resolveMailboxLockPath(agentId: string): string`                   | Consolidate all mailbox lock paths into `.olt/locks/mailboxes/`.                                                                                         |
| `task-msg-2.2`  | `olt/scripts/src/policy/io-safety.ts`                       | `resolveSystemLockPath(lockName: string): string`                   | Relocate repository flock files (`backlog.flock`, `defects.flock`) to `.olt/locks/`.                                                                     |
| `task-msg-3.1`  | `olt/scripts/src/reporting/doctor/mailbox-health-engine.ts` | `checkMailboxHealth(): Promise<DoctorCheckResult>`                  | Implement health checks for inbox latency SLA, broken agent loops, and auto-healing corrupted cursors.                                                    |
| `task-msg-3.2`  | `tests/unit/doctor/mailbox-health.test.ts`                  | `describe("Mailbox Health Engine", ...)`                            | Unit test verifying doctor mailbox audit and auto-healing behavior.                                                                                      |
| `task-msg-4.1`  | `olt/agents/*.yaml`                                         | `communication_contract: { preferred_channel: "cli_mailbox", ... }` | Add communication contract section to agent manifests banning direct raw `.jsonl` reading.                                                               |

---

## Level 5: Falsifiable Gate Verification Commands

```bash
# Gate 1: Mailbox CLI Operations
bun test tests/unit/cli/msg-ops.test.ts

# Gate 2: Mailbox Lock Consolidation
bun test tests/unit/communication/mailbox-locks.test.ts

# Gate 3: Doctor Mailbox Health Engine
bun test tests/unit/doctor/mailbox-health.test.ts

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

  [Wave 1: Lock Consolidation & Path Resolution]
      ├── Task msg-2.1 (Mailbox Lock Paths) ─────────┐
      ├── Task msg-2.2 (System Lock Paths)  ─────────┴──► [Gate 2: Lock Consolidation Test]
      │
  [Wave 2: CLI Commands & Doctor Engine]
      ├── Task msg-1.1 (msg:send) ───────────────────┐
      ├── Task msg-1.2 (msg:recv) ───────────────────┼──► [Gate 1: Mailbox CLI Ops Test]
      ├── Task msg-1.3 (msg:poll) ───────────────────┤
      ├── Task msg-1.4 (CLI Ops Unit Test) ──────────┘
      │
      ├── Task msg-3.1 (Mailbox Health Engine) ──────┐
      └── Task msg-3.2 (Doctor Health Test)    ──────┴──► [Gate 3: Doctor Mailbox Test]
                                                                  │
                                                                  ▼
  [Wave 3: Agent Manifests & Invariant Seal]
      ├── Task msg-4.1 (Agent Manifest Contracts) ───┐
      └── Task msg-5.1 (System Seal & task:check) ───┴──► [Gate 4: task:check]
```

**Work/Span Calculation**:

- Total Work ($W$): 9 discrete tasks $\approx 18$ minutes.
- Critical Path Span ($S$): 3 sequential wave barriers $\approx 6$ minutes.
- Optimal Concurrency: $P = \lceil W / S \rceil = \lceil 18 / 6 \rceil = 3$ concurrent implementers.
- Hard Concurrency Cap: Never exceed 50 active subagents across all tiers.

---

## Level 8: Exhaustive Traceability Matrix

| Backlog / Defect ID                                           | Title / Requirement                                | Resolved By Tasks                                            | Falsifiable Gate Verification Target                   |
| :------------------------------------------------------------ | :------------------------------------------------- | :----------------------------------------------------------- | :----------------------------------------------------- |
| `fb-1788021600000-mandatory-mailbox-communication-engine`     | Harness Mailbox IPC CLI Commands (`msg:*`)         | `task-msg-1.1`, `task-msg-1.2`, `task-msg-1.3`, `task-msg-1.4` | `bun test tests/unit/cli/msg-ops.test.ts`              |
| `fb-1788021600000-mandatory-mailbox-communication-engine`     | Centralized Locks in `.olt/locks/`                 | `task-msg-2.1`, `task-msg-2.2`                               | `bun test tests/unit/communication/mailbox-locks.test.ts` |
| `fb-1788021600000-mandatory-mailbox-communication-engine`     | Doctor `MailboxHealthEngine` & Auto-Heal           | `task-msg-3.1`, `task-msg-3.2`                               | `bun test tests/unit/doctor/mailbox-health.test.ts`    |
| `fb-1788021600000-mandatory-mailbox-communication-engine`     | Ban Raw JSONL Reading Across Agent Manifests       | `task-msg-4.1`                                               | `bun ~/.agents/skills/olt/scripts/harness.ts task:check --repo .` |

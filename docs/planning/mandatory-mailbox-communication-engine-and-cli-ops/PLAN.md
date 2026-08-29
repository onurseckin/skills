# Blueprint: Mandatory Harness Mailbox IPC Communication System, CLI Ops & Doctor Health Engine

**Domain:** `communication` / `cli` / `reporting`  
**Priority:** `CRITICAL`  
**Status:** `READY_FOR_EXECUTION`

---

## 1. Problem Statement & Architectural Gap

Currently, agents rely on host-native subagent messaging tools (`send_message`) or attempt to read raw `.jsonl` files directly rather than using the file-backed `.olt/mailboxes/<agent_id>/` system.

As a result:

1. The harness CLI lacks first-class CLI commands (`msg:send`, `msg:recv`, `msg:poll`, `msg:list`).
2. Inter-agent messages lack durable file-locking protection and cryptographic HMAC verification.
3. The `doctor` diagnostic command lacks a `MailboxHealthEngine` to detect message starvation, unread high-priority alerts, broken agent communication loops, or corrupted cursors.
4. Agents lack explicit communication contracts in their YAML manifests and sometimes parse raw `.jsonl` files directly, burning context and causing state desynchronization.

---

## 2. Target Architecture & Invariants

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│          MANDATORY HARNESS MAILBOX IPC & DOCTOR HEALTH ARCHITECTURE         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ CLI Command Interface (Sole Communication & Single Source of Truth) ]   │
│    • `bun harness.ts msg:send --to <agent_id> --type <type> --body '...'`  │
│    • `bun harness.ts msg:recv --actor <agent_id> [--wait]`                  │
│    • `bun harness.ts msg:poll --actor <agent_id> --interval 500`            │
│    • `bun harness.ts msg:list --actor <agent_id>`                           │
│                                                                             │
│  [ Filesystem Layout & Lock Isolation ]                                     │
│    • `.olt/mailboxes/<agent_id>/inbox.jsonl` (Signed MessageEnvelope)       │
│    • `.olt/mailboxes/<agent_id>/outbox.jsonl`                               │
│    • `.olt/mailboxes/<agent_id>/cursor.json`                                │
│    • `.olt/locks/mailboxes/<agent_id>.lock` (POSIX flock mutex)             │
│    • `.olt/locks/` (All repository flock files consolidated here)           │
│                                                                             │
│  [ Doctor Diagnostic & Auto-Healing Engine (`mailbox-health-engine.ts`) ]   │
│    • Check 1: Inbox Latency & Starvation (flags unread msgs >120s)          │
│    • Check 2: Communication Link Integrity (audits Implementer-Validator)  │
│    • Check 3: Quarantine Audit (flags corrupt HMAC signatures)              │
│    • Check 4: Auto-Healing Cursor Resync (fixes corrupted cursor.json)      │
│    • Check 5: Orphaned Mailbox Pruning (archives dead agent mailboxes)      │
│                                                                             │
│  [ Zero Raw JSONL Reading Rule ]                                            │
│    • Agents MUST NEVER parse raw `.jsonl` files directly with file tools.   │
│    • All communication and queue interactions flow 100% via Harness CLI.    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Implementation Tasks Breakdown

| Task ID          | Component / File                                            | Deliverable                                                                                                                                        | Gate Verification                  |
| :--------------- | :---------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------- |
| **`task-msg-1`** | `olt/scripts/src/cli/commands/msg-send.ts`                  | Implement `msg:send` CLI command: HMAC signs payload, acquires flock in `.olt/locks/`, appends to recipient `inbox.jsonl`.                         | Unit tests in `tests/unit/cli/`    |
| **`task-msg-2`** | `olt/scripts/src/cli/commands/msg-recv.ts` & `msg-poll.ts`  | Implement `msg:recv` and `msg:poll` CLI commands with cursor tracking and optional blocking wait.                                                  | Unit tests in `tests/unit/cli/`    |
| **`task-msg-3`** | `olt/scripts/src/communication/mailbox/mailbox-paths.ts`    | Update lock directory resolution to strictly target `.olt/locks/` across all communication modules.                                                | Path resolution tests              |
| **`task-msg-4`** | `olt/scripts/src/policy/io-safety.ts`                       | Relocate all general repository flock locks (`.policy.lock`, `backlog.flock`, `defects.flock`) to `.olt/locks/`.                                   | I/O lock tests                     |
| **`task-msg-5`** | `olt/scripts/src/reporting/doctor/mailbox-health-engine.ts` | Implement `checkMailboxHealth` in doctor: audit unread SLA (>120s), broken agent loops, auto-heal corrupted cursors, and prune orphaned mailboxes. | Unit tests in `tests/unit/doctor/` |
| **`task-msg-6`** | `olt/scripts/src/reporting/doctor/engines.ts` & `doctor.ts` | Re-export `checkMailboxHealth` and register it in the master `doctor` CLI execution pipeline.                                                      | Master doctor E2E tests            |
| **`task-msg-7`** | `olt/scripts/src/cli/help.ts`                               | Enhance interactive `--help` for all `msg:*` commands with clear usage examples, payload schemas, and troubleshooting tips.                        | CLI help render test               |
| **`task-msg-8`** | `olt/agents/*.yaml` (All 28 Manifests)                      | Add `communication_contract` section defining peer communication channels, and strictly ban direct raw `.jsonl` reading.                           | Manifest validation test           |

---

## 4. Acceptance Criteria & Invariants

1. **First-Class CLI Ops**: `bun harness.ts msg:send`, `msg:recv`, `msg:poll`, and `msg:list` are fully operational and documented.
2. **Comprehensive Doctor Health Engine**: `bun harness.ts doctor` actively verifies mailbox latency, cursor integrity, quarantine logs, and auto-heals corrupted cursors.
3. **Consolidated Locks**: All lock and flock files strictly reside inside gitignored `.olt/locks/`.
4. **Single Source of Truth**: Agents interact exclusively through Harness CLI commands; zero raw `.jsonl` reads.
5. **Modularity & Zero Comments**: All files strictly $\le 300$ physical lines, explicit named exports in `index.ts`, and 0 comments in `.ts` files.

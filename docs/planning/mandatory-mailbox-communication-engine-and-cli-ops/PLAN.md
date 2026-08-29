# Blueprint: Mandatory Harness Mailbox IPC Communication System & CLI Integration

**Domain:** `communication` / `cli`  
**Priority:** `CRITICAL`  
**Status:** `READY_FOR_EXECUTION`

---

## 1. Problem Statement & Architectural Gap

Currently, agents rely on host-native subagent messaging tools (`send_message`) instead of the file-backed `.olt/mailboxes/<agent_id>/` system.

As a result:

1. The harness CLI lacks first-class CLI commands (`msg:send`, `msg:recv`, `msg:poll`, `msg:list`).
2. Inter-agent messages lack durable file-locking protection and cryptographic HMAC verification.
3. Lockfiles are scattered across the `.olt/` root instead of being isolated in `.olt/locks/`.

---

## 2. Target Architecture & Invariants

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│               MANDATORY HARNESS MAILBOX IPC COMMUNICATION BUS               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ CLI Command Interface ]                                                  │
│    • `bun harness.ts msg:send --to <agent_id> --type <type> --body '...'`  │
│    • `bun harness.ts msg:recv --actor <agent_id> [--wait]`                  │
│    • `bun harness.ts msg:poll --actor <agent_id> --interval 500`            │
│    • `bun harness.ts msg:list --actor <agent_id>`                           │
│                                                                             │
│  [ Filesystem Layout ]                                                      │
│    • `.olt/mailboxes/<agent_id>/inbox.jsonl` (Signed MessageEnvelope)       │
│    • `.olt/mailboxes/<agent_id>/outbox.jsonl`                               │
│    • `.olt/mailboxes/<agent_id>/cursor.json`                                │
│    • `.olt/locks/mailboxes/<agent_id>.lock` (POSIX flock mutex)             │
│    • `.olt/locks/` (All repository flock files consolidated here)           │
│                                                                             │
│  [ Mandatory Agent Communication Protocol ]                                 │
│    • Manifests require all peer coordination to execute via `msg:send`      │
│    • Chatter guard intercepts and blocks unauthorized main-thread leaks     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Implementation Tasks Breakdown

| Task ID          | Component / File                                           | Deliverable                                                                                                                  | Gate Verification               |
| :--------------- | :--------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- | :------------------------------ |
| **`task-msg-1`** | `olt/scripts/src/cli/commands/msg-send.ts`                 | Implement `msg:send` CLI command: HMAC signs payload, acquires flock in `.olt/locks/`, appends to recipient `inbox.jsonl`.   | Unit tests in `tests/unit/cli/` |
| **`task-msg-2`** | `olt/scripts/src/cli/commands/msg-recv.ts` & `msg-poll.ts` | Implement `msg:recv` and `msg:poll` CLI commands with cursor tracking and optional blocking wait.                            | Unit tests in `tests/unit/cli/` |
| **`task-msg-3`** | `olt/scripts/src/communication/mailbox/mailbox-paths.ts`   | Update lock directory resolution to strictly target `.olt/locks/` across all communication modules.                          | Path resolution tests           |
| **`task-msg-4`** | `olt/scripts/src/policy/io-safety.ts`                      | Relocate all general repository flock locks (`.policy.lock`, `backlog.flock`, `defects.flock`) to `.olt/locks/`.             | I/O lock tests                  |
| **`task-msg-5`** | `olt/agents/*.yaml` (All 28 Manifests)                     | Declare `msg:send`, `msg:recv`, `msg:poll` in `commands: [...]` and set mailbox IPC as the mandatory communication protocol. | Manifest validation test        |

---

## 4. Acceptance Criteria & Invariants

1. **First-Class CLI Ops**: `bun harness.ts msg:send` and `msg:recv` are fully operational and documented.
2. **Consolidated Locks**: All lock and flock files strictly reside inside gitignored `.olt/locks/`.
3. **Mandatory Inter-Agent Messaging**: All communication between Mind, Orchestrators, Coordinators, and Validators flows through `.olt/mailboxes/`.
4. **Modularity & Zero Comments**: All files strictly $\le 300$ physical lines, explicit named exports in `index.ts`, and 0 comments in `.ts` files.

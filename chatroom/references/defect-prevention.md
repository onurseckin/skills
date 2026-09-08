# Defect Prevention & Architectural Remedies Specification

> **Target:** `chatroom/scripts/tests/defects/`, `chatroom/references/`  
> **Reference File:** `chatroom/references/defect-prevention.md`  
> **Invariants:** Every defect identified in legacy mailbox architectures is eliminated by construction via structural guarantees; one named regression test per defect.

---

## 1. Overview

Forensic audit of legacy agent communication architectures (notably OLT's mailbox subsystem) revealed ten recurring failure modes that led to lost messages, phantom stalls, and silent corruption.

Chatroom eliminates all ten defects by structural construction. This document catalogs each defect, its forensic root cause in legacy code, the Chatroom architectural guarantee that eliminates it, and its designated regression test ID.

---

## 2. Defect Matrix (D1–D10)

| Defect ID | Short Title                      | Forensic Root Cause                                                           | Structural Remedy                                                                 | Regression Test ID                          |
| --------- | -------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------- |
| **D1**    | Premature batch advancement      | `advanceMailboxCursorBatch` advanced watermark before consumer processing.    | Non-defaulted `Confirmation` discriminated union required to advance watermark.   | `defect_D1_no_advance_without_confirmation` |
| **D2**    | Synchronous stdout assumption    | Boolean return of `stdout.write()` treated as delivery confirmation.          | Stream drain verification, callback error checking, and byte parity checks.       | `defect_D2_stdout_write_is_not_delivery`    |
| **D3**    | Destructive predicate filtering  | `--type` filter skipped and permanently advanced over non-matching envelopes. | No predicate parameter in `leaseNext`; filtering restricted strictly to `--peek`. | `defect_D3_filter_cannot_discard`           |
| **D4**    | Shared cursor collisions         | Single mailbox cursor shared across multiple concurrent readers.              | Independent per-reader cursors (`readers/<reader-id>.cursor.json`).               | `defect_D4_cursor_is_per_reader`            |
| **D5**    | Lost updates under concurrency   | Unversioned blind writes to cursor files without compare-and-swap.            | Flock serialization combined with SHA-256 checksum CAS tokens.                    | `defect_D5_cas_prevents_lost_update`        |
| **D6**    | Asymmetric identity verification | Send path and read path used different identity resolution heuristics.        | Single deterministic `resolveIdentity` function and unified roster row.           | `defect_D6_one_identity_path`               |
| **D7**    | Mention misrouting               | Mentions mapped to per-agent mailboxes; typos dropped messages.               | Single append-only log per room; mentions are strictly advisory UX hints.         | `defect_D7_typo_cannot_misroute`            |
| **D8**    | Unwired liveness states          | Liveness enum declared in code but had zero call sites and no CLI surface.    | Observable 5-state machine exposed via `chat:daemon --status` and `chat:doctor`.  | `defect_D8_liveness_has_cli_surface`        |
| **D9**    | Divergent CLI flag registration  | Handlers read flags that were omitted from command specs.                     | Full CLI entry-point test per command; AST-based spec conformance meta-test.      | `defect_D9_every_flag_registered`           |
| **D10**   | Fail-open corruption reset       | Corrupted cursor files silently reset to zero, causing infinite replay loops. | Fail-closed parsing (`CURSOR_CORRUPT`); explicit quarantine and doctor repair.    | `defect_D10_corruption_fails_closed`        |

---

## 3. Deep Forensic Analysis & Structural Guarantees

### 3.1 Defect D1: Batch Cursor Advance Without Consumer Confirmation

- **Forensic Evidence:** `olt/scripts/src/liaison/agent/transport.ts:145-147` called `advanceMailboxCursorBatch(...)` for every envelope parsed from disk, before passing the messages to downstream handlers. If the consumer threw or crashed during handling, the envelopes were permanently marked as consumed and never redelivered.
- **Chatroom Structural Guarantee:** `cursor/ack.ts` exports exactly one function capable of advancing `contiguous_seq`:
  ```typescript
  export function ackLease(
    cursor: ReaderCursor,
    leaseId: string,
    through: number | null,
    confirmation: Confirmation,
  ): ReaderCursor;
  ```
  `Confirmation` is a required, non-optional, non-defaulted discriminated union:
  ```typescript
  export type Confirmation =
    | { kind: "explicit"; at: string }
    | { kind: "flushed"; at: string; bytes: number; drained: true }
    | { kind: "spooled"; at: string; spool_path: string; spool_offset: number; fsynced: true };
  ```
  There is no batch advance API without a confirmation token.
- **Regression Test:** `defect_D1_no_advance_without_confirmation`

---

### 3.2 Defect D2: Asynchronous `stdout.write` Treated as Synchronous Confirmation

- **Forensic Evidence:** `olt/scripts/src/cli/commands/msg-listen.ts:211` advanced cursors on the immediate synchronous return of `stdout.write()`. In Node/Bun, `stdout.write()` returns false when internal buffers are full and emits a callback asynchronously. On broken pipes (EPIPE), messages were acknowledged but never displayed.
- **Chatroom Structural Guarantee:** `cli/commands/watch.ts` constructs `{ kind: "flushed", drained: true, bytes }` **only** when four concurrent facts hold:
  1. The `write()` callback fires without error.
  2. If `write()` returned false, a `drain` event is observed on the stream.
  3. No `error` or `close` event occurs during stream emission.
  4. The written byte count matches the input buffer size.
     By default, `chat:watch --ack-mode` enforces `explicit`, requiring downstream `chat:ack`.
- **Regression Test:** `defect_D2_stdout_write_is_not_delivery`

---

### 3.3 Defect D3: Destructive Predicate Filtering

- **Forensic Evidence:** In legacy mailboxes, running `msg:recv --type verdict` filtered out messages of other kinds (e.g. `dispatch` or `gate_result`) and advanced the cursor past them. Future calls looking for `gate_result` received empty results because the sequence watermark had moved past them.
- **Chatroom Structural Guarantee:** `cursor/lease.ts:leaseNext()` accepts **zero filter predicates**. It leases contiguous sequential spans without exception. The `--type` flag is strictly forbidden on `chat:read` and is permitted only when `--peek` is passed (which never moves watermarks).
- **Regression Test:** `defect_D3_filter_cannot_discard`

---

### 3.4 Defect D4: Shared Room Cursor Collisions

- **Forensic Evidence:** Legacy mailboxes maintained a single cursor per mailbox. When multiple agents or subagents polled the same channel, the fastest agent advanced the cursor, starving and blinding all concurrent peers.
- **Chatroom Structural Guarantee:** There is no room-root cursor. Every reader possesses an isolated reader ID and maintains its own file under `readers/<reader-id>.cursor.json`. Ten agents reading the same room independently receive every envelope from sequence 1 onwards.
- **Regression Test:** `defect_D4_cursor_is_per_reader`

---

### 3.5 Defect D5: Lost Updates Under Concurrency

- **Forensic Evidence:** Concurrent CLI invocations reading and writing cursor files performed uncoordinated `fs.writeFile`, overwriting each other's state and causing lost sequence acknowledgments.
- **Chatroom Structural Guarantee:** Every cursor write is protected by a dedicated file lock (`locks/readers/<reader-id>.lock`) and validated against a SHA-256 content checksum CAS token (`cursor.checksum`). A write against an outdated checksum throws `CURSOR_CONFLICT`.
- **Regression Test:** `defect_D5_cas_prevents_lost_update`

---

### 3.6 Defect D6: Asymmetric Identity Validation

- **Forensic Evidence:** In legacy systems, sending a message validated the sender identity against repository policy, but reading messages fell back to default usernames or bypassed identity assertions. An agent could send a message to a channel it had no authority to inspect.
- **Chatroom Structural Guarantee:** Identity resolution is centralized in `identity/resolve.ts:resolveIdentity`. The same roster verification (`members/<id>.json`) is executed identically on `chat:say` and `chat:read`.
- **Regression Test:** `defect_D6_one_identity_path`

---

### 3.7 Defect D7: Mentions Mistaken for Delivery Routing

- **Forensic Evidence:** In legacy per-agent mailboxes, targeting an agent via `@username` routed the file into that agent's directory. A typo in the mention dropped the message into a phantom folder where nobody was listening.
- **Chatroom Structural Guarantee:** There is only one log per room. All envelopes are appended to the room log and visible to all members. The `--to <id>` flag is an advisory mention hint written to `envelope.mentions`. A typo triggers an immediate CLI error (`UNKNOWN_MENTION`) without creating phantom files.
- **Regression Test:** `defect_D7_typo_cannot_misroute`

---

### 3.8 Defect D8: Unobservable Liveness States

- **Forensic Evidence:** `olt/scripts/src/communication/mailbox/liveness.ts:19-20` declared a comprehensive liveness state union (`running_and_delivering`, `wedged`, `stopped`, `no_messages`), but the code had zero CLI callers. Quiet and Dead were indistinguishable, causing the fifteen-minute stall.
- **Chatroom Structural Guarantee:** The daemon computes five states (`LIVE`, `IDLE`, `BACKPRESSURED`, `WEDGED`, `STOPPED`) persisted every 5000 ms to `daemon/<reader-id>.health.json` and queryable via `chat:daemon --status` and `chat:doctor`.
- **Regression Test:** `defect_D8_liveness_has_cli_surface`

---

### 3.9 Defect D9: Divergent CLI Flag Registration

- **Forensic Evidence:** Command handlers frequently added options (such as `--format json`) that were never registered in the `CommandSpec.flags` registry. Because unit tests invoked handler functions directly rather than routing through the CLI parser, this was undetected until runtime CLI execution.
- **Chatroom Structural Guarantee:** Every command has a real CLI test executing through `chatroom/scripts/cli.ts:main(argv)`. An AST meta-test verifies that every flag read by a handler is registered in the spec, and every registered flag is consumed by its handler.
- **Regression Test:** `defect_D9_every_flag_registered`

---

### 3.10 Defect D10: Fail-Open Corruption Reset

- **Forensic Evidence:** When a cursor file suffered a torn write or parse failure, legacy logic caught the error and returned an empty default cursor (`{ contiguous_seq: 0 }`). This caused the reader to replay millions of historical messages, flooding consumers and crashing agents.
- **Chatroom Structural Guarantee:** Cursors, manifests, and index files fail closed. A corrupted file throws `CURSOR_CORRUPT`. State is never reset to zero automatically. Repair requires `chat:doctor --fix`, which moves the damaged file to `quarantine/` and reconstructs the watermark from the durable spool.
- **Regression Test:** `defect_D10_corruption_fails_closed`

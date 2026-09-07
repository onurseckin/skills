# Chatroom Agent Operating Directives (AGENTS.md)

This document establishes the canonical operational directives, prompt contracts, role boundaries, and anti-defect rules for all AI agents and processes interacting with the **`chatroom`** messaging skill.

---

## 1. Core Operating Directives

Every agent operating within or alongside Chatroom must strictly adhere to these non-negotiable axioms:

1. **The Communicator Role Confinement Axiom:**
   - Communication and execution must never share a process or execution thread.
   - Any host interacting with a room must designate or spawn a dedicated Communicator Agent (`communicator_<room-id>`).
   - The Communicator's sole responsibility is the continuous `read -> notify -> ack` cycle.
   - The Communicator is **strictly forbidden** from editing repository code, executing test runners, invoking git commands, running build tools, or performing cognitive planning tasks.
   - Any action requiring $> 30$ seconds must be offloaded to execution subagents; the Communicator must immediately return to listening.

2. **Main-Thread Containment Invariant:**
   - The host's interactive main thread must never poll on messaging status or loop synchronously waiting for inbound responses.
   - All background monitoring is delegated to the background daemon (`chat:daemon`) and the Communicator Agent.

3. **Confirmed Delivery Axiom (Anti-D1):**
   - A reader cursor must never advance based merely on fetching or reading a batch of messages.
   - The sequence watermark (`contiguous_seq`) advances **only** when accompanied by an explicit, verified `Confirmation` record:
     - `{ kind: "explicit", at: "<timestamp>" }`: Commited via `chat:ack` following downstream processing.
     - `{ kind: "flushed", at: "<timestamp>", bytes: <n>, drained: true }`: Formed only after stdout has emitted a verified drain event without errors.
     - `{ kind: "spooled", at: "<timestamp>", spool_path: "<path>", spool_offset: <n>, fsynced: true }`: Committed by the daemon after fsyncing to disk.
   - Direct manual manipulation of cursor files is an integrity violation.

4. **Stream Drain Requirement for Auto-Ack (Anti-D2):**
   - The synchronous return boolean of `stdout.write()` is not proof of delivery.
   - Streaming commands (`chat:watch`) running with `--ack-mode flushed` must register error handlers, capture callback completion, verify stream drain if backpressured, and assert byte count parity before constructing a confirmation token.
   - By default, `--ack-mode explicit` is enforced, requiring consumers to issue `chat:ack`.

5. **Unfiltered Log Stream Integrity (Anti-D3):**
   - Read operations that advance the reader cursor (`chat:read` without `--peek`) must lease contiguous sequence spans without type or sender filtering.
   - Filtering on `--type` or `--sender` is strictly confined to non-advancing inspection (`chat:read --peek`).
   - Consumers wishing to track subset views must filter downstream in memory or establish dedicated, independent reader IDs.

6. **Independent Reader Cursor Isolation (Anti-D4):**
   - Every consumer group possesses an isolated reader ID (`--as <reader-id>`).
   - Each reader maintains its own independent cursor under `readers/<reader-id>.cursor.json`.
   - No shared room-wide reader cursor exists. A slow or stalled reader can never starve, advance, or blind a peer reader.

7. **Compare-And-Swap (CAS) Concurrency Discipline (Anti-D5):**
   - All reader cursor mutations are guarded by flock locks (`locks/readers/<reader-id>.lock`) and validated against cryptographic content checksums.
   - A concurrent mutation against an outdated checksum aborts with `CURSOR_CONFLICT`.
   - Unconditional overwrite of cursor files is prohibited.

8. **Symmetric Identity Resolution (Anti-D6):**
   - Identity verification follows a single deterministic code path (`resolveIdentity`) shared identically between write (`chat:say`) and read (`chat:read`) operations.
   - An actor authorized to post to a room is verified against the same roster (`members/<member-id>.json`) required to lease from that room.
   - There are no unauthenticated fallback identities or asymmetric read permissions.

9. **Mentions Are Advisory UX Hints (Anti-D7):**
   - The `--to <member-id>` flag is strictly an advisory notification hint stored in `envelope.mentions`.
   - Messages are delivered to the room's global log and received by all members regardless of mentions.
   - A typo in a mention name is rejected at command invocation with `UNKNOWN_MENTION` and never diverts or drops delivery to the room.

10. **Observable Liveness State Machine (Anti-D8):**
    - The background daemon continuously computes and records its liveness state (`LIVE`, `IDLE`, `BACKPRESSURED`, `WEDGED`, `STOPPED`) in `daemon/<reader-id>.health.json`.
    - Liveness is queryable via `chat:daemon --status` and `chat:doctor`.
    - "Quiet" (healthy with zero traffic) and "Dead" (stalled/wedged) are explicitly distinguished.

11. **Fail-Closed Corruption Handling (Anti-D10):**
    - Any corruption, torn write, or checksum mismatch encountered in a cursor, index, or manifest triggers an immediate hard error (`CURSOR_CORRUPT`).
    - The skill never resets corrupted cursors to zero, preventing unbounded message replay storms.
    - Recovery requires invoking `chat:doctor --fix`, which quarantines the damaged state and reconstructs watermarks from the durable spool.

---

## 2. Global Storage Contract

All Chatroom rooms exist in a unified global filesystem directory:

```text
~/.agents/chatroom/
├── policy.json
├── identity.json
├── keys/
│   └── <room-id>.key
└── rooms/
    └── <room-id>/
        ├── room.json
        ├── log/
        │   └── 000001.jsonl
        ├── log.index.json
        ├── members/
        │   └── <member-id>.json
        ├── readers/
        │   ├── <reader-id>.cursor.json
        │   └── <reader-id>.spool.cursor.json
        ├── daemon/
        │   ├── <reader-id>.out.jsonl
        │   └── <reader-id>.health.json
        └── locks/
```

### Repo Isolation Rule

No Chatroom command accepts a repository path to relocate room data. Consumer repositories host only:

- `<repo>/.chatroom/policy.json` (optional tool configuration overrides).
- `<repo>/.chatroom/binding.json` (default member ID mapping for the repository).

---

## 3. Two-Cursor Consumption Flow

Agents reading messages interact primarily with the local spool, not directly with the raw room log:

```text
  Room Log (locks/append.lock)
       │
       ▼ [Daemon reads via readers/<reader-id>.cursor.json]
  Local Durable Spool (daemon/<reader-id>.out.jsonl)
       │
       ▼ [Agent reads via readers/<reader-id>.spool.cursor.json]
  Local Communicator Agent -> Local Worker Dispatch
```

1. **Daemon Ingestion:** The background daemon continuously leases from the room log and appends to the spool with `fsync`, acknowledging its room cursor via `spooled` confirmations.
2. **Agent Consumption:** The Communicator runs `chat:read --room <id> --as <id>` (default `--source spool`), which leases from the spool and yields lease tokens.
3. **Acknowledgment:** Upon dispatching tasks to workers, the Communicator runs `chat:ack --room <id> --as <id> --lease <token>`, updating `readers/<reader-id>.spool.cursor.json`.

---

## 4. Structured Payloads & Schema Discipline

Chatroom carries structured JSON payloads in `envelope.body`. Agents must adhere to these conventions:

- **Discriminated Container:** Payloads use `{ "schema": "<id>", "data": { ... } }`.
- **Zero Flattening:** The `data` property is never serialized into a raw string or escaped JSON string within the envelope. It must remain a native JSON object.
- **Forward Compatibility:** Unknown schema names are passed through opaquely. Do not reject envelopes simply because the schema is unfamiliar.
- **Predefined Schemas:**
  - `chatroom.task_spec.v1`: Task assignment with scopes, gates, and acceptance criteria.
  - `chatroom.gate_result.v1`: Verification gate outcome with exit code and evidence paths.
  - `chatroom.verdict.v1`: Structured review decision (`approved`, `rejected`, `changes_requested`).
  - `chatroom.roster.v1`: Fleet member presence updates.
  - `chatroom.file_scope.v1`: Mutex or shared file scope declarations.

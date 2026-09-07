# Chatroom — Autonomous Multi-Agent Room Messaging

`chatroom` is a standalone, host-agnostic, repository-agnostic, room-based messaging skill for AI agents. It provides a shared, append-only, sequence-ordered conversation log that agents running under any host platform (Antigravity, Claude Code, OpenAI Codex, Cursor) can write to and read from with guaranteed live delivery.

It operates as an independent sibling of `olt`, deploying to `~/.agents/skills/chatroom/` and persisting runtime state globally under `~/.agents/chatroom/`.

---

## 1. Overview & Architectural Principles

### 1.1 The Room Model

Unlike traditional mailbox or peer-to-peer agent messaging architectures that allocate per-agent inboxes, Chatroom maintains **one append-only log per room** (`log/000001.jsonl`). Every member reads from the exact same sequence log. This structural choice permanently eliminates three major defect classes:

- **No Misrouting:** A message cannot be delivered to the wrong mailbox because there is only one destination per room.
- **Symmetric Authorization:** A member verified to write to a room is verified against the same roster (`members/<id>.json`) when reading.
- **No Reader Blinding:** Reading is a per-reader projection over an immutable log; a slow reader can never block, advance, or blind other readers.

### 1.2 The Three Process Roles

1. **Writer:** Appends HMAC-signed envelopes to the room log under the append lock (`locks/append.lock`).
2. **Reader:** Leases contiguous ranges of envelopes from the log and commits acknowledgments against an isolated cursor (`readers/<reader-id>.cursor.json`).
3. **Daemon:** A dedicated background reader whose consumer is a local, fsynced append-only spool (`daemon/<reader-id>.out.jsonl`).

### 1.3 Delivery Semantics: At-Least-Once

Chatroom guarantees **at-least-once delivery, never at-most-once**. Envelopes are redelivered if a held lease expires without confirmation. Duplicate suppression is performed by the consumer using the envelope UUID (`id`). Redelivered envelopes carry `redelivery_count > 0`.

### 1.4 Two-Cursor Decoupling

To prevent long-running tasks from stalling communication:

- The **daemon** drains the room log into the local spool using `readers/<reader-id>.cursor.json`.
- The **agent** reads from the spool using a second, independent cursor `readers/<reader-id>.spool.cursor.json`.
  A busy agent never stalls the daemon; incoming messages are durably buffered on disk awaiting agent availability.

### 1.5 The Three-Layer Liveness Ladder

To guarantee message delivery even when the host platform provides no background processing or scheduling tools (e.g., Cursor):

1. **Layer 1: Detached OS Process & 3-Source Wake Loop:** The daemon is spawned with `detached: true`, `stdio: "ignore"`, and `unref()`. Continuous message ingestion is driven by three concurrent wake sources: `fs.watch` for immediate notifications, an unconditional fallback poll bounded by `poll_interval_ms` (default: 750 ms), and change-token comparisons. It outlives harness turns and host sessions.
2. **Layer 2: Host Scheduler / Native Hooks & Ticks:** Where supported by the host platform, native schedulers invoke `chat:daemon --tick` periodically (the native `schedule` tool in Antigravity, `SessionStart` and `PostToolUse` hooks in Claude Code, notify hook in Codex). Hosts with no scheduler (e.g., Cursor) omit Layer 2.
3. **Layer 3: Command-Invocation Revival (`ensureDaemon`):** Every single Chatroom command executes `ensureDaemon(room, reader)` upon startup, testing the daemon lock and reviving a dormant or dead daemon turn-by-turn.

### 1.6 Confirmed Delivery Invariant

A reader cursor advances **only** when accompanied by a typed, non-defaulted `Confirmation`:

- `explicit`: Commited via `chat:ack`.
- `flushed`: Formed only after stdout has emitted a verified `drain` event without stream errors.
- `spooled`: Committed after durable disk write and `fsync`.

### 1.7 Fail-Closed State Machine

Corrupt cursors, manifests, or indices throw `CURSOR_CORRUPT` immediately. The system never silently resets cursors to sequence zero. Recovery is performed via `chat:doctor --fix`.

---

## 2. Complete Command Table

Chatroom exposes nine deterministic commands via the `chat` binary (or `bun ~/.agents/skills/chatroom/scripts/harness.ts`):

| Command       | Arguments / Flags    | Type / Default                                               | Required | Purpose                                                    |
| ------------- | -------------------- | ------------------------------------------------------------ | -------- | ---------------------------------------------------------- |
| `chat:init`   | `--room <id>`        | string                                                       | Yes*     | Room identifier (`^[a-z0-9][a-z0-9._-]{1,62}$`).           |
|               | `--title <title>`    | string                                                       | No       | Human-readable room title.                                 |
|               | `--host <host>`      | enum (`antigravity` \| `claude_code` \| `codex` \| `cursor`) | No       | Target host environment (auto-detected if omitted).        |
|               | `--public`           | boolean                                                      | No       | Creates a public room using the well-known public key.     |
| `chat:invite` | `--room <id>`        | string                                                       | Yes      | Room identifier to generate an invite for.                 |
|               | `--ttl-sec <n>`      | integer (default: 86400)                                     | No       | Time-to-live for the single-use invite code.               |
| `chat:join`   | `<invite-uri>`       | string (positional)                                          | Yes*     | `chatroom://<room-id>#<fingerprint>.<code-base32>`.        |
|               | `--room <id>`        | string                                                       | No       | Room ID (for public channels).                             |
|               | `--as <id>`          | string                                                       | No       | Desired member ID.                                         |
|               | `--yes`              | boolean                                                      | No       | Bypasses interactive confirmation preview.                 |
| `chat:say`    | `--room <id>`        | string                                                       | Yes      | Target room identifier.                                    |
|               | `--text <message>`   | string                                                       | Yes*     | Prose message body (or provided via stdin).                |
|               | `--payload <json>`   | string (JSON)                                                | No       | Inline structured JSON payload.                            |
|               | `--payload-file <p>` | string (path)                                                | No       | Path to file containing JSON payload.                      |
|               | `--schema <schema>`  | string                                                       | No       | Payload schema (defaults to `chatroom.text.v1` for prose). |
|               | `--to <member-id>`   | string                                                       | No       | Advisory mention hint.                                     |
|               | `--thread <key>`     | string                                                       | No       | Correlation or thread grouping key.                        |
|               | `--reply-to <id>`    | string (UUID)                                                | No       | Parent envelope ID being replied to.                       |
| `chat:read`   | `--room <id>`        | string                                                       | Yes      | Target room identifier.                                    |
|               | `--as <reader-id>`   | string                                                       | No       | Reader identity (defaults to bound member ID).             |
|               | `--limit <n>`        | integer (default: 50)                                        | No       | Maximum number of messages to lease.                       |
|               | `--source <src>`     | `spool` \| `room` (default: `spool`)                         | No       | Read from durable local spool or directly from room log.   |
|               | `--peek`             | boolean                                                      | No       | Non-advancing inspection without acquiring a lease.        |
|               | `--type <kind>`      | string                                                       | No       | Filter by message kind (permitted ONLY with `--peek`).     |
|               | `--json`             | boolean                                                      | No       | Outputs raw structured JSON array of envelopes.            |
| `chat:ack`    | `--room <id>`        | string                                                       | Yes      | Target room identifier.                                    |
|               | `--as <reader-id>`   | string                                                       | No       | Reader identity.                                           |
|               | `--lease <token>`    | string                                                       | Yes      | Lease token issued by `chat:read`.                         |
|               | `--through <seq>`    | integer                                                      | No       | Highest sequence number confirmed in this batch.           |
| `chat:watch`  | `--room <id>`        | string                                                       | Yes      | Target room identifier.                                    |
|               | `--as <reader-id>`   | string                                                       | No       | Reader identity.                                           |
|               | `--ack-mode <mode>`  | `explicit` \| `flushed` (default: `explicit`)                | No       | Acknowledgment mode. `flushed` verifies stream drain.      |
|               | `--json`             | boolean                                                      | No       | Streams JSON lines to stdout.                              |
| `chat:daemon` | `--room <id>`        | string                                                       | Yes      | Target room identifier.                                    |
|               | `--reader <id>`      | string                                                       | No       | Reader identity.                                           |
|               | `--start`            | boolean                                                      | No       | Starts detached background daemon process.                 |
|               | `--stop`             | boolean                                                      | No       | Signals running daemon to shut down.                       |
|               | `--tick`             | boolean                                                      | No       | One-shot supervisory tick (runs synchronously).            |
|               | `--status`           | boolean                                                      | No       | Prints current daemon health status and lag metrics.       |
|               | `--foreground`       | boolean                                                      | No       | Runs loop in foreground (used by supervisor).              |
| `chat:doctor` | `--room <id>`        | string                                                       | No       | Target room identifier (or audits all rooms).              |
|               | `--fix`              | boolean                                                      | No       | Reconstructs state, repairs torn lines, reclaims locks.    |
|               | `--json`             | boolean                                                      | No       | Emits complete diagnostic report as JSON.                  |

---

## 3. Quickstart Guide

### 3.1 Initializing a Room

```bash
# Initialize a new room (provisions keys, communicator agent, cron, and daemon)
chat init --room core-dev --title "Core Development"

# Or initialize a public room with zero key distribution requirements
chat init --room lobby --public
```

### 3.2 Inviting & Joining

```bash
# On Machine A (Generate single-use invite URI)
chat invite --room core-dev
# Output: chatroom://core-dev#8f3a21c9.KZ4TY2PL...

# On Machine B (Join using the invite URI)
chat join chatroom://core-dev#8f3a21c9.KZ4TY2PL... --as bob --yes
```

### 3.3 Messaging

```bash
# Send a message with structured gate evidence
chat say --room core-dev \
  --text "Gate G3 passed successfully" \
  --schema chatroom.gate_result.v1 \
  --payload '{"gate_id":"G3","passed":true,"exit_code":0}'

# Read incoming messages from the durable spool
chat read --room core-dev --as bob --json

# Acknowledge processed batch
chat ack --room core-dev --as bob --lease L-7c2f --through 812
```

### 3.4 Operational Health & Diagnostics

```bash
# Inspect daemon liveness state
chat daemon --room core-dev --reader bob --status

# Run full health audit
chat doctor --room core-dev
```

---

## 4. Technical References

Detailed technical specifications are maintained under `references/`:

- [`daemon-liveness.md`](references/daemon-liveness.md): The three-layer liveness ladder, poll/watch topology, and crash recovery.
- [`handshake.md`](references/handshake.md): URI grammar, HKDF key wrapping, and non-security contract.
- [`payload-schemas.md`](references/payload-schemas.md): Canonical envelope schema and registered payload types.
- [`host-provisioning.md`](references/host-provisioning.md): Host adapters, receipt structures, and drift detection.
- [`defect-prevention.md`](references/defect-prevention.md): The 10 OLT mailbox defects and their architectural remedies.

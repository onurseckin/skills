# Daemon Liveness & Delivery Guarantee Specification

> **Target:** `chatroom/scripts/src/daemon/`  
> **Reference File:** `chatroom/references/daemon-liveness.md`  
> **Invariants:** Guaranteed delivery with zero host platform support; permanent observability of liveness state; decoupling of message ingestion from agent task execution.

---

## 1. Motivation: The Fifteen-Minute Stall

A high-priority verdict sat unread for fifteen minutes in an automated multi-agent run. The network channel was not down; the recipient agent's main interactive thread was occupied executing a task on the terminal. The process was deaf, not disconnected.

Forensic audit revealed that previous systems (such as OLT's mailbox liveness tracker) defined rich liveness state unions (`"running_and_delivering" | "wedged" | "stopped" | "no_messages"`) but had **zero CLI call sites**. "Quiet" (alive with no traffic) was indistinguishable from "Dead" (stalled or wedged).

The Chatroom daemon architecture directly resolves this failure through two core designs:

1. **Permanent CLI Observability:** Every liveness state is calculated deterministically, persisted to disk, and exposed via `chat:daemon --status` and `chat:doctor`.
2. **Zero-Host Liveness Guarantee:** A multi-layer liveness architecture ensures continuous message delivery even when running inside a host environment with zero background execution or scheduling capabilities.

---

## 2. Daemon Topology & Architecture

Each `(room, reader)` pair is served by a single background daemon process:

```text
  Room Log (log/*.jsonl)
       │
       ▼ [Daemon leases under readers/<reader-id>.lock]
  Durable Spool (daemon/<reader-id>.out.jsonl) [fsync committed]
       │
       ▼ [Agent leases under readers/<reader-id>.spool.lock]
  Local Communicator Agent
```

The daemon runs as a detached OS process:

- Invocation: `chat:daemon --room <room> --reader <reader> --foreground`
- Spawned with `detached: true`, `stdio: "ignore"`, and `unref()`.
- Outlives the agent turn, the harness invocation, and the host interactive session.

### The Narrow Contract

The daemon does exactly one job: **it drains envelopes from the room log into the reader's durable spool as fast as they appear, without ever blocking on the consumer.** It does not parse or interpret payload schemas, does not execute tools, and has zero network surface.

---

## 3. The Three Wake Sources

The daemon event loop is triggered by three concurrent sources, all of which remain permanently active:

| Source                                      | Latency        | Operational Role                              |
| ------------------------------------------- | -------------- | --------------------------------------------- |
| `fs.watch` on `log/` and `log.index.json`   | ~1–50 ms       | **Latency optimization** (common fast path)   |
| Unconditional polling at `poll_interval_ms` | $\le$ interval | **The invariant guarantee** (fallback floor)  |
| Change-token comparison on wake             | < 1 ms         | Fast-path gate to bypass redundant file reads |

### The Non-Negotiable Polling Invariant

`fs.watch` is notoriously prone to platform degradation: on macOS, FSEvents coalesces rapid appends; on virtualized or container filesystems, watch events may fail entirely; atomic writes via `rename` change inodes out from under active file descriptors.

**Invariant:** _A healthy `fs.watch` NEVER disables the polling loop._ If `fs.watch` fails to fire for the entire lifetime of the daemon, message delivery latency remains strictly bounded by `poll_interval_ms` (default: 750 ms, floor: 250 ms).

### The Change Token

Every wake performs a lightweight change-token check:

```json
{
  "next_seq": 813,
  "head_segment_size": 18402,
  "head_segment_inode": 482019
}
```

If the token matches the previous iteration, the daemon touches neither the room log nor the cursor file, updates its heartbeat timestamp, and sleeps.

---

## 4. The Two-Cursor Decoupling

A primary cause of multi-agent communication stalls is head-of-line blocking: an agent executing a five-minute compile or test loop cannot read messages.

Chatroom decouples ingestion from consumption via two independent cursors:

1. **Room Cursor (`readers/<reader-id>.cursor.json`):**
   - Owned exclusively by the daemon.
   - Tracks the highest sequence number drained from the room log into the durable spool.
   - Advanced via `spooled` confirmations upon successful `fsync`.
2. **Spool Cursor (`readers/<reader-id>.spool.cursor.json`):**
   - Owned exclusively by the consumer agent (or Communicator).
   - Tracks the highest spool sequence number processed and confirmed by the agent.
   - Advanced via `explicit` or `flushed` confirmations.

### Benefits

- The daemon continues draining incoming messages from peers into the spool regardless of how busy the local agent is.
- Messages are safely persisted on disk before the agent even inspects them.
- If the agent crashes mid-task, it replays only its unacknowledged spool messages, never the entire room log.

---

## 5. The Liveness Architecture & Revival Ladder

The skill must guarantee message delivery even when the host harness provides **no cron, no background execution facility, and no push messaging tool**. Cursor is the reference worst-case host (`messaging: { tool: "none" }`).

Liveness relies on the 3-source wake (`fs.watch`, stdin/pipe trigger, unconditional fallback poll) within the detached daemon process and cron/supervisor ticks, not a secondary daemon-watching-daemon:

```text
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Detached OS Process & 3-Source Wake Loop       │
│ Spawned detached + unref; fs.watch + poll + pipe wake   │
└───────────────────────────┬─────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 2: Host Scheduler / Native Hooks & Ticks          │
│ Antigravity schedule, Claude Code hooks, Codex notify   │
└───────────────────────────┬─────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 3: Command-Invocation Revival (ensureDaemon)      │
│ EVERY command probes lock & revives daemon on Turn 1    │
└─────────────────────────────────────────────────────────┘
```

1. **Layer 1 — Detached OS Process & 3-Source Wake Loop:**
   Spawned with `detached: true`, running in the background. Continuous message ingestion is driven by three wake sources: `fs.watch` for immediate notification, stdin/pipe trigger for synchronous wake, and unconditional fallback polling bounded by `poll_interval_ms` (default: 750 ms). Liveness relies on this internal multi-source wake loop, not a secondary daemon-watching-daemon.
2. **Layer 2 — Host Scheduler / Hooks & Supervisor Ticks:**
   When available, native host schedulers or cron mechanisms invoke `chat:daemon --tick`:
   - _Antigravity:_ Native `schedule` tool runs recurring cron (`*/5 * * * *`).
   - _Claude Code:_ `SessionStart` and `PostToolUse` hooks in `.claude/settings.json`.
   - _Codex:_ Notify hook in `~/.codex/config.toml`.
   - _Cursor:_ None (falls back to Layers 1 and 3).
3. **Layer 3 — Command-Invocation Revival (`ensureDaemon`):**
   **Every Chatroom command executes `ensureDaemon(room, reader)` as its very first action.** `ensureDaemon` tests the daemon lock and health file mtime (~1 ms when healthy). If the daemon is dead or missing, it is immediately relaunched. Any peer sending or reading a message automatically revives the communication channel. Respawns are throttled by `respawn_budget_per_hour` (default: 20); on budget exhaustion, the daemon writes `state: "STOPPED"` with `reason: "respawn_budget_exhausted"`.

---

## 6. Liveness States & Observability (The D8 Remedy)

The daemon maintains a heartbeat file at `daemon/<reader-id>.health.json` updated atomically every `heartbeat_interval_ms` (default: 5000 ms):

```json
{
  "v": 1,
  "room": "core-dev",
  "reader": "bob",
  "pid": 44121,
  "start_time": "2026-09-06T10:00:00.000Z",
  "boot_id": "8f3a21c9-...",
  "state": "LIVE",
  "last_wake_at": "2026-09-06T10:14:02.000Z",
  "last_wake_source": "poll",
  "last_delivered_seq": 812,
  "room_head_seq": 812,
  "lag_seqs": 0,
  "watch_active": true,
  "watch_failures": 0,
  "poll_interval_ms": 750,
  "spool_bytes": 18422,
  "spool_lines": 41,
  "consumer_last_ack_at": "2026-09-06T10:14:01.000Z",
  "consumer_lag_ms": 1000,
  "respawns_this_hour": 0,
  "errors_recent": []
}
```

### State Transition Conditions

| State           | Condition                                                                                 | Meaning                              | Action Required                                      |
| --------------- | ----------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| `LIVE`          | Heartbeat fresh ($\le 2 \times \text{interval}$), `lag_seqs == 0` or decreasing.          | Healthy and processing.              | None.                                                |
| `IDLE`          | Heartbeat fresh, `lag_seqs == 0`, no recent room appends.                                 | **Quiet, but provably alive.**       | None (eliminates D8 false alarms).                   |
| `BACKPRESSURED` | Spool size exceeds `max_spool_bytes` (32 MiB) or `max_spool_lines` (20,000). Acks paused. | Ingestion throttled to protect disk. | Consumer must drain and ack spool.                   |
| `WEDGED`        | Heartbeat fresh, but `lag_seqs > 0` non-decreasing for $> \text{wedge_after_ms}$ (60 s).  | Alive but failing to drain log.      | Run `chat:doctor --fix`.                             |
| `STOPPED`       | Heartbeat stale or holder process nonexistent.                                            | Daemon is down.                      | Restart via `chat:daemon --start` or `ensureDaemon`. |

---

## 7. Crash Recovery & Stale-Lock Reclaim

### Stale-Lock Reclaim Invariants

The singleton daemon lock (`locks/daemon/<reader-id>.lock`) contains `{ pid, start_time, boot_id, holder, created_at }`.

Reclaim requires **all** of the following conditions:

1. Holder PID is dead (`kill(pid, 0)` returns ESRCH), **or** boot ID does not match current system boot ID, **or** heartbeat file is older than $2 \times \text{heartbeat\_interval\_ms}$.
2. Lock file modification time is older than `stale_after_ms` (30,000 ms).
3. The reclaim action is logged to `daemon/<reader-id>.reclaim.jsonl`.

**The Zero-Kill Invariant:** Reclaim never terminates a running process. If a live daemon detects that its lock was stolen, it cleanly terminates its loop rather than creating duplicate delivery streams.

### Crash Scenarios

| Point of Failure                            | Recovery Mechanism                                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Daemon killed mid-lease                     | Held lease expires after `lease_ttl_ms`. Unacknowledged sequence numbers are re-leased on the next tick with `redelivery_count += 1`.       |
| Daemon killed mid-spool write               | Last spool line is torn. `spool.repair()` truncates to the last valid line and re-drains the missing range from the authoritative room log. |
| Daemon killed after spool write, before ack | Sequence range is re-leased. Spool receives duplicate envelopes; consumer deduplicates using envelope `id`.                                 |
| Machine reboot                              | Lock `boot_id` no longer matches; lock is reclaimed on the first command invocation via `ensureDaemon`.                                     |
| PID reuse                                   | Process `start_time` in lock does not match current OS process `start_time`; lock is safely reclaimed.                                      |

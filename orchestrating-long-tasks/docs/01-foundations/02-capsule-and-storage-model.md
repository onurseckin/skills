# 02. Capsule & Storage Model

[⬅ Previous: Why Long Tasks Fail](./01-why-long-tasks-fail.md) | [Master Table of Contents](../README.md) | [Next: Lifecycle Walkthrough ➡](./03-lifecycle-walkthrough.md)

---

## 📦 What is a Run Capsule?

In `orchestrating-long-tasks`, all coordination state, historical records, and execution runtimes for a given task execution live inside an isolated directory called a **Run Capsule**.

By default, every run is created under:

```text
<repository-root>/.capsules/<run-id>/
```

Where `<run-id>` is a unique, URL-safe slug identifying the task execution (e.g., `auth-refactor-2026`, `feature-cache-layer`).

The capsule is completely self-contained, zero-dependency, and isolated from external package changes. If an AI agent crashes, or if the user switches from Antigravity to Claude Code or Codex, the incoming agent simply points to the `.capsules/<run-id>/` directory and resumes with 100% fidelity.

---

## 🗂️ Complete Directory Anatomy

Here is the exact filesystem structure of a live run capsule:

```text
.capsules/<run-id>/
├── prompt.md             # Immutable original prompt bytes (Read-only, mode 0444)
├── manifest.json         # Capture assurance, prompt SHA-256, runtime digest
├── state.json            # Authoritative current projection (derived from events)
├── events.jsonl          # Canonical append-only cryptographic hash chain
├── runtime/              # Pinned, zero-dependency Bun runtime entrypoint and modules
│   ├── harness.ts
│   ├── package.json
│   └── src/
├── planning/             # Requirements and graph definitions created by planner
│   ├── requirements.json
│   └── graph.json
├── packets/              # Immutable role packets dispatched to subagents
│   ├── planner-0.md
│   ├── planner-0.json
│   ├── task-1-implementer-1.md
│   └── task-1-validator-1.md
├── commands/             # Monitored command outputs, timing, exit codes & fingerprints
│   └── C-001/
│       ├── intent.json
│       ├── stdout.log
│       ├── stderr.log
│       └── record.json
├── evidence/             # Immutable quarantined reports and validation receipts
├── findings/             # Structured finding records (F-001, F-002, etc.)
└── handoff.md            # Deterministic, self-contained restart and takeover manual
```

---

## 🔒 The Core Storage Primitives

Let's examine the four core files that guarantee data integrity across crashes and resets:

```text
+-----------------------------------------------------------------------------------------------+
|                                    CORE STORAGE PRIMITIVES                                    |
+-----------------------------------------------------------------------------------------------+
|                                                                                               |
|   +-------------------+    SHA-256 Hash Bound    +-------------------+                        |
|   |     prompt.md     | <---------------------- |   manifest.json   |                        |
|   |  (Raw Bytes 0444) |                         | (Capture Metadata)|                        |
|   +-------------------+                         +-------------------+                        |
|                                                           |                                   |
|                                                           v                                   |
|   +-------------------------------------------------------------------+                       |
|   |                            events.jsonl                           |                       |
|   |  [Event 0] ---> [Event 1] ---> [Event 2] ---> [Event 3] (Chain)   |                       |
|   +-------------------------------------------------------------------+                       |
|                                     |                                                         |
|                                     v (Deterministic Derivation)                              |
|   +-------------------------------------------------------------------+                       |
|   |                             state.json                            |                       |
|   |  Current Projection: tasks, leases, findings, gates, completion   |                       |
|   +-------------------------------------------------------------------+                       |
|                                                                                               |
+-----------------------------------------------------------------------------------------------+
```

### 1. `prompt.md` & `manifest.json`

- **`prompt.md`**: Contains the exact raw bytes of the user's prompt. It is created with mode `0444` (read-only) and is never modified during the entire lifecycle of the run.
- **`manifest.json`**: Records the capture metadata:
  ```json
  {
    "schema": "harness.manifest",
    "version": 1,
    "run_id": "feature-auth-refactor",
    "created_at": "2026-08-14T16:00:00.000Z",
    "capture_mode": "file",
    "source_verified": true,
    "prompt_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "creator_bun_version": "1.3.14",
    "runtime_version": "1.0.0",
    "pinned_runtime_digest": "4a7d...39f1"
  }
  ```
  - **Capture Assurance**: If initialized via `--source-verified` with direct file/stdin retrieval, assurance is `source-verified`. If transcribed from chat history, assurance is `recorded-unverified`.

### 2. `events.jsonl` (The Cryptographic Hash Chain)

All mutations to the run state are modeled as **immutable events** appended to `events.jsonl`.
Every event line contains a forward-secure cryptographic hash chain:

```json
{
  "seq": 4,
  "timestamp": "2026-08-14T16:01:23.456Z",
  "actor": "coordinator",
  "kind": "task_claimed",
  "payload": {
    "task_id": "task-1",
    "agent_id": "agent-implementer-1",
    "role": "implementer",
    "lease_seconds": 1200,
    "token_sha256": "8f43...2a10",
    "expires_at": "2026-08-14T16:21:23.456Z"
  },
  "previous_event_sha256": "9b12...44f2",
  "event_sha256": "7c88...19e0"
}
```

The hash of Event $N$ is computed as:
$$\text{event\_sha256}_N = \text{SHA-256}(\text{previous\_event\_sha256}_N + \text{canonical\_json}(\text{event\_fields}))$$

**Why this matters:**

1. **Tamper Proof**: If an agent or bug edits an earlier event in the middle of the file, the entire remaining hash chain breaks immediately.
2. **Crash Resilience**: If a machine crashes mid-write, creating a "torn line" at the very end of `events.jsonl`, the forensic recovery engine detects the torn fragment, quarantines it, truncates back to the last valid hash link, and rebuilds state cleanly without data loss.

### 3. `state.json` (The Current Authoritative Projection)

`state.json` is a deterministic, materialized view computed by replaying `events.jsonl` from sequence 0 to sequence $N$.
It contains:

- Graph revision and active nodes/edges
- Current task status (`ready`, `leased`, `running`, `submitted`, `validating`, `done`, etc.)
- Active leases and token SHA-256 digests
- Open and resolved findings
- Mandatory gate execution receipts
- Authority decision records
- Completeness critic review records

> **Important**: Agents NEVER edit `state.json` directly. `state.json` is rewritten atomically by the harness CLI only after an event has been securely appended and synced to disk.

---

## 🛠️ The Lightweight Capsule Storage Architecture

Each run capsule under `.capsules/<run-id>/` is designed as a pure data and verification store. It contains zero code duplication and minimal disk overhead:

```text
.capsules/<run-id>/
├── manifest.json      # Run metadata & prompt SHA-256
├── prompt.md          # Verbatim captured prompt (mode 0444)
├── state.json         # Current state projection
├── events.jsonl       # Tamper-proof append-only event stream
├── graph.json         # Task DAG & schedule
├── packets/           # Immutable role packets (md + json pairs)
├── commands/          # Monitored execution logs & stdout/stderr
└── tmp/               # Run-scoped ephemeral scratch
```

### Benefits of the Pure Data Model

1. **Zero Disk Bloat**: Does not duplicate code files across runs, making initialization instantaneous and disk usage negligible.
2. **Deterministic Portability**: The entire `.capsules/<run-id>/` directory can be moved to another machine or archived; executing `bun orchestrating-long-tasks/scripts/harness.ts status --run .capsules/<run-id>` inspects and resumes the run cleanly.
3. **Consolidated Ephemeral Scratch**: All run-specific temporary data lives in `.capsules/<run-id>/tmp/`, keeping the repository root completely clean.

---

## ⚡ Concurrency & Crash Durability: Kernel `flock` & Atomic Writes

To allow multiple concurrent agents and watchdog processes to operate safely without corrupting files, the storage engine implements strict kernel-level locking and atomic filesystem mutations:

```text
[ Agent Action ]
       │
       ▼
1. Acquire POSIX kernel `flock` on inode (<run-dir>/.lock)
       │
       ▼
2. Read & verify `manifest.json`, `events.jsonl` hash chain
       │
       ▼
3. Validate mutation against current state machine invariants
       │
       ▼
4. Append new event to `events.jsonl` and execute `fdatasync()`
       │
       ▼
5. Write new state to temporary file: `state.json.tmp-<uuid>`
       │
       ▼
6. `fchmod(0644)` + `fsync()` on temporary file
       │
       ▼
7. Atomic rename: `rename(state.json.tmp-<uuid>, state.json)`
       │
       ▼
8. `fsync()` on containing directory (guarantees directory entry durability)
       │
       ▼
9. Release POSIX `flock`
```

### Key Properties of this Design:

- **Inode-Bound Locking**: Locking is performed on the underlying file inode. If a Rogue process deletes or renames the `.lock` path, the kernel lock remains securely held on the opened descriptor.
- **Fail-Closed on Collision**: If a lock cannot be acquired within the timeout window, the command fails with `CONFLICT` error rather than corrupting state.
- **No In-Memory Illusions**: State transitions only succeed once the bytes have been physically flushed to the OS storage controller via `fsync()`.

---

[⬅ Previous: Why Long Tasks Fail](./01-why-long-tasks-fail.md) | [Master Table of Contents](../README.md) | [Next: Lifecycle Walkthrough ➡](./03-lifecycle-walkthrough.md)

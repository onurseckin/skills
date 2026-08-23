# 02. Capsule & Storage Model

[⬅ Previous: Why Long Tasks Fail](./01-why-long-tasks-fail.md) | [Master Table of Contents](../README.md) | [Next: Lifecycle Walkthrough ➡](./03-lifecycle-walkthrough.md)

---

## 📦 The Dual-Layer Storage Model

Autonomous agent architectures frequently fail because they conflate **long-term repository governance** with **ephemeral runtime coordination**. When runtime scratch data is committed to Git history, repositories become bloated and polluted. Conversely, when governance policies, defect blunders, and task backlogs exist only in ephemeral process memory, the system suffers complete amnesia across successive agent runs.

To solve this, the OLT harness enforces a strict, physically separated **Dual-Layer Storage Model**:

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                             THE DUAL-LAYER STORAGE MODEL                                │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  ============================= PERSISTENT GOVERNANCE: olt/ =========================== │
│  (Committed to Git Repository • Cross-Generational Memory • Organizational Durability)   │
│                                                                                         │
│  olt/                                                                                   │
│  ├── policy.json              # Global quality gates, timeout rules, concurrency caps   │
│  ├── backlog.jsonl            # Cross-generational backlog & admitted objectives       │
│  ├── completed-tasks.jsonl    # Verifiable ledger of completed tasks + commit hashes   │
│  ├── defects.jsonl            # Active repository blunders & defect trackers            │
│  ├── completed-blunders.jsonl # Verifiable blunder remediations (permanent immunity)    │
│  └── telemetry.jsonl          # Longitudinal telemetry, Work/Span logs, token usage   │
│                                                                                         │
│                                           ▲                                             │
│               Historical Retrieval        │   Automated Promotion                       │
│               & Memory Queries            │   & Evidence Sealing                        │
│               (memory:query)              │   (blunder:audit / run:complete)            │
│                                           ▼                                             │
│                                                                                         │
│  ========================= RUNTIME WORKSPACE: .capsules/<run-id>/ ===================== │
│  (Gitignored • Inode-Bound POSIX flock • Forward-Secure SHA-256 Hash Chain)              │
│                                                                                         │
│  .capsules/<run-id>/                                                                    │
│  ├── prompt.md                # Byte-exact raw prompt (read-only mode 0444)             │
│  ├── manifest.json            # Capture assurance, SHA-256 binding, pinned runtime     │
│  ├── events.jsonl             # Canonical append-only cryptographic event hash chain    │
│  ├── state.json               # Deterministic materialized projection from events       │
│  ├── index.json               # Derived catalogue answering status queries in 1 read    │
│  ├── trace.md                 # Human-readable chronological execution audit trace      │
│  ├── handoff.md               # Regenerated restart brief for incoming agents           │
│  ├── captures.json            # Capture ledger: blob metadata and owner attribution     │
│  ├── planning/                # Enhanced plan outputs (enhanced-plan.md, mode 0444)     │
│  ├── packets/                 # Published immutable role capability contracts (0444)   │
│  ├── blobs/                   # Content-addressed deduplicated byte storage (<aa>/<sha>)│
│  ├── evidence/                # Human-readable hardlinks/copies pointing into blobs/   │
│  ├── quarantine/              # Recovered torn-tail event fragments from crash events   │
│  ├── runtime/                 # Pinned copy of harness scripts at plan:init time        │
│  └── summary/                 # Derived export bundle (graph.json, summary.md)          │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🏛️ Layer 1: The Persistent Governance Layer (`olt/`)

The `olt/` directory lives at the root of the repository and is **tracked directly in Git version control**. It provides the immutable historical memory and global policy constraints required for multi-generational autonomous development.

### Key Governance Artifacts:

1. **`olt/policy.json`**:
   The authoritative rulebook for all runs. Declares global timeout policies, lease durations, maximum retry boundaries (`max_repair_rounds: 6`), required checklist domains, and strict monorepo quality gates (e.g., zero TypeScript `any`, zero compiler suppressions).

2. **`olt/backlog.jsonl`**:
   The strategic backlog governed by Tier 0 Mind. Holds external feature requests, refactoring directives, and architectural initiatives. Items transition from `PENDING` $\to$ `ADMITTED` $\to$ `IN_PROGRESS` $\to$ `SEALED`.

3. **`olt/completed-tasks.jsonl`**:
   The immutable archive of all finished tasks across all runs. Each entry records the task ID, prompt line mappings, completing commit SHA, completion timestamp, and cryptographic proof hashes.

4. **`olt/defects.jsonl` & `olt/completed-blunders.jsonl`**:
   Active blunders, anti-patterns, and reasoning defects detected during agent runs are logged to `defects.jsonl`. When a blunder is verified as resolved (`blunder:audit --auto-promote`), it is permanently promoted to `completed-blunders.jsonl` alongside regression test assertions. This ensures **permanent regression immunity** across all future runs.

5. **`olt/telemetry.jsonl`**:
   Longitudinal telemetry tracking Brent Work/Span metrics ($W, S, P = \lceil W / S \rceil$), subagent token consumption, tool call distributions, and behavioral efficiency scores over time.

---

## 📦 Layer 2: The Runtime Capsule Layer (`.capsules/<run-id>/`)

A **Run Capsule** is an isolated, zero-dependency, crash-resilient directory created for an individual task or feature execution. By default, capsules are stored under:

```text
<repository-root>/.capsules/<run-id>/
```

Capsules are **gitignored**. They maintain the real-time execution state machine, cryptographic event log, file write leases, and command receipts.

If an AI agent crashes mid-task, hits a token limit, or is swapped for a different model host (e.g., transitioning from Claude Code to Antigravity), the replacement agent simply reads `.capsules/<run-id>/` and resumes execution with **100% state fidelity**.

---

## 🗂️ Complete Capsule Directory Anatomy

```text
.capsules/<run-id>/
├── prompt.md             # Immutable original prompt bytes (read-only, mode 0444)
├── manifest.json         # Capture assurance, prompt SHA-256, runtime pin, Bun version
├── README.md             # Generated layout documentation for the capsule
├── handoff.md            # Regenerated restart document: active state, live wave, gate status
├── state.json            # Authoritative current projection (derived from events.jsonl)
├── events.jsonl          # Canonical append-only cryptographic SHA-256 hash chain
├── index.json            # Derived catalogue answering routine queries in a single disk read
├── trace.md              # Derived step trace: chronological table of recorded events
├── captures.json         # Capture ledger: maps every stored blob to its owning command/task
├── planning/             # plan:enhance artifacts: enhanced-plan.md + json (mode 0444)
├── packets/               # Published role packet contracts (packet.md + metadata.json)
│   └── <role>-<hash>/
│       ├── packet.md             # Immutable contract text handed to the worker
│       └── metadata.json         # Role grant binding and SHA-256 digest
├── commands/             # Dedicated directory per recorded execution
│   └── C-<uuid>/
│       ├── record.json           # Direct argv, cwd, exit code, timings, log digests
│       └── attempt-1/
│           ├── stdout.log        # Raw standard output log
│           └── stderr.log        # Raw standard error log
├── blobs/                # <aa>/<sha256>: Single physical home for deduplicated byte-blobs (0444)
├── evidence/             # Human-readable hardlinks (or fallback copies) into blobs/
├── quarantine/           # Recovered torn-tail event fragments from crash events
├── runtime/              # Pinned harness scripts captured at plan:init time
└── summary/              # summary:export outputs: graph.json, summary.md, timeline.json
```

> [!NOTE]
> **Separation of Locks**: Lock files are not stored inside the capsule itself. They reside beside capsules in `.capsules/.locks/<run-id>/` because transient coordination state must never pollute durable state.

---

## 🔒 Core Storage Primitives & Cryptographic Integrity

Data integrity across unexpected crashes, kills, and resets is guaranteed by four interlocking primitives:

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                CORE STORAGE PRIMITIVES                                  │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│   ┌───────────────────┐    SHA-256 Hash Bound    ┌───────────────────┐                  │
│   │     prompt.md     │ ◄─────────────────────── │   manifest.json   │                  │
│   │ (Raw Bytes: 0444) │                          │(Capture Metadata) │                  │
│   └───────────────────┘                          └─────────┬─────────┘                  │
│                                                            │                            │
│                                                            ▼                            │
│   ┌───────────────────────────────────────────────────────────────────────────────┐     │
│   │                                 events.jsonl                                  │     │
│   │   [Event 0] ────► [Event 1] ────► [Event 2] ────► [Event 3] (Hash Chain)      │     │
│   └───────────────────────────────────────────────────────────────────────────────┘     │
│                                            │                                            │
│                                            ▼ (Deterministic Derivation)                 │
│   ┌───────────────────────────────────────────────────────────────────────────────┐     │
│   │                                  state.json                                   │     │
│   │   Materialized View: tasks, leases, findings, gates, completion               │     │
│   └───────────────────────────────────────────────────────────────────────────────┘     │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1. `prompt.md` & `manifest.json` (Immutable Prompt Capture)

- **`prompt.md`**: Contains the byte-exact original prompt provided by the user. It is written with filesystem permissions **`0444` (read-only)** during `plan:init` and is never modified.
- **`manifest.json`**: Cryptographically binds the prompt and runtime environment:
  ```json
  {
    "schema": "harness.manifest",
    "version": 1,
    "run_id": "auth-refactor-v2",
    "capsule_id": "e8b23c91d4e04f29a8bc31f948572e91",
    "created_at": "2026-08-23T03:00:00.000Z",
    "capture_mode": "file",
    "assurance": "source-verified",
    "source_verified": true,
    "prompt_bytes": 1420,
    "prompt_sha256": "4a7d2e8b9c1f4e3a2d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c",
    "bun_version": "1.3.14",
    "bun_compatibility": "same-major-not-older",
    "runtime_version": "0.1.0",
    "runtime_entrypoint": "runtime/harness.ts",
    "runtime_files": 482,
    "runtime_sha256": "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e"
  }
  ```
  - **Capture Assurance**: Stamped as `source-verified` if captured via direct stdin pipe or file read; stamped as `recorded-unverified` if transcribed from chat conversation.
  - **Runtime Pin**: The harness scripts are copied into `runtime/` and hashed at `plan:init`, ensuring the run executes with deterministic behavior even if global repository scripts are upgraded mid-flight.

### 2. `events.jsonl` (The Cryptographic SHA-256 Hash Chain)

Every state mutation in the harness is an immutable event line appended to `events.jsonl`. Each line embeds the SHA-256 hash of the previous line, establishing a tamper-proof cryptographic ledger:

```json
{
  "schema": "harness.event",
  "version": 1,
  "run_id": "auth-refactor-v2",
  "capsule_id": "e8b23c91…",
  "sequence": 7,
  "revision": 7,
  "timestamp": "2026-08-23T03:05:12.184Z",
  "actor": "imp-1",
  "kind": "task-claimed",
  "payload": {
    "task_id": "task-auth-token",
    "agent_id": "imp-1",
    "role": "implementer"
  },
  "previous_hash": "3f8a…7b1c",
  "projection": {
    "schema": "harness.state",
    "version": 1,
    "revision": 7,
    "event_sequence": 7,
    "event_head": "3f8a…7b1c"
  },
  "hash": "8d2e…94f0"
}
```

The hash of Event $N$ is calculated deterministically as:
$$\text{hash}_N = \text{SHA-256}\left(\text{previous\_hash}_N + \text{canonical\_json}(\text{event\_fields}_N)\right)$$

#### Security & Crash Properties:

1. **Tamper Proof**: Altering an event in the middle of `events.jsonl` invalidates every subsequent hash in the chain, triggering an immediate `INTEGRITY` error on the next read.
2. **Torn-Tail Forensic Recovery**: If a power failure or process kill occurs during an append, producing a partial/torn trailing line, the recovery engine detects the malformed line, moves it to `quarantine/torn-tail-<uuid>.jsonl`, truncates the file back to the last valid SHA-256 link, and cleanly reconstructs `state.json`.

### 3. `state.json` (Materialized State Projection)

`state.json` is a deterministic, materialized projection computed by replaying `events.jsonl` from sequence `0` to sequence $N$. It contains:

- **`graph`**: The topological DAG of tasks, dependency edges, and falsifiable gates.
- **`requirements`**: 100% line disposition mapping and requirement definitions.
- **`tasks`**: Active leases, token digests, findings, probe rounds, and repair histories.
- **`topology`**: Wave allocations and per-task scheduling decisions.
- **`agents`**: The grant ledger mapping agent IDs to approved role contracts.
- **`commands`**: Receipts and logs for all executed commands.
- **`completion_*`**: Whole-run sign-off, critic approvals, and verification receipts.

> [!IMPORTANT]
> **No In-Memory Illusions**: Agents **NEVER** edit `state.json` directly. `state.json` is rewritten atomically by the harness CLI only after a new event has been successfully appended to `events.jsonl` and flushed to disk.

---

## ⚡ Concurrency & Crash Durability: Kernel POSIX `flock` & Atomic Writes

To allow parallel subagents, supervisory coordinators, and background watchdog processes to safely mutate the capsule concurrently without race conditions or file corruption, OLT implements kernel-level locking and atomic two-phase file replacement:

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           ATOMIC MUTATION PIPELINE UNDER FLOCK                          │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│   [ Agent Command Invocation ]                                                          │
│                │                                                                        │
│                ▼                                                                        │
│   1. Acquire exclusive POSIX kernel `flock` on capsule directory inode (<run-dir>)       │
│                │                                                                        │
│                ▼                                                                        │
│   2. Read and verify `manifest.json` and `events.jsonl` cryptographic hash chain        │
│                │                                                                        │
│                ▼                                                                        │
│   3. Validate mutation against current state machine invariants & active leases         │
│                │                                                                        │
│                ▼                                                                        │
│   4. Compute next SHA-256 link, append event to `events.jsonl`, and execute `fdatasync`│
│                │                                                                        │
│                ▼                                                                        │
│   5. Derive new state projection and write to temporary file: `state.json.tmp-<uuid>`   │
│                │                                                                        │
│                ▼                                                                        │
│   6. `fchmod(0644)` + `fsync()` on temporary file descriptor                            │
│                │                                                                        │
│                ▼                                                                        │
│   7. Atomic rename: `rename("state.json.tmp-<uuid>", "state.json")`                     │
│                │                                                                        │
│                ▼                                                                        │
│   8. `fsync()` on parent directory descriptor (guarantees directory entry durability)   │
│                │                                                                        │
│                ▼                                                                        │
│   9. Release POSIX `flock` and return structured Markdown brief                         │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Architectural Highlights of Inode Locking:

- **Inode-Bound Security**: Locking is performed on the open file descriptor of the capsule directory inode. If a rogue process renames the path while the lock is held, the kernel lock remains pinned to the opened inode.
- **Fail-Closed Concurrency**: If a competing agent holds the lock beyond the timeout window, subsequent invocations fail safely with `LOCK_TIMEOUT` / `CONFLICT` instead of performing uncoordinated writes.
- **Journaling File-System Durability**: Step 8 explicitly executes `fsync()` on the containing directory descriptor. This ensures that the directory inode metadata update is committed to disk journals immediately, eliminating zero-byte file corruptions during hard OS reboots.

---

## 🪪 Run-Id Typing: An Identifier, Never a Path

A frequent defect in multi-agent scripts is treating `<run-id>` carelessly as a filesystem path fragment. If an agent naively concatenates `.capsules/` onto an already prefixed argument, it generates corrupted nested paths like `.capsules/.capsules/my-feature`.

The harness enforces strict run-ID normalization (`store/run-id.ts`'s `normalizeRunId`):

1. **Prefix Stripping**: Strips at most one leading `.capsules/` prefix.
2. **Path Separator Rejection**: Rejects any string still containing a path separator (`/` or `\`) after prefix removal.
3. **Regex Enforcement**: Enforces `RUN_ID_PATTERN` (`^[a-zA-Z0-9._-]{1,128}$`).

### CLI Command Conventions:

- **`plan:init` & `orchestrate`**: Take a **bare run ID** (`--run auth-v2`).
- **All other CLI commands** (`task:claim`, `task:submit`, `queue:wave`, `run:complete`): Take the **full capsule path** (`--run .capsules/auth-v2`).

---

## 🛠️ The Zero-JSON CLI & Markdown Briefs

To maximize token efficiency and prevent JSON parsing hallucinations in LLM subagents, the OLT CLI never requires subagents to construct complex JSON payloads. Agents interact exclusively through domain-specific colon commands.

Every command emits a compact, high-signal **Markdown brief** ($\le 30$ lines):

```text
### Task Leased: task-auth-token
- **Agent**: `imp-1`
- **Lease Token**: `qSGsImlAsT8wBTk2FyR7eeAKf5u0CEGspRRXGgtNgQo`
- **Duration**: 20 minutes (expires: 2026-08-23T03:25:00Z)
- **Assigned Write Scope**: `src/auth/`
- **Target Files**: `src/auth/token.ts:L45-L89`
- **Next Command**: bun harness.ts task:submit --run .capsules/auth-v2 --task task-auth-token --token qSGsImlAsT8wBTk2FyR7eeAKf5u0CEGspRRXGgtNgQo
```

Subagents parse these concise Markdown briefs without token bloat or schema serialization failures.

---

## ⚙️ Configuration Reference (`harness.config.json`)

Global behavior is configured via `harness.config.json` at the repository root:

```json
{
  "min_adversarial_probes": 1,
  "max_repair_rounds": 6,
  "max_branch_depth": 5,
  "max_agents": 100,
  "max_output_bytes": 10485760,
  "default_lease_seconds": 1800,
  "default_max_parallel": 4
}
```

- **`min_adversarial_probes`** (default `1`): Minimum mandatory probe rounds a validator must record before a task pass can be signed off.
- **`max_repair_rounds`** (default `6`): Rejection ceiling before a failing task is marked `escalated`.
- **`max_branch_depth`** (default `5`): Maximum permissible hierarchy depth for execution-time branching.
- **`max_agents`** (default `100`): Maximum subagent grants a run can issue across all waves.
- **`max_output_bytes`** (default `10485760` / 10MB): Maximum command output buffered before truncation.
- **`default_max_parallel`** (default `4`): Concurrency cap for parallel task execution during wave scheduling.

---

[⬅ Previous: Why Long Tasks Fail](./01-why-long-tasks-fail.md) | [Master Table of Contents](../README.md) | [Next: Lifecycle Walkthrough ➡](./03-lifecycle-walkthrough.md)

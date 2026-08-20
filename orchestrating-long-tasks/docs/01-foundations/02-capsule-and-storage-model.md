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
├── prompt.md             # Immutable original prompt bytes (read-only, mode 0444)
├── manifest.json         # Capture assurance, prompt SHA-256, runtime version
├── state.json            # Authoritative current projection (derived from events)
├── events.jsonl          # Canonical append-only cryptographic hash chain
├── .lock                 # The inode POSIX flock is taken on
├── planning/             # plan:enhance output: enhanced-plan.md + enhanced-plan.json (0444)
├── commands/             # One directory per recorded command
│   └── C-<uuid>/
│       ├── record.json           # argv, cwd, exit code, timings, repository binding, log digests
│       └── attempt-1/
│           ├── stdout.log
│           └── stderr.log
├── evidence/             # C-<uuid>.json evidence files, plus quarantined fragments
├── findings/             # One file per finding: finding-<task>-reject.json, probe-<task>-NN-N.json
├── reports/              # Submission, probe, review and critic reports
└── summary/              # summary:export output: graph.json, timeline.json, metrics.json, summary.md
```

There is no `plan.json` and no per-capsule `config.json`. The compiled graph, the requirements
document, the topology record, the branch ledger and the agent ledger are all keys inside
`state.json`, because they are projections of the event chain and nothing else may write them.

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

- **`prompt.md`**: Contains the exact raw bytes of the user's prompt. It is created with mode `0444` (read-only) via `plan:init` and is never modified during the entire lifecycle of the run.
- **`manifest.json`**: Records the capture metadata:
  ```json
  {
    "schema": "harness.manifest",
    "version": 1,
    "run_id": "slugger",
    "capsule_id": "f5c05b7bd29d4207a7dc0f93484717c3",
    "created_at": "2026-08-20T05:12:58.486Z",
    "capture_mode": "file",
    "assurance": "source-verified",
    "source_verified": true,
    "prompt_bytes": 200,
    "prompt_sha256": "ba20966731e18c4133cd16a43dd9d2f205c7d57844d58ce2e332cc5e2a91401d",
    "bun_version": "1.3.14",
    "runtime_version": "0.1.0"
  }
  ```
  - **Capture Assurance**: If initialized via `--prompt-stdin` or direct file retrieval, assurance is `source-verified`. If transcribed from chat history, assurance is `recorded-unverified`.

### 2. `events.jsonl` (The Cryptographic Hash Chain)

All mutations to the run state are modeled as **immutable events** appended to `events.jsonl`.
Every event line contains a forward-secure cryptographic hash chain:

```json
{
  "schema": "harness.event",
  "version": 1,
  "run_id": "slugger",
  "capsule_id": "f5c05b7b…",
  "sequence": 4,
  "revision": 4,
  "timestamp": "2026-08-20T05:22:19.372Z",
  "actor": "impl-slug",
  "kind": "task-claimed",
  "payload": { "task_id": "task-slug", "agent_id": "impl-slug", "role": "implementer" },
  "previous_hash": "9b12…44f2",
  "projection": {
    "schema": "harness.state",
    "version": 1,
    "revision": 4,
    "event_sequence": 4,
    "event_head": "9b12…44f2"
  },
  "hash": "7c88…19e0"
}
```

The hash of Event $N$ is computed as:
$$\text{hash}_N = \text{SHA-256}(\text{previous\_hash}_N + \text{canonical\_json}(\text{event\_fields}))$$

Event kinds are hyphenated, not underscored, and the vocabulary grew with the ledgers: alongside
`plan-init`, `plan-task-added`, `plan-compiled`, `task-claimed`, `task-submitted`, `validation-started`,
`review-recorded`, `command-recorded` and `run-completed`, a capsule now records `plan-enhanced`,
`topology-recorded`, `probe-recorded`, `branch-opened`, `branch-claimed`, `branch-submitted`,
`branch-collected`, `branch-abandoned`, `agent-registered`, `agent-reported` and `agent-released`.

Payload enrichment is **forward-only**. `review-recorded` carries `verdict`, `round`, `class` and
`finding_count`; older events keep the payload they were written with and are never backfilled,
because rewriting a payload would break every hash after it.

**Why this matters:**

1. **Tamper Proof**: If an agent or bug edits an earlier event in the middle of the file, the entire remaining hash chain breaks immediately.
2. **Crash Resilience**: If a machine crashes mid-write, creating a "torn line" at the very end of `events.jsonl`, the forensic recovery engine detects the torn fragment, quarantines it, truncates back to the last valid hash link, and rebuilds state cleanly without data loss.

### 3. `state.json` (The Current Authoritative Projection)

`state.json` is a deterministic, materialized view computed by replaying `events.jsonl` from sequence 0 to sequence $N$. The top-level keys of the sealed tutorial capsule, read back from disk, are:

```text
schema  version  revision  event_sequence  event_head
graph            # nodes, edges, gates, revision
requirements     # prompt_sha256, requirements[], dispositions[]
tasks            # per-task status, lease, findings, history, probe_round, repair_round
task_order       # deterministic scheduling order
planning         # digest of the plan:enhance document
planning_buffer  # uncompiled plan:add declarations
planning_tasks   # compiled task declarations
plan_history     # archived revisions
topology         # recorded waves and per-task scheduling decisions
agents           # the grant ledger
branches         # the branch ledger (absent until the first branch:open)
commands         # every recorded command
orphan_evidence  # evidence that arrived without a live owner

# the completion block, written by critic:start / critic:review / run:complete
completion_critic          # the assigned critic and its authorization
completion_critic_history  # every critic assignment, in order
completion_review          # the authoritative critic verdict
completion_reviews         # the verdict history
completion_verification    # the artifact and receipt re-verification
completion_result          # the sealed outcome

# repository binding, written whenever the harness inspects the worktree
current_repository_binding             # the commit and dirty-state the last inspection saw
current_repository_inspection_sha256   # digest of that inspection
repository_inspections                 # every recorded inspection
```

`branches`, `agents`, `topology` and `planning` are all optional: a capsule written before they
existed simply has none, and every reader must see that absence rather than a default.

> **Important**: Agents NEVER edit `state.json` directly. `state.json` is rewritten atomically by the harness CLI only after an event has been securely appended and synced to disk.

---

## 🛠️ The Zero-JSON CLI & Markdown Briefs

Instead of generating raw JSON files or separate markdown packets on disk, the harness provides domain-specific colon commands across twelve domains — `plan`, `queue`, `task`, `run`, `critic`, `summary`, `inspection`, `orchestrator`, `branch`, `agent`, `install` and `diagnostics`. The generated manifest at [`references/cli-capabilities.md`](../../references/cli-capabilities.md) is the single description of that surface; `bun harness.ts help` prints it from the terminal.

Each command emits a compact, structured Markdown brief ($\le 30$ lines) directly to standard output:

```text
### Task Leased: task-slug
- **Agent**: `impl-slug`
- **Lease Token**: `K6QeJSe2sZ4n4kcMTiH1oxGbXEKstjtLEBxG2F-2-5A`
- **Duration**: 20 minutes
- **Assigned Write Scope**: `src/slug.ts`
- **Note**: Pass `--token K6QeJSe2sZ4n4kcMTiH1oxGbXEKstjtLEBxG2F-2-5A` to `task:submit`.
```

Subagents parse these concise Markdown briefs without token bloat or error-prone JSON serialization.

---

## ⚙️ Configuration File (`harness.config.json`)

Global and repository-level defaults are controlled via `harness.config.json` (or `.harness.config.json`):

```json
{
  "min_adversarial_probes": 1,
  "max_repair_rounds": 6,
  "max_branch_depth": 5,
  "max_agents": 100,
  "max_output_bytes": 10485760,
  "default_lease_seconds": 1800,
  "default_max_parallel": 4,
  "strict_validation": true
}
```

- **`min_adversarial_probes`** (default `1`): Probe rounds a validator must record before `task:review --status pass` is allowed. A probe is a demand for proof, not a rejection.
- **`max_repair_rounds`** (default `6`): Recorded rejections a task may absorb before it becomes `escalated`.
- **`max_branch_depth`** (default `5`): Escalation tripwire on branch nesting, not a structural bound — termination is guaranteed by the proper-subset rule on write scopes. Crossing it escalates to a human.
- **`max_agents`** (default `100`): Total agent grants a run may issue across every depth. Assumed, not measured; `agent:register` and `branch:open` refuse once it is spent.
- **`max_output_bytes`** (default `10485760` / 10MB): Maximum command output buffered before truncation.
- **`default_lease_seconds`** (default `1800`): Sub-task lease duration for `branch:claim`. It does **not** govern `task:claim`, which defaults to 1200 seconds and is overridden per call with `--lease-seconds`.
- **`default_max_parallel`** (default `4`): Concurrency cap for independent tasks; `queue:wave` and `queue:list` read it rather than hardcoding one.
- **`strict_validation`** (default `true`): Enforces mandatory gate coverage.

A legacy `min_adversarial_rejections` key is still parsed, but it no longer governs the probe
requirement: a rejection is not a probe, and a file that sets only the old key leaves the probe count
at its default while the harness warns.

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
- **Evidence Assurance**: Commands recorded via `run:exec` capture stdout/stderr with exact timestamps and process exit codes, classified under `trusted_host_observed_v1`.

---

[⬅ Previous: Why Long Tasks Fail](./01-why-long-tasks-fail.md) | [Master Table of Contents](../README.md) | [Next: Lifecycle Walkthrough ➡](./03-lifecycle-walkthrough.md)

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
├── README.md             # The generated layout note: one line per entry and what it is for
├── handoff.md            # Regenerated restart document: state, live wave, gate assurance
├── manifest.json         # Capture assurance, prompt SHA-256, runtime pin, runtime version
├── state.json            # Authoritative current projection (derived from events)
├── events.jsonl          # Canonical append-only cryptographic hash chain
├── index.json            # Derived catalogue: the routine questions answered in one read
├── trace.md              # Derived step trace: one row per recorded event, in order
├── captures.json         # The capture ledger: every stored blob and who produced it
├── planning/             # plan:enhance output: enhanced-plan.md + enhanced-plan.json (0444)
├── packets/               # One directory per published role packet
│   └── <role>-<hash>/
│       ├── packet.md             # Immutable contract text handed to the dispatched agent
│       └── metadata.json         # packet_sha256, role, grant binding
├── commands/             # One directory per recorded command
│   └── C-<uuid>/
│       ├── record.json           # argv, cwd, exit code, timings, repository binding, log digests
│       └── attempt-1/
│           ├── stdout.log
│           └── stderr.log
├── blobs/                # <aa>/<sha256>: the one physical home for every captured byte-blob, 0444
├── evidence/             # Readable names hardlinked onto blobs/; holds no bytes of its own
├── quarantine/           # Event-log fragments recovery removed, kept byte for byte
├── reports/              # Submission, probe, review and critic reports
├── runtime/              # The harness scripts pinned at plan:init, unless --no-runtime-pin
└── summary/              # summary:export output: graph.json, timeline.json, metrics.json, summary.md
```

The lock the capsule is coordinated with is not stored here. It lives beside the capsules, in
`.capsules/.locks/<run-id>/`, because coordination state is not durable state.

There is no `plan.json` and no per-capsule `config.json`. The compiled graph, the requirements
document, the topology record, the branch ledger and the agent ledger are all keys inside
`state.json`, because they are projections of the event chain and nothing else may write them.

### 🪪 Run-Id Typing: An Identifier, Never a Path

`<run-id>` looks like a filesystem path fragment, and treating it as one is a real, documented
failure mode: a run id concatenated carelessly onto `.capsules/` can build a path like
`.capsules/.capsules/<run-id>` the instant a caller passes in a value that already carries the
prefix. The harness closes this with a single, narrow rule enforced in one place,
`store/run-id.ts`'s `normalizeRunId`:

1. Strip **at most one** leading `.capsules/` prefix. This exists because every read-side CLI
   command documents `--run .capsules/<run-id>` as the value to pass, and a caller who reuses that
   exact same string at a call site that instead expects a bare id (`plan:init`'s `--run`, or the
   autonomous loop runner's own base run id) is following the CLI's own convention, not making a
   mistake.
2. Refuse anything that **still** contains a path separator afterward — checked as the literal
   POSIX `/` character unconditionally, regardless of the host platform's own path separator, so a
   value copied from a POSIX shell is rejected identically everywhere the harness runs.
3. Only then is the result checked against `RUN_ID_PATTERN` (a 1–128 character slug: alphanumeric,
   `.`, `_`, `-`) and joined onto `.capsules/` to build the real directory.

The practical consequence is a real split in the CLI surface, and it is worth knowing which side of
it a command sits on before you type `--run`:

- **`plan:init`** and **`orchestrate`** take a **bare run id** (`--run my-feature`, `--run-id
my-feature`) — they are the two commands that _build_ the capsule path, so they are the two call
  sites `normalizeRunId` actually protects.
- **Every other command** — `plan:add`, `plan:compile`, `task:claim`, `queue:wave`, `run:complete`,
  and the rest — takes the **full capsule root** (`--run .capsules/my-feature`) and uses that value
  directly as a filesystem path with no further joining. Passing a bare id to one of these is a
  caller mistake, not a harness bug: there is nothing here to strip a prefix that was never there to
  begin with.

---

## 🔒 The Core Storage Primitives

Let's examine the primitives that guarantee data integrity across crashes and resets — the four
files at the heart of the hash chain, plus the blob store and the derived export that build on top
of them:

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
    "bun_compatibility": "same-major-not-older",
    "runtime_version": "0.1.0",
    "runtime_entrypoint": "runtime/harness.ts",
    "runtime_files": 479,
    "runtime_sha256": "1eac54785ea994a159cea10dde52362b36f48f72cfdd0b556f051a178efe6c77"
  }
  ```
  - **Capture Assurance**: If initialized via `--prompt-stdin` or direct file retrieval, assurance is `source-verified`. If transcribed from chat history, assurance is `recorded-unverified`.
  - **Runtime Pin**: `runtime_entrypoint`, `runtime_files` and `runtime_sha256` are absent when
    `--no-runtime-pin` was passed at `plan:init`; otherwise they name the pinned copy under `runtime/`
    that this capsule stays reproducible against, independent of what the global skill later becomes.
  - **`bun_compatibility`** is itself optional: a capsule written before this compatibility-policy
    field existed simply carries no such key, and integrity checking treats that as an absent
    declaration rather than a defect. Only a manifest that _does_ declare a policy is held to it, and
    it is always checked against the Bun version actually running right now, not the one that
    originally created the capsule.

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
packets          # published role-packet contracts, keyed by packet id
orphan_evidence  # evidence that arrived without a live owner
gate_proofs      # gate:prove verdicts, keyed by task (absent until the first gate:prove)
worktree_ledger  # per-task worktree assignments, when worktree isolation is on

# the plan-validator's own review of the compiled plan (C2) — absent on a run that never
# dispatched one; this role is an optional adversary, not a precondition every run acquires
plan_validation          # the live claim on the current graph revision, if one is open
plan_validation_history  # every plan-validation assignment, in order
plan_review              # the most recent recorded verdict
plan_reviews             # the verdict history

# the completion block, written by critic:start / critic:review / run:complete
completion_critic          # the assigned critic and its authorization
completion_critic_history  # every critic assignment, in order
completion_review          # the authoritative critic verdict
completion_reviews         # the verdict history
completion_verification    # the artifact and receipt re-verification
completion_result          # the sealed outcome

# repository binding, written whenever the harness inspects the worktree
baseline_repository_binding            # the commit and dirty-state at the run's first inspection
baseline_repository_inspection_sha256  # digest of that inspection (write-once)
current_repository_binding             # the commit and dirty-state the last inspection saw
current_repository_inspection_sha256   # digest of that inspection
repository_inspections                 # every recorded inspection
```

`branches`, `agents`, `topology`, `planning`, `plan_validation`, `gate_proofs` and `worktree_ledger`
are all optional: a capsule written before they existed simply has none, and every reader must see
that absence rather than a default. `plan_validation` in particular is absent on the majority of
runs — the plan-validator ([Chapter 02 §03](../02-requirements/03-authority-decisions-and-dispositions.md))
is an adversary the coordinator can choose to dispatch, not a step every run is retroactively
assumed to have taken.

> **Important**: Agents NEVER edit `state.json` directly. `state.json` is rewritten atomically by the harness CLI only after an event has been securely appended and synced to disk.

### 4. The Blob Store & Its Derived Catalogue (`blobs/`, `evidence/`, `captures.json`, `index.json`)

Four more entries from the directory anatomy above deserve their own explanation, because together
they answer "where did this exact byte sequence actually come from, and can I trust the name I'm
looking at it under":

- **`blobs/<aa>/<sha256>`** is the **one** physical home for every captured byte-blob in the
  capsule — a screenshot, a command's stdout, a stored report. A `BlobDescriptor` (identity, size,
  one capsule-relative path) is what every other record stores; nothing else in the capsule ever
  holds a second copy of the raw bytes. Writing a blob is a hash-then-copy-then-name operation
  (`copyAndHash`), deliberately in that order: hashing the source first and naming the destination
  second would risk naming a blob for bytes that changed underneath between the two steps.
- **`evidence/`** holds a _readable name_ for every blob, not a second copy of it — normally a
  hardlink (`linkSync`, same inode, zero extra bytes), so a human or another tool can open
  `evidence/screenshot-1.png` without needing to already know its SHA-256. On a filesystem that
  cannot hardlink (crossing a filesystem boundary, or one without hardlink support at all), the
  store falls back to an actual byte-for-byte copy rather than refusing to record the evidence at
  all — and it says so explicitly: the view's `storage` field reads `"copy"` instead of `"hardlink"`,
  a declared, deliberate duplication rather than a silent one.
- **`captures.json`** is the capture ledger: one record per stored blob, naming who produced it (a
  command id, a task id) if anyone did. A capture whose bytes match one already on file — the _exact
  same content_, not merely a similarly-named file — is recognised as the same capture and never
  becomes a second record under a second claimed owner; this dedup-by-content-hash rule exists
  because the opposite (re-attributing evidence by file name or timing proximity) is precisely how a
  single stale screenshot once ended up credited to every command in a run.
- **`index.json`** is a wholly **derived** catalogue — deleting it loses nothing, because every fact
  in it restates something whose one authoritative home is `state.json` or `captures.json`. What
  makes it safe to trust without re-deriving it on every read is that it records the exact chain
  position (`{sequence, head}`) and a digest of the capture ledger it was built from; a reader can
  tell in one comparison whether the index is still current or has fallen behind, rather than having
  to assume freshness or re-walk the whole capsule to check.

### 5. What `summary:export` Actually Produces (`summary/`)

`summary:export` is the one command that reads the whole capsule end to end and writes a
self-contained package for a human or a browser — never a second source of truth, only a rendering
of what `state.json` and `events.jsonl` already record. It writes four files, and the honesty rules
that govern the rest of this document apply here with no exceptions:

- **`graph.json`** — a machine-readable dataset: every node (implementer, validator, gate, critic,
  branch sub-agent), every edge between them, and a `run` key carrying whole-run facts (the raw
  prompt, the requirements document, a monotonic per-action step trace) that sits _beside_ `nodes`
  and `edges` rather than embedded inside them, so a renderer that knows nothing about orchestration
  semantics can still draw the graph correctly.
- **`summary.md`** — the human-readable sibling of `graph.json`, built from the identical shared
  object so the two can never disagree about what happened. Read top to bottom, it is meant to be
  the whole run, complete on its own.
- **`timeline.json`** and **`metrics.json`** — a per-action step trace and a rollup of counts (files
  touched, commands run, an estimated token cost). The token estimate (`estimated_tokens`) is a
  required field built from a byte-ratio proxy over whatever manifests and command logs the harness
  actually has — a missing input simply contributes zero bytes rather than blocking the estimate.
  Contrast that with `total_edge_traffic_exchanges`: there is no formula for it, only a real count
  summed from the graph that was actually generated, so when no graph exists this field is _omitted
  entirely_ rather than reported as a fabricated `0`.

The rule that governs every field of every one of these four files is the same one this chapter has
already used for `state.json` and `manifest.json`: a fact the capsule genuinely never recorded is
left out of the export, so a reader can always tell "the run never recorded this" apart from "the
exporter silently dropped it." Concretely: a command's exit code renders as the literal word
`unknown` rather than defaulting to `0` (which would misreport "never ran" as "succeeded"); a
screenshot nobody claimed is surfaced as explicitly unattributed evidence on the terminal node rather
than credited to whichever agent happened to be nearby; and a file's line-level diff, when the
harness could read one, is carried through **whole** rather than trimmed, because completeness — not
export size — is the stated constraint on this specific artifact. The deep schema of `graph.json`
itself, and how it differs from the plan DAG in `state.graph`, is
[Chapter 03's](../03-graph-scheduler/01-dependency-graph-theory.md) subject, not this one; what
matters here is that `summary/` is a derived export like `index.json`, governed by the identical
no-fabrication discipline as everything else in this capsule.

---

## 🛠️ The Zero-JSON CLI & Markdown Briefs

Instead of generating raw JSON files or separate markdown packets on disk, the harness provides domain-specific colon commands across fourteen domains — `plan`, `queue`, `task`, `run`, `critic`, `summary`, `inspection`, `orchestrator`, `branch`, `agent`, `authority`, `orphan`, `install` and `diagnostics`. The generated manifest at [`references/cli-capabilities.md`](../../../orchestrating-long-tasks/references/cli-capabilities.md) is the single description of that surface; `bun harness.ts help` prints it from the terminal.

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

### 🧾 How a Command Actually Runs

Every invocation goes through the same four ordered checks before a single line of the command's
own logic runs, in `cli/execute.ts`'s `execute()`:

1. **Resolve the command spec** from the registry, so the argument parser knows which flags this
   specific command takes (which are repeatable, which take a value) before it even tokenizes the
   rest of `argv`.
2. **Reject unexpected positionals** and **missing required flags** — pure argument shape checks,
   with no capsule read yet.
3. **Resolve who is asking.** The harness reads a fixed, small set of identity flags — `--agent`,
   `--validator`, `--critic`, `--actor` — and, for a handful of commands (`agent:register`,
   `agent:report`, `agent:release`, `queue:pop`, `critic:start`), skips the flag that names the
   _subject being acted upon_ rather than the caller (e.g. `agent:register --agent <new-id>` names
   who is being registered, not who is registering them; the acting identity for that call has to
   come from a different flag, `--actor`, or is absent). A blank, repeated, or malformed identity
   flag is treated as "no identity given" here — reporting _that_ mistake precisely is left to the
   command's own handler, which can phrase it far more specifically than a shared dispatch layer
   ever could.
4. **Check the resolved identity's grant against its role contract** — `assertGrantedCommand`, which
   looks the identity up in the run's own agent grant ledger and refuses the call outright if that
   role's contract (the same frontmatter contract described in
   [Chapter 04 §02](../04-multi-agent/02-immutable-role-packets.md)) does not list this command among
   what it may invoke. An identity with **no** grant at all is not refused here — nothing in this
   check applies to it — but it is then refused by whatever command-specific authority check applies
   downstream (a published role packet, a bearer token), so an unregistered agent still cannot act.

Step 4 only fires once `--run` names a capsule that actually exists and has a `state.json` to read;
`plan:init` itself, and any command run against a run id that doesn't exist yet, skips it entirely.
This ordering is deliberate: a role without permission for an action never even reaches the first
line of that action's own handler, but a plain argument mistake is always reported as exactly that,
never disguised as an authority refusal.

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
  "default_max_parallel": 4
}
```

- **`min_adversarial_probes`** (default `1`): Probe rounds a validator must record before `task:review --status pass` is allowed. A probe is a demand for proof, not a rejection.
- **`max_repair_rounds`** (default `6`): Recorded rejections a task may absorb before it becomes `escalated`.
- **`max_branch_depth`** (default `5`): Escalation tripwire on branch nesting, not a structural bound — termination is guaranteed by the proper-subset rule on write scopes. Crossing it escalates to a human.
- **`max_agents`** (default `100`): Total agent grants a run may issue across every depth. Assumed, not measured; `agent:register` and `branch:open` refuse once it is spent.
- **`max_output_bytes`** (default `10485760` / 10MB): Maximum command output buffered before truncation.
- **`default_lease_seconds`** (default `1800`): Sub-task lease duration for `branch:claim`. It does **not** govern `task:claim`, which defaults to 1200 seconds and is overridden per call with `--lease-seconds`.
- **`default_max_parallel`** (default `4`): Concurrency cap for independent tasks; `queue:wave` and `queue:list` read it rather than hardcoding one.

Mandatory gate coverage and independent-validator checks are not configurable: the compiler and the
completion checks enforce them unconditionally, not behind a knob.

---

## ⚡ Concurrency & Crash Durability: Kernel `flock` & Atomic Writes

To allow multiple concurrent agents and watchdog processes to operate safely without corrupting files, the storage engine implements strict kernel-level locking and atomic filesystem mutations:

```text
[ Agent Action ]
       │
       ▼
1. Acquire POSIX kernel `flock` on the capsule directory inode (<run-dir>)
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

- **Inode-Bound Locking**: Locking is performed on the capsule directory's own inode. If a rogue process deletes or renames the capsule path, the kernel lock remains securely held on the opened descriptor.
- **Fail-Closed on Collision**: If a lock cannot be acquired within the timeout window, the command fails with `CONFLICT` error rather than corrupting state.
- **No In-Memory Illusions**: State transitions only succeed once the bytes have been physically flushed to the OS storage controller via `fsync()`.
- **Evidence Assurance**: Commands recorded via `run:exec` capture stdout/stderr with exact timestamps and process exit codes, classified under `trusted_host_observed_v1`.

---

[⬅ Previous: Why Long Tasks Fail](./01-why-long-tasks-fail.md) | [Master Table of Contents](../README.md) | [Next: Lifecycle Walkthrough ➡](./03-lifecycle-walkthrough.md)

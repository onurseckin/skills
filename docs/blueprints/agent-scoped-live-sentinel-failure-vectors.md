# Agent-Scoped Live Shell Sentinel: 8 Conceptual Failure Vectors

## Level 3 Exhaustive Resilience Analysis & Countermeasures

> **Document Type:** Companion Architectural Specification  
> **Master Blueprint:** `docs/blueprints/agent-scoped-live-sentinel.md`  
> **Applicability:** All 20 Canonical Agent Roles across all 4 Canonical Hosts  
> **Tracking ID:** `bp-agent-scoped-live-sentinel-failure-vectors`

---

## 1. Architectural Risk Taxonomy

Embedding an autonomous watchdog directly into agent execution paths introduces unique failure modes. If the sentinel fails open, agent drift and monorepo violations escape unchecked; if it fails closed or generates false alarms, worker agents thrash in infinite loops, burning context tokens and stalling pipelines.

This specification provides an exhaustive, multi-dimensional analysis of the **8 Canonical Failure Vectors**, defining the exact operational manifestation, detection mechanics, and mitigation contracts for each.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                      8 CONCEPTUAL FAILURE VECTORS                       │
├───────────────────┬───────────────────┬─────────────────────────────────┤
│ V-01: Empty State │ V-02: Timeout     │ V-03: Concurrent Actor Mutation │
├───────────────────┼───────────────────┼─────────────────────────────────┤
│ V-04: Boundary    │ V-05: Lifecycle   │ V-06: Domain Invariant Drift    │
├───────────────────┼───────────────────┼─────────────────────────────────┤
│ V-07: Telemetry   │ V-08: Adversarial │                                 │
└───────────────────┴───────────────────┴─────────────────────────────────┘
```

---

## 2. Vector 1: Empty States & Cold-Boot Transients

### 2.1 Failure Manifestation

Upon initial deployment (`Turn 1`), an agent has zero recorded command history, an uninitialized mailbox, a freshly allocated task lease, and unpopulated git working tree diffs. Naive diagnostic probes that expect prior test executions or baseline telemetry will falsely flag a clean agent as non-compliant (e.g., flagging `MISSING_FILE_SCOPED_TEST_RUN` before any code has been authored).

### 2.2 Sentinel Countermeasures & Invariants

1. **Turn 1 Grace Baseline:** Probes for post-modification invariants (such as file-scoped test runs or screenshot inspections) are gated by the agent's turn counter and working tree dirty status.
2. **Deterministic Mailbox Provisioning:** The sentinel guarantees atomic initialization of `.olt/mailboxes/<agent-id>/` (`inbox.jsonl`, `outbox.jsonl`, `.lock`) before the agent's first tool invocation.
3. **Lease Introspection:** If an agent has claimed a task but performed no write actions, the sentinel maintains state `INITIALIZING` rather than `HEALTHY` or `VIOLATION`.

---

## 3. Vector 2: Timeout Stagnation & Straggler Drift

### 3.1 Failure Manifestation

An agent launches an un-targeted shell command, hangs on an interactive CLI prompt, enters a recursive reasoning loop, or exceeds the 5-minute Parallelization SLA ($P = \lceil W / S \rceil$). Unchecked, a single stalled worker freezes the parent coordinator's wave synchronization barrier.

### 3.2 Sentinel Countermeasures & Invariants

1. **Command Execution Deadlines:** All shell executions wrapped by `harness.ts shell` enforce non-interactive execution with strict process timeouts (default: 60s for unit tests, 120s for typechecks).
2. **Straggler Watchdog:** A non-blocking sentinel timer checks agent lease duration. If an agent remains active on a single task beyond 300s without progress, the sentinel emits an in-mailbox prompt: `[SENTINEL_WARN: STRAGGLER_SLA_BREACH] Task duration > 5m. Decompose task or submit progress.`
3. **Heartbeat Verification:** The sentinel records timestamped heartbeats on each hook execution. Dormancy exceeding 180s triggers a non-destructive ping.

---

## 4. Vector 3: Concurrent Actor Mutation & Lock Contention

### 4.1 Failure Manifestation

In parallel waves with up to 10 concurrent implementers and validators, multiple agents simultaneously read and write to coordination ledgers (`TASK_QUEUE.jsonl`, `.olt/telemetry.jsonl`) or attempt simultaneous mailbox updates. Lock collisions can produce partial writes, corrupted JSON, or thread deadlocks.

### 4.2 Sentinel Countermeasures & Invariants

1. **POSIX Flock Protocol with Contention SLA:** All mailbox operations use exclusive POSIX advisory file locks (`flock -x`) with a strict maximum acquisition timeout of 500ms.
2. **Exponential Backoff & Jitter:** On lock contention, the writer backs off with randomized jitter (50ms, 150ms, 300ms). If the lock cannot be acquired after 3 attempts, the operation fails cleanly with an explicit error rather than blocking the event loop.
3. **Append-Only Immutability:** Mailboxes and telemetry streams are strictly append-only. State reads perform atomic snapshot reads without holding write locks.

---

## 5. Vector 4: System Boundaries & Role Escapement

### 5.1 Failure Manifestation

An agent deviates from its assigned role profile:

- An **Implementer** attempts to modify files outside its assigned `task.write_scope`.
- A **Coordinator** attempts direct code edits or executes full test suites (`bun test`).
- A **Cognitive Validator** attempts to run shell commands or bash scripts (`can_execute_shell: false`).
- An **Orchestrator** attempts to bypass coordinators and spawn implementers directly.

### 5.2 Sentinel Countermeasures & Invariants

1. **Pre-Action Static Deny-List (`sentinel:pre-action`):** Outgoing tool calls are intercepted before OS execution. If a tool call violates role capabilities (e.g. Cognitive Validator invoking `run_command` or Implementer editing outside lease), the call is blocked immediately in-process.
2. **Path Boundary Normalization:** Filesystem write paths are canonicalized (`realpath`) against the declared lease scope, preventing path traversal attacks (`../`) or symlink redirects.
3. **Mechanical RBAC:** The shell wrapper rejects any command whose actor lacks the required execution permission in `olt/policy.json`.

---

## 6. Vector 5: Lifecycle Transition & Orphaned Leases

### 6.1 Failure Manifestation

An agent completes code modifications but crashes or halts before executing `task:submit`, or a validator rejects a task without initiating an in-lease micro-cycle (`--in-lease`). The task remains locked in an orphaned lease (`GHOST_LEASE`), blocking downstream wave execution.

### 6.2 Sentinel Countermeasures & Invariants

1. **Turn-End Reconciliation:** At `sentinel:turn-end`, the sentinel inspects the git working tree. If modified files exist but no submission or validation event is queued, an in-turn prompt warns the agent to commit and submit.
2. **Monotonic Lease Expiry:** Task leases carry absolute epoch expirations ($\tau_{\text{expire}}$) and monotonic fencing sequences. Expired leases are automatically reclaimed during supervisory pulses (`mind:pulse`).
3. **Crash Safety (Reflog Protection):** Every successful task turn automatically stages modified files into the git index (`git add -A`), ensuring git reflog recovery even if the agent process terminates abruptly.

---

## 7. Vector 6: Domain Invariant Drift & AST Degradation

### 7.1 Failure Manifestation

An implementer introduces quick fixes that degrade monorepo architectural standards:

- Introducing TypeScript compiler suppressions (`@ts-ignore`, `@ts-expect-error`).
- Utilizing untyped escape hatches (`: any`, `as any`).
- Bloating a file beyond the physical line budget ($> 300$ LOC).
- Exceeding the directory fanout threshold ($> 10$ files per folder).

### 7.2 Sentinel Countermeasures & Invariants

1. **Post-Action AST Verification (`task:check`):** At `sentinel:post-action`, modified files are scanned via an AST parser and line counter in $< 50\text{ms}$.
2. **Instant Line Budget Alarm:** If a file exceeds 300 physical lines, the sentinel triggers Strike 1 immediately with the exact line count and splitting advice.
3. **Zero-Suppression Gate:** Presence of `@ts-ignore` or `: any` triggers an immediate mechanical block on `task:submit`.

---

## 8. Vector 7: Telemetry Saturation & Visibility Loss

### 8.1 Failure Manifestation

High-frequency background checks flood telemetry logs with redundant "all clean" receipts, inflating log sizes, slowing down disk I/O, and drowning genuine anomalies in telemetry noise. Conversely, silent failures occur if dropped messages are never detected.

### 8.2 Sentinel Countermeasures & Invariants

1. **Delta-Only Logging:** The sentinel records telemetry receipts exclusively on state transitions or rule violations. Healthy turn-end confirmations update a single memory coordinate without appending redundant log lines.
2. **Cryptographic Deduplication:** Each violation is hashed with its rule code, actor ID, and target file. Duplicate violations within the same turn are collapsed into a single warning.
3. **Verified Delivery Receipts:** Mailbox deliveries require a physical touch on `.olt/mailboxes/<agent-id>/.notify`. Unread message queues are monitored by Tier 2 meta-auditors.

---

## 9. Vector 8: Adversarial Misuse & Agent Evasion

### 9.1 Failure Manifestation

An agent attempts to circumvent sentinel enforcement:

- Spawning unmonitored background subshells or detaching processes (`nohup`, `&`).
- Attempting to overwrite `.olt/mailboxes/` files directly via filesystem tools.
- Modifying the sentinel script files (`olt/scripts/src/sentinel/*`) within an implementation lease.
- Spoofing process IDs (PID) or forging authentication tokens.

### 9.2 Sentinel Countermeasures & Invariants

1. **Process Ancestry Tracking (PPID):** `harness.ts shell` inspects the caller's process tree ancestry, verifying that the process descends directly from the verified harness runtime.
2. **Ephemeral HMAC Token Authentication:** Every registered agent is assigned a run-scoped HMAC token during `agent:register`. Commands submitted without this cryptographic signature are rejected instantly.
3. **Self-Shielding Invariant:** Sentinel scripts and harness binaries are hardcoded as protected system files. Any attempt by an Implementer or Coordinator to target `olt/scripts/` without explicit charter authority triggers an immediate fatal Strike 3 shutdown.

---

## 10. Summary Verification Matrix

```text
┌─────────────────────────┬───────────────────────┬───────────────────────┐
│ Failure Vector          │ Detection Engine      │ Enforcement Action    │
├─────────────────────────┼───────────────────────┼───────────────────────┤
│ V-01: Empty States      │ Turn 1 state detector │ Grace period bypass   │
│ V-02: Timeout Stagnation│ Watchdog timer (300s) │ Straggler warning     │
│ V-03: Actor Mutation    │ POSIX flock (<=500ms) │ Backoff with jitter   │
│ V-04: System Boundary   │ Static RBAC + Scope   │ Pre-action block      │
│ V-05: Lifecycle Leak    │ Turn-end reconciler   │ Staging + lease fence │
│ V-06: Invariant Drift   │ AST parser & LOC scan │ Immediate Strike 1    │
│ V-07: Telemetry Flood   │ Delta-only log engine │ Deduplication hash    │
│ V-08: Evasion / Spoof   │ HMAC + PPID ancestry  │ Immediate fatal lock  │
└─────────────────────────┴───────────────────────┴───────────────────────┘
```

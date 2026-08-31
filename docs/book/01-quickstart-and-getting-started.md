# Chapter 1: Quickstart & Getting Started

[← Previous: The OLT Book Overview](README.md) | [📖 Table of Contents](SUMMARY.md) | [Next: Chapter 2 — Core Philosophy & Brent Parallelism →](02-core-philosophy-and-brent-parallelism.md)

---

[![Diátaxis: Tutorial](https://img.shields.io/badge/Diátaxis-Tutorial-blue.svg)](README.md#diátaxis-documentation-matrix)
[![Complexity: Beginner](https://img.shields.io/badge/complexity-beginner-emerald.svg)](README.md)
[![Time to Complete](https://img.shields.io/badge/time-15_minutes-orange.svg)](README.md)
[![Runtime](https://img.shields.io/badge/runtime-Bun_Native-orange.svg)](../../bunfig.toml)

This tutorial walks you through installing OLT, verifying your local environment, and executing your very first end-to-end multi-agent orchestration run. By the end of this chapter, you will understand how OLT ingests task requirements, compiles dependency graphs, dispatches parallel subagent workers, enforces adversarial verification, and cryptographically certifies run completion.

---

## 1. 1-Shot Global Installation

OLT is distributed as a zero-runtime-dependency skill package designed to integrate seamlessly into any AI agent client (such as Antigravity, Claude Code, Cursor, Codex, or ChatGPT) as well as developer terminals.

### Installation Options

```bash
npx skills add onurseckin/skills --skill olt   # Node / npm
bunx skills add onurseckin/skills --skill olt  # Bun native
```

**Zero-Dependency Guarantee**: OLT runs 100% native TypeScript on Bun with 0 runtime dependencies in `package.json`, sub-millisecond startup, and native POSIX `flock` synchronization.

---

## 2. CLI Harness Initialization & Doctor Validation

Once installed, verify that your host environment meets all runtime prerequisites using the built-in diagnostic suite:

```bash
# Display top-level harness capabilities
bun olt/scripts/harness.ts --help
```

### Running the Doctor Diagnostic Suite

The `doctor` command inspects your local repository, checks file system permissions, validates Bun/Node runtime compatibility, and probes host capabilities:

```bash
bun olt/scripts/harness.ts doctor
```

Sample output:

```text
[PASS] Runtime Engine: Bun Native | TypeScript: Strict 0 any | POSIX Flock: Available
[PASS] Policy Engine: Configured (.olt/policy.json) | Telemetry: Active
[PASS] All 8 diagnostic checks passed. System ready for orchestration.
```

### Initializing Repository Policy

Before running autonomous workflows, initialize the central repository policy:

```bash
bun olt/scripts/harness.ts policy:init
```

This discovers your workspace toolchains (linters, test runners, package managers) and generates `.olt/policy.json`.

---

## 3. End-to-End Task Lifecycle Walkthrough

Let us walk through a complete, real-world execution lifecycle. The diagram below shows the seven discrete phases that every long task undergoes:

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Operator
    participant Orch as Tier 1: Orchestrator
    participant Capsule as Capsule Storage (.olt/capsules/)
    participant Coord as Tier 2: Coordinator
    participant Imp as Tier 3: Implementer
    participant Val as Tier 3: Validator

    User->>Orch: Submit natural language prompt
    Orch->>Capsule: 1. Ingest prompt & create capsule (prompt.md, index.json)
    Orch->>Coord: 2. Preplan & brainstorm 8 vectors (brainstorming.json)
    Coord->>Coord: 3. Compile DAG & Topological Waves (plan:compile)
    Coord->>Coord: 4. Check readiness & dispatch (queue:wave)
    Coord->>Imp: 5. Mint lease & grant write scope (task:claim)
    Imp->>Imp: Execute edits & run verification tests
    Imp->>Coord: Submit task deliverables (task:submit)
    Coord->>Val: 6. Dispatch adversarial validator (task:validate-start)
    Val->>Val: Run independent probes & APCA contrast audits
    Val->>Coord: Certify gate evidence (gate:prove)
    Coord->>Orch: All tasks validated & DAG exhausted
    Orch->>Capsule: 7. Cryptographic seal & 2-key completion (run:complete)
    Orch->>User: Deliver verified completion summary
```

---

### Step 1: Prompt Ingestion & Merkle Root Binding

Every orchestration run begins with an immutable prompt captured in a newly created capsule directory:

```bash
# Initialize a new run capsule
bun olt/scripts/harness.ts run:init --name "feature-authentication-overhaul" --prompt "Implement JWT authentication with refresh tokens and rate limiting"
```

The harness creates `.olt/capsules/<timestamp>-feature-authentication-overhaul/` containing:

- `prompt.md`: The verbatim, immutable user prompt.
- `index.json`: Run metadata and root Merkle SHA-256 hash.
- `events.jsonl`: Cryptographically linked audit ledger.

---

### Step 2: Preplanning & Failure Vector Brainstorming

Before generating a task list, the system performs structured preplanning, analyzing the prompt across **8 mandatory failure vectors**:

```bash
# Run multi-round failure vector brainstorming
bun olt/scripts/harness.ts plan:brainstorm --run .olt/capsules/<run-id> --rounds 3
```

The 8 failure vectors evaluated: `EMPTY_PAYLOAD` (null checks), `TIMEOUT_STAGNATION` (deadlocks), `CONCURRENCY_MUTATION` (races), `HOST_BOUNDARY` (conformance), `STATE_TRANSITION` (recovery), `TYPE_INVARIANT` (0 any), `CLI_TELEMETRY` (exit codes), and `ADVERSARIAL_GATE` (counterfactual negative proofs).

---

### Step 3: DAG Compilation & Wave Partitioning

The planner decomposes requirements into discrete, atomic tasks and compiles them into a Directed Acyclic Graph (DAG):

```bash
# Compile requirements and generate topological waves
bun olt/scripts/harness.ts plan:compile --run .olt/capsules/<run-id>
```

Compilation assigns each task a **disjoint write scope**, binds verification gates, and applies Kahn's algorithm to partition tasks into parallel waves:

```text
Wave 1 (width 3): task-1 (src/auth/types.ts), task-2 (src/auth/hash.ts), task-3 (src/auth/store.ts)
Wave 2 (width 1): task-4 (src/auth/middleware.ts) [depends on Wave 1]
Wave 3 (width 1): task-5 (tests/integration/auth.test.ts) [depends on Wave 2]
```

---

### Step 4: Wave Dispatch & Workforce Registration

The Tier 2 Coordinator queries the queue to find all tasks ready for immediate execution:

```bash
# Query ready tasks in current wave
bun olt/scripts/harness.ts queue:next --run .olt/capsules/<run-id>
```

When dispatching subagents, the Coordinator registers each worker in the capsule's agent ledger:

```bash
# Register an implementer subagent
bun olt/scripts/harness.ts agent:register \
  --run .olt/capsules/<run-id> \
  --agent worker_jwt_models \
  --role implementer \
  --host antigravity \
  --parent-agent coordinator_1
```

---

### Step 5: Implementer Task Claim & Mutation

The dispatched Tier 3 Implementer claims its assigned task lease on Turn 1 before modifying any files:

```bash
# Claim task lease and obtain temporary write token
bun olt/scripts/harness.ts task:claim \
  --run .olt/capsules/<run-id> \
  --task task-1 \
  --agent worker_jwt_models \
  --role implementer
```

Sample output: `### Task Leased: task-1 (Scope: src/auth/types.ts, Token: tok_lease_9a8f..., Duration: 20m)`

The implementer authors the code strictly within `src/auth/types.ts` and runs local typechecks. During long executions, the implementer sends heartbeats to maintain its lease:

```bash
# Extend active lease deadline
bun olt/scripts/harness.ts task:heartbeat \
  --run .olt/capsules/<run-id> \
  --task task-1 \
  --agent worker_jwt_models \
  --token tok_lease_9a8f7c6e5d4b3a210fedcba987654321
```

Once work is complete, the implementer submits its deliverables:

```bash
# Submit completed task for validation
bun olt/scripts/harness.ts task:submit \
  --run .olt/capsules/<run-id> \
  --task task-1 \
  --agent worker_jwt_models \
  --token tok_lease_9a8f7c6e5d4b3a210fedcba987654321 \
  --summary "Created JWT claims interface, token payload schemas, and zero-any type definitions." \
  --files-changed src/auth/types.ts
```

---

### Step 6: Adversarial Validation & Evidence Proving

OLT enforces the **Adversarial Validation Separation Invariant**: the implementer is barred from approving its own work. Instead, an independent Tier 3 Validator is spawned:

```bash
# Start independent validation session
bun olt/scripts/harness.ts task:validate-start \
  --run .olt/capsules/<run-id> \
  --task task-1 \
  --agent validator_jwt_models \
  --role validator
```

The validator executes the task gate, probes for mock usage or unhandled edge cases, and certifies the evidence:

```bash
# Prove gate completion with exit code 0 evidence
bun olt/scripts/harness.ts gate:prove \
  --run .olt/capsules/<run-id> \
  --task task-1 \
  --gate gate-1 \
  --evidence-class harness_observed \
  --command "bun test tests/unit/auth/types.test.ts"
```

If issues are found, the validator records structured findings (`finding:record`), triggering a monotonic repair loop.

---

### Step 7: Run Completion & Terminal Sealing

Once all waves are complete and every task gate has been certified by an independent validator, the Tier 1 Orchestrator executes the 2-Key completion ceremony:

```bash
# Cryptographically seal and finalize run
bun olt/scripts/harness.ts run:complete \
  --run .olt/capsules/<run-id> \
  --agent orchestrator_main
```

The capsule is marked `completed`, file write permissions are locked to read-only, and a final summary report is generated in `reports/completion-summary.md`.

---

## 4. Inspecting Capsules, Event Ledgers & Telemetry

Every OLT run maintains full observability and forensic traceability:

Capsule layout: `index.json` (Merkle root), `manifest.json` (host metadata), `prompt.md` (verbatim prompt), `state.json` (DAG/leases), `events.jsonl` (SHA-256 ledger), `trace.md` (timeline), and `reports/`.

### Viewing the Living Execution Trace

Inspect the real-time event timeline of any active or completed run:

```bash
cat .olt/capsules/<run-id>/trace.md
```

---

## 5. Quick Reference Cheat Sheet

| Workflow Step       | Primary Command                             | Acting Agent | Primary Output / State Change              |
| :------------------ | :------------------------------------------ | :----------- | :----------------------------------------- |
| **System Sanity**   | `bun harness.ts doctor`                     | Operator     | Environment diagnostic report              |
| **Policy Init**     | `bun harness.ts policy:init`                | Operator     | `.olt/policy.json` generated               |
| **Capsule Init**    | `bun harness.ts run:init --prompt "..."`    | Orchestrator | New `.olt/capsules/<run-id>/` created      |
| **Preplanning**     | `bun harness.ts plan:brainstorm --rounds 3` | Coordinator  | `brainstorming.json` with 8 vectors        |
| **DAG Compilation** | `bun harness.ts plan:compile`               | Coordinator  | `state.json` topological waves             |
| **Task Claim**      | `bun harness.ts task:claim --task <id>`     | Implementer  | Active lease token & write scope lock      |
| **Task Heartbeat**  | `bun harness.ts task:heartbeat --task <id>` | Implementer  | Extends lease deadline                     |
| **Task Submit**     | `bun harness.ts task:submit --task <id>`    | Implementer  | Releases write scope; marks task submitted |
| **Gate Proving**    | `bun harness.ts gate:prove --task <id>`     | Validator    | Certifies gate evidence (exit 0)           |
| **Run Complete**    | `bun harness.ts run:complete`               | Orchestrator | Cryptographically seals capsule            |

---

[← Previous: The OLT Book Overview](README.md) | [📖 Table of Contents](SUMMARY.md) | [Next: Chapter 2 — Core Philosophy & Brent Parallelism →](02-core-philosophy-and-brent-parallelism.md)

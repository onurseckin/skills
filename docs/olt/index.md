# Orchestrating Long Tasks (OLT) — Master Documentation Index

Welcome to the master lookup taxonomy and index for the **OLT (Orchestrating Long Tasks)** autonomous engineering engine.

---

## 🏛️ Domain 1: 17-Chapter Technical Architecture Book (`docs/olt/architecture/`)

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                OLT ARCHITECTURE 17-CHAPTER PORTAL                                │
├─────────┬──────────────────────────────────┬─────────────────────────────────────────────────────┤
│ Chapter │ Title                            │ Primary Theoretical & Engineering Concepts          │
├─────────┼──────────────────────────────────┼─────────────────────────────────────────────────────┤
│   01    │ Foundations & Core Invariants    │ Zero-assumption philosophy, 4 Hard Zeros, C1..C10   │
│   02    │ Four-Tier Workforce Hierarchy    │ Tier 0..3 topology, naming grammar, 4-host parity   │
│   03    │ Mind Product Owner & Cadence     │ Autonomous PO loop, 10 discovery sources, 6 gates   │
│   04    │ Continuous Preplanning Factory   │ 100% line coverage, 0444 prompt capture, clusters   │
│   05    │ Concurrency Scaling & SLA        │ Brent Work/Span P = ceil(W/S), 300s SLA, throttling │
│   06    │ Topological DAG Scheduler        │ Kahn's sort, Tarjan SCC cycles, Sugiyama visualizer │
│   07    │ Distributed Leasing & Execution  │ Monotonic leases, 30s heartbeats, zombie recovery   │
│   08    │ Adversarial Validation & Repair  │ Socratic review pushbacks, Validator 0-command lock │
│   09    │ Falsifiable Evidence & Gates     │ Classes 1–4 evidence, APCA contrast math, PNG IHDR  │
│   10    │ Durability, Recovery & Merkle    │ Capsule filesystem, SHA-256 Merkle chains, flock    │
│   11    │ Worktree Branching & Honesty     │ Out-of-repo worktrees, 1:1 anti-batching, honesty   │
│   12    │ Flock Mailboxes & Telemetry      │ Mailbox directory, non-blocking wakes, live TUI     │
│   13    │ Policy, RBAC & Fail-Closed Engine│ Mechanical RBAC compiler, 10 AST linters, failclosed│
│   14    │ Harness CLI & Command Engine     │ 15 command domains (run, plan, task, mind, doctor)  │
│   15    │ State Schemas & Event Ledger     │ Draft 2020-12 JSON schemas, manifest, events, state │
│   16    │ Error Catalog & Blunders         │ Exit codes (0, 3, 4, 70), 28 empirical blunders     │
│   17    │ Verification Engines & Gates     │ Typecheck engine, 10 AST linters, APCA, PNG chunk   │
└─────────┴──────────────────────────────────┴─────────────────────────────────────────────────────┘
```

### Architecture Chapter Links

- **[Chapter 01: Foundations & Core Invariants](./architecture/01-foundations/index.md)**
- **[Chapter 02: Four-Tier Workforce Hierarchy](./architecture/02-four-tier-hierarchy/index.md)**
- **[Chapter 03: Mind Product Owner & Autonomous Cadence](./architecture/03-mind-product-owner/index.md)**
- **[Chapter 04: Continuous Preplanning Factory](./architecture/04-continuous-preplanning-factory/index.md)**
- **[Chapter 05: Concurrency Scaling & Straggler SLA](./architecture/05-concurrency-straggler-sla/index.md)**
- **[Chapter 06: Topological DAG Scheduler](./architecture/06-topological-scheduler-dags/index.md)**
- **[Chapter 07: Distributed Leasing & Execution](./architecture/07-distributed-leasing-execution/index.md)**
- **[Chapter 08: Adversarial Validation & Monotonic Repair](./architecture/08-adversarial-validation-repair/index.md)**
- **[Chapter 09: Falsifiable Evidence & Completion Gates](./architecture/09-falsifiable-evidence-gates/index.md)**
- **[Chapter 10: Durability, Recovery & Merkle Chains](./architecture/10-durability-recovery-capsules/index.md)**
- **[Chapter 11: Worktree Branching & Honesty Gates](./architecture/11-worktree-branching-honesty/index.md)**
- **[Chapter 12: Flock Mailboxes & Telemetry](./architecture/12-flock-mailboxes-and-tui/index.md)**
- **[Chapter 13: Policy, RBAC & Fail-Closed Engine](./architecture/13-policy-rbac-failclosed-engine/index.md)**
- **[Chapter 14: Harness CLI & Command Execution Engine](./architecture/14-harness-cli-and-command-engine/index.md)**
- **[Chapter 15: State Schemas & Capsule Event Ledger](./architecture/15-state-schemas-and-event-ledger/index.md)**
- **[Chapter 16: Error Catalog & Empirical Blunders](./architecture/16-error-catalog-and-blunders/index.md)**
- **[Chapter 17: Verification Engines & Gate Provers](./architecture/17-verification-engines-and-gates/index.md)**

---

## 📚 Domain 2: Concise Reference & Operator Manuals (`docs/olt/reference/`)

- **[Quickstart & Execution Guide](./reference/quickstart.md)**: Concise operator manual for running Single-Task mode and Mind autonomous mode.
- **[Health, Diagnostics & Status Guide](./reference/health-and-status.md)**: Preflight checks, doctor engines, diagnostics, and crash recovery.

---

## 🔍 Topic & Keyword Cross-Reference

| Topic / Keyword                               | Architecture Chapter                                                                                                                  | Reference Guide                                     | Source File                                                                                                               |
| :-------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------ |
| **Adversarial Validation**                    | [Ch 08](./architecture/08-adversarial-validation-repair/index.md)                                                                     | [Quickstart](./reference/quickstart.md)             | [`critic-ops.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/critic/critic-ops.ts)                      |
| **APCA Contrast Math**                        | [Ch 09](./architecture/09-falsifiable-evidence-gates/index.md), [Ch 17](./architecture/17-verification-engines-and-gates/index.md)    | [Health & Status](./reference/health-and-status.md) | [`apca-contrast.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/heuristics/apca-contrast.ts)            |
| **AST Linting (10 Rules)**                    | [Ch 13](./architecture/13-policy-rbac-failclosed-engine/index.md), [Ch 17](./architecture/17-verification-engines-and-gates/index.md) | [Health & Status](./reference/health-and-status.md) | [`ast-linter.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/linter/ast-linter.ts)                      |
| **Brent Work/Span ($P = \lceil W/S \rceil$)** | [Ch 05](./architecture/05-concurrency-straggler-sla/index.md)                                                                         | [Quickstart](./reference/quickstart.md)             | [`topological-scheduler.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/graph/topological-scheduler.ts) |
| **Capsule Filesystem Anatomy**                | [Ch 10](./architecture/10-durability-recovery-capsules/index.md), [Ch 15](./architecture/15-state-schemas-and-event-ledger/index.md)  | [Health & Status](./reference/health-and-status.md) | [`capsule-storage.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/storage/capsule-storage.ts)           |
| **Cognitive Validator Hard-Lock**             | [Ch 08](./architecture/08-adversarial-validation-repair/index.md)                                                                     | [Quickstart](./reference/quickstart.md)             | [`rbac-compiler.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/authority/manifest/rbac-compiler.ts)    |
| **Error Code Hierarchy**                      | [Ch 01](./architecture/01-foundations/index.md), [Ch 16](./architecture/16-error-catalog-and-blunders/index.md)                       | [Health & Status](./reference/health-and-status.md) | [`harness-error.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/core/harness-error.ts)                  |
| **Evidence Classes (1–4)**                    | [Ch 09](./architecture/09-falsifiable-evidence-gates/index.md)                                                                        | [Quickstart](./reference/quickstart.md)             | [`gate-prove.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/cli/commands/gate-prove.ts)                |
| **Flock Mailboxes**                           | [Ch 12](./architecture/12-flock-mailboxes-and-tui/index.md)                                                                           | [Quickstart](./reference/quickstart.md)             | [`capsule-storage.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/storage/capsule-storage.ts)           |
| **Git Staging Invariant (`git add -A`)**      | [Ch 01](./architecture/01-foundations/index.md)                                                                                       | [Quickstart](./reference/quickstart.md)             | [`task-submit.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/task/task-submit.ts)                      |
| **Harness CLI Dictionary**                    | [Ch 14](./architecture/14-harness-cli-and-command-engine/index.md)                                                                    | [Quickstart](./reference/quickstart.md)             | [`commands/index.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/cli/commands/index.ts)                 |
| **Mind Supervisor Infinite Loop**             | [Ch 03](./architecture/03-mind-product-owner/index.md)                                                                                | [Quickstart](./reference/quickstart.md)             | [`mind-supervisor.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/mind/mind-supervisor.ts)              |
| **PNG IHDR Binary Chunk Engine**              | [Ch 09](./architecture/09-falsifiable-evidence-gates/index.md), [Ch 17](./architecture/17-verification-engines-and-gates/index.md)    | [Health & Status](./reference/health-and-status.md) | [`doctor/`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/doctor/)                                         |
| **Sugiyama Layered Layout**                   | [Ch 06](./architecture/06-topological-scheduler-dags/index.md)                                                                        | [Health & Status](./reference/health-and-status.md) | [`sugiyama-layout.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/graph/sugiyama-layout.ts)             |
| **Tarjan SCC Cycle Detection**                | [Ch 06](./architecture/06-topological-scheduler-dags/index.md)                                                                        | [Health & Status](./reference/health-and-status.md) | [`tarjan-scc.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/graph/tarjan-scc.ts)                       |
| **Task Leasing & Heartbeats**                 | [Ch 07](./architecture/07-distributed-leasing-execution/index.md)                                                                     | [Quickstart](./reference/quickstart.md)             | [`task-claim.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/task/task-claim.ts)                        |
| **Worktree Isolation**                        | [Ch 11](./architecture/11-worktree-branching-honesty/index.md)                                                                        | [Quickstart](./reference/quickstart.md)             | [`branch-ops.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/cli/commands/branch-ops.ts)                |

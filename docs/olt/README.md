# Orchestrating Long Tasks (OLT) — Master Technical Architecture & Reference Library

Welcome to the definitive architectural manual, developer specifications, and operator reference library for the **OLT (Orchestrating Long Tasks)** autonomous engineering engine.

OLT provides a deterministic runtime, state machine, and multi-agent coordination protocol designed to eliminate the fundamental failure modes of long-running coding agents: context window decay, prompt amnesia, sycophantic self-grading, uncoordinated write collisions, torn event chains, and unverified mock completions.

---

## 🏛️ Ecosystem Architecture Matrix

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 OLT DOCUMENTATION ECOSYSTEM                                      │
├──────────────────────────────────────────────────┬───────────────────────────────────────────────┤
│    🏛️ ARCHITECTURE (Chapters 01–17, 83 Docs)     │    📚 REFERENCE MANUALS (2 Consumer Guides)   │
│    Deep theoretical foundations, algorithms,     │    Concise, copy-pasteable operator guides    │
│    mathematical models, and visual topologies.   │    for running workflows & system checks.     │
├──────────────────────────────────────────────────┼───────────────────────────────────────────────┤
│  • 01. Foundations & Core Invariants             │  • Quickstart & Execution Guide               │
│  • 02. Four-Tier Workforce Hierarchy             │  • Health, Diagnostics & Status Guide         │
│  • 03. Mind Product Owner & Infinite Cadence     │                                               │
│  • 04. Continuous Preplanning Factory            │                                               │
│  • 05. Concurrency Scaling & Straggler SLA       │                                               │
│  • 06. Topological DAG Scheduler                 │                                               │
│  • 07. Distributed Task Leasing & Execution      │                                               │
│  • 08. Adversarial Validation & Monotonic Repair │                                               │
│  • 09. Falsifiable Evidence & Completion Gates   │                                               │
│  • 10. Durability, Recovery & Merkle Chains      │                                               │
│  • 11. Worktree Branching & Honesty Gates        │                                               │
│  • 12. Flock Mailboxes & Telemetry               │                                               │
│  • 13. Policy, RBAC & Fail-Closed Engine         │                                               │
│  • 14. Harness CLI & Command Engine              │                                               │
│  • 15. State Schemas & Event Ledger              │                                               │
│  • 16. Error Catalog & Empirical Blunders        │                                               │
│  • 17. Verification Engines & Gate Provers       │                                               │
│                                                  │                                               │
│  👉 Explore: docs/olt/architecture/              │  👉 Explore: docs/olt/reference/              │
└──────────────────────────────────────────────────┴───────────────────────────────────────────────┘
```

---

## 🧭 Master Navigation Map

### Domain 1: 17-Chapter Technical Architecture Book (`docs/olt/architecture/`)

| Chapter | Title                                         | Core Foundations & Mechanics                                                                                                                                                                                   | Chapter Link                                                            |
| :------ | :-------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| **01**  | **Foundations & Core Invariants**             | Zero-assumption philosophy, 4 Hard Zeros, $C_1 \dots C_{10}$ formal invariant system, deterministic state transitions, reflog safety (`git add -A`).                                                           | [Chapter 01](./architecture/01-foundations/index.md)                    |
| **02**  | **Four-Tier Workforce Hierarchy**             | 4-Tier workforce hierarchy (T0..T3), strict subagent naming grammar (`<role>_<scope>_<task_id>`), 4-host parity, modular file budgets ($\le 300$ LOC, $\le 10$ files/dir).                                     | [Chapter 02](./architecture/02-four-tier-hierarchy/index.md)            |
| **03**  | **Mind Product Owner & Autonomous Cadence**   | Autonomous Product Owner loop, `CLOSING_FORBIDDEN_FOR_MIND`, `pulse.sh` mutual exclusion, 10 discovery sources, 6 admission gates (`G1`–`G6`), generational rotation.                                          | [Chapter 03](./architecture/03-mind-product-owner/index.md)             |
| **04**  | **Continuous Preplanning Factory**            | Byte-exact prompt capture (`plan:init`), mode 0444 immutability, SHA-256 manifest binding, 100% line coverage rule (`--requirement-lines`), authority obligations, roadmap clustering.                         | [Chapter 04](./architecture/04-continuous-preplanning-factory/index.md) |
| **05**  | **Concurrency Scaling & Straggler SLA**       | Brent's Work/Span Theorem ($P = \lceil W/S \rceil \le 40$), Coffman-Graham width bounds, 5-minute straggler SLA rule, dynamic load throttling, queue draining.                                                 | [Chapter 05](./architecture/05-concurrency-straggler-sla/index.md)      |
| **06**  | **Topological DAG Scheduler**                 | Kahn's topological sort, Tarjan SCC cycle detection with feedback edge breaking, dynamic wave decoupling (`detectScopeOverlap`), 4-phase Sugiyama layered visualizer.                                          | [Chapter 06](./architecture/06-topological-scheduler-dags/index.md)     |
| **07**  | **Distributed Leasing & Execution**           | Monotonic lease tokens, heartbeat refresh intervals, anti-theft locking, watchdog manager, zombie lease auto-recovery (`retry_ready`), Cowan 150k token budget.                                                | [Chapter 07](./architecture/07-distributed-leasing-execution/index.md)  |
| **08**  | **Adversarial Validation & Monotonic Repair** | Socratic reflexive probing, Cognitive Validator Command Hard-Lock (0 commands), 7 Meta-Auditor Forensics heuristics, structured finding schema (P0..P3), monotonic repair waves ($k \le 3$).                   | [Chapter 08](./architecture/08-adversarial-validation-repair/index.md)  |
| **09**  | **Falsifiable Evidence & Completion Gates**   | Classes 1–4 falsifiable evidence hierarchy, Anti-Mock PNG IHDR/IDAT binary chunk inspection & Shannon entropy, APCA lightness contrast mathematics ($L_c$), `gate:prove` mutation testing.                     | [Chapter 09](./architecture/09-falsifiable-evidence-gates/index.md)     |
| **10**  | **Durability, Recovery & Merkle Chains**      | Capsule filesystem anatomy (`manifest.json`, `events.jsonl`, `state.json`, `mailbox/`, `receipts/`), SHA-256 Merkle event chaining, atomic POSIX flock advisory locks (5000ms timeout), zero-state projection. | [Chapter 10](./architecture/10-durability-recovery-capsules/index.md)   |
| **11**  | **Worktree Branching & Honesty Gates**        | Out-of-repo ephemeral Git worktrees, 1:1 anti-batching lease invariants, honesty verification gates, dynamic Agent Grant Ledger, capability elevation protocols.                                               | [Chapter 11](./architecture/11-worktree-branching-honesty/index.md)     |
| **12**  | **Flock Mailboxes & Telemetry**               | Inter-agent mailbox protocol (`.olt/capsules/<slug>/mailbox/`), POSIX flock-protected message channels, tamper-evident audit logs, live TUI telemetry dashboard.                                               | [Chapter 12](./architecture/12-flock-mailboxes-and-tui/index.md)        |
| **13**  | **Policy, RBAC & Fail-Closed Engine**         | Mechanical RBAC Compiler, 10 AST static linters, fail-closed permission gates, Zero-File-Edit Rule for supervisory agents (Tier 0, Tier 1, Tier 2).                                                            | [Chapter 13](./architecture/13-policy-rbac-failclosed-engine/index.md)  |
| **14**  | **Harness CLI & Command Engine**              | Complete command execution pipelines, flag parsing, stdin handling, and exit semantics spanning all 15 harness CLI domains.                                                                                    | [Chapter 14](./architecture/14-harness-cli-and-command-engine/index.md) |
| **15**  | **State Schemas & Event Ledger**              | Draft 2020-12 JSON Schema specifications and exemplars for `manifest.json`, `events.jsonl`, `state.json`, and mailbox envelopes.                                                                               | [Chapter 15](./architecture/15-state-schemas-and-event-ledger/index.md) |
| **16**  | **Error Catalog & Empirical Blunders**        | POSIX exit codes (0, 3, 4, 70), structured JSON error payloads, 28 empirical failure modes (`LP`, `VP`, `VT`, `BR`, `MC`, `SM`, `G5`), recovery playbooks.                                                     | [Chapter 16](./architecture/16-error-catalog-and-blunders/index.md)     |
| **17**  | **Verification Engines & Gate Provers**       | Incremental Typecheck Engine (`task:check`), 10 AST static linters, APCA perceptual contrast math, binary PNG IHDR chunk validator, Merkle hash auditor, `gate:prove`.                                         | [Chapter 17](./architecture/17-verification-engines-and-gates/index.md) |

---

### Domain 2: Concise Reference & Operator Manuals (`docs/olt/reference/`)

| Reference Guide                                                            | Description                                                                                         | Guide Link                                          |
| :------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------- | :-------------------------------------------------- |
| **[Quickstart & Execution Guide](./reference/quickstart.md)**              | Step-by-step command sequences, flag tables, and workflows for Single-Task and Mind Mode execution. | [Quickstart](./reference/quickstart.md)             |
| **[Health, Diagnostics & Status Guide](./reference/health-and-status.md)** | Preflight checks, doctor engines, real-time inspection, and crash recovery procedures.              | [Health & Status](./reference/health-and-status.md) |

---

## 🛡️ Core System Invariants

1. **"Prose is not state, memory is not proof"**: All transitions require immutable cryptographic disk events.
2. **Subdomain Git Staging Invariant**: Every milestone completion triggers an immediate `git add -A` for complete reflog auditability.
3. **Cognitive Validator Command Hard-Lock**: Reviewers evaluate code exclusively via AST inspection, static analysis, and cryptographic receipts (0 mutating commands).
4. **POSIX flock Mutual Exclusion**: Every capsule filesystem mutation is guarded by a kernel-level advisory lock with a 5000ms deadline.
5. **5-Minute Straggler SLA**: Tasks exceeding expected time windows are dynamically decomposed into parallel execution lanes ($P = \lceil W / S \rceil$).

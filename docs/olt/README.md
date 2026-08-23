# Orchestrating Long Tasks — Master Documentation & Architectural Manual

Welcome to the definitive architectural manual and developer tutorial for the **`olt`** autonomous agent skill.

This manual provides a rigorous, deeply technical, step-by-step foundation for deterministic multi-agent software engineering. It explains how autonomous AI systems can safely, deterministically, and reliably orchestrate long-running, multi-phase coding tasks using a **Zero-JSON Colon Command Architecture**, a **Two-Tier Workforce Hierarchy**, and a **Strict Dependency Graph Engine**.

---

## 🏛️ Diátaxis Architectural Framework Matrix

To ensure clarity and usability across different developer needs, this manual is organized into the four distinct quadrants of the **Diátaxis Documentation Framework**:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    THE DIÁTAXIS DOCUMENTATION FRAMEWORK                     │
├──────────────────────────────────────────────┬──────────────────────────────┤
│               PRACTICAL GOALS                │      THEORETICAL CONCEPTS    │
├──────────────────────────────────────────────┼──────────────────────────────┤
│  LEARNING-ORIENTED:                          │  UNDERSTANDING-ORIENTED:     │
│  [ TUTORIALS ]                               │  [ EXPLANATION ]             │
│  • Hands-on End-to-End Walkthrough           │  • Why Long Tasks Fail (01§01)│
│    (Chapter 10 §01)                          │  • Prompt Integrity (02§01)  │
│  • The 10-Stage Lifecycle (01§03)            │  • Brent Work/Span (03§02)   │
│                                              │  • Two-Tier Hierarchy (04§01)│
│                                              │  • Adversarial Theory (06§01)│
│                                              │  • Critic Philosophy (07§02) │
├──────────────────────────────────────────────┼──────────────────────────────┤
│  PROBLEM-ORIENTED:                           │  INFORMATION-ORIENTED:       │
│  [ HOW-TO GUIDES ]                           │  [ REFERENCE ]               │
│  • Plan Revision & Replanning (03§03)        │  • Node & Edge Schema (03§01)│
│  • Dynamic Execution Branching (09§01)       │  • Zero-JSON CLI Ref (10§02) │
│  • Bounded Repair Routing (06§03)            │  • Blunder Dictionary (10§03)│
│  • Watchdog Health Monitoring (05§01)        │  • 10 Role Contracts (04§02) │
│  • Crash & Lease Recovery (08§03, 10§03)     │  • Evidence Classes (09§03)  │
│                                              │  • Finding Schema (06§02)    │
└──────────────────────────────────────────────┴──────────────────────────────┘
```

---

## 🧭 Master Table of Contents (All 10 Chapters)

### [Chapter 01: Mental Model & Architectural Foundations](./01-foundations/01-why-long-tasks-fail.md)

1. **[01. Why Long Tasks Fail in Autonomous Agents](./01-foundations/01-why-long-tasks-fail.md)**  
   _Context decay, sycophancy, hallucinated progress, write collisions, and the core philosophy: "Prose is not state, memory is not proof."_
2. **[02. Capsule & Storage Model](./01-foundations/02-capsule-and-storage-model.md)**  
   _The `.capsules/<run-id>/` directory layout, `prompt.md` immutability, `manifest.json`, `events.jsonl` cryptographic hash chain, `state.json` projection, and POSIX kernel `flock` atomicity._
3. **[03. The Lifecycle Walkthrough](./01-foundations/03-lifecycle-walkthrough.md)**  
   _The ten stages from prompt capture to mechanical completion, alongside the formal task state machine including `branched` and `retry_ready`._

---

### [Chapter 02: Prompt Compilation & Requirements Engine](./02-requirements/01-prompt-capture-and-integrity.md)

4. **[01. Prompt Capture & Byte-Exact Integrity](./02-requirements/01-prompt-capture-and-integrity.md)**  
   _Preserving prompt bytes via `plan:init`, capture assurance, SHA-256 binding, and why `plan:enhance` is derived and never displaces the source._
5. **[02. Line Disposition & Requirement Derivation](./02-requirements/02-line-disposition-algorithm.md)**  
   _The 100% line coverage rule, `--requirement-lines` binding, the positional fallback and its warnings, and the requirement the compiler mints per task._
6. **[03. Authority-Gated Obligations & Their Dispositions](./02-requirements/03-authority-decisions-and-dispositions.md)**  
   _The `needs_authority` vocabulary the harness enforces, what has no CLI path today, and how to handle a gated obligation honestly._

---

### [Chapter 03: Graph Scheduling & Write-Scope Isolation](./03-graph-scheduler/01-dependency-graph-theory.md)

7. **[01. Dependency Graph Theory & Schema](./03-graph-scheduler/01-dependency-graph-theory.md)**  
   _The plan graph's 8 node types and 10 edge types, Sugiyama Hierarchical DAG rendering (`graph:sugiyama`, `dag:render`), Tarjan cycle detection (`detectCyclesTarjan`), and orthogonal ASCII box layouts._
8. **[02. Topological Conflict-Free Batching & Concurrency Scaling](./03-graph-scheduler/02-topological-conflict-free-batching.md)**  
   _`proposeBatch` as the single scheduling authority, 6-factor ranking, glob-aware scope conflict (`detectScopeOverlap`), Brent Work/Span scaling ($W$, $S$, $P=\lceil W/S \rceil$), multi-coordinator partitioning, and anti-serialization interlocks (`FALSE_SERIALIZATION_BLUNDER`)._
9. **[03. Plan Revision, Replanning & Immutability](./03-graph-scheduler/03-plan-revision-and-freezing.md)**  
   _Three-tier plan stability, the structural freeze, independent plan-validator adversary, `gate:prove` falsifiability engine, Living Dynamic DAG Expansion (`dag:trace`), and `plan:replan` into a disjoint repair wave._

---

### [Chapter 04: Multi-Agent Deployment & Two-Tier Hierarchy](./04-multi-agent/01-host-agnostic-architecture.md)

10. **[01. Host-Agnostic Architecture & Adapters](./04-multi-agent/01-host-agnostic-architecture.md)**  
    _Tier 1 chat $\to$ Tier 2 coordinator $\to$ Tier 3 workers; Dual-Time Telemetry (monotonic sequence vs wall-clock ISO), host transcript probing, and `telemetry_conflicts` resolution._
11. **[02. Role Contracts & Task Execution Briefs](./04-multi-agent/02-immutable-role-packets.md)**  
    _The ten canonical roles, Lean Packets ($\le 4\text{KB}$ budgets), Validator Context Isolation (`isolateValidatorContext`, `excludeValidatorContamination`), and sycophancy mitigation._
12. **[03. Bearer Token Protocol & Dispatch Security](./04-multi-agent/03-bearer-token-security.md)**  
    _One-time stdout-delivered tokens, digest-only persistence including in reports, the three token families, and voluntary release._

---

### [Chapter 05: Task Lifecycle & Monitored Execution](./05-task-execution/01-leasing-and-heartbeats.md)

13. **[01. Leasing, Deadlines & Heartbeat Keepalive](./05-task-execution/01-leasing-and-heartbeats.md)**  
    _Time-bounded leases, `task:heartbeat`, lease suspension while branched, Watchdogs & Supervisory Monitoring (`watchdog:status`, `watchdog:cleanup`, `watchdog:verify`, `watchdog:probe`)._
14. **[02. Write Scopes & Directory Containment Invariants](./05-task-execution/02-atomic-filesystem-scopes.md)**  
    _Glob-aware containment, overlap vs containment, shared-file integration tasks, and scoping a task so it can branch._
15. **[03. Structured Submission & Monitored Command Evidence](./05-task-execution/03-submission-and-evidence-collection.md)**  
    _`task:submit --summary`, where each report field comes from, the on-disk command record, and byte-identical scope non-change detection._

---

### [Chapter 06: Adversarial Validation & Bounded Repair Loop](./06-validation-repair/01-adversarial-validation-philosophy.md)

16. **[01. Adversarial Validation: The Probe / Defect Split](./06-validation-repair/01-adversarial-validation-philosophy.md)**  
    _Why self-grading fails, the three independence rules, algorithmic context sanitization (`VALIDATOR_EXCLUSIONS`), and `task:probe` demands for proof._
17. **[02. Structured Finding Schema & Resolution](./06-validation-repair/02-structured-finding-schema.md)**  
    _`defect` vs `probe_demand`, the mandatory components, and closing a finding with `--resolve <finding-id>=<command-id>`._
18. **[03. Bounded Repair Routing & Escalation](./06-validation-repair/03-repair-routing-and-escalation.md)**  
    _The repair lease under `--role repairer`, the fresh-validator rule, the 6-round budget, and `plan:replan` into a parallel repair wave._

---

### [Chapter 07: Gates & Completeness Critic Verification](./07-gates-and-completion/01-mandatory-gate-systems.md)

19. **[01. Mandatory Gate Systems & Verification Contracts](./07-gates-and-completion/01-mandatory-gate-systems.md)**  
    _Task gates vs the mandatory `--completion-gate`, direct argv grammar, live repository bindings, and `run:exec` exit semantics._
20. **[02. Completeness Critic Verification Protocol](./07-gates-and-completion/02-completeness-critic-verification.md)**  
    _`critic:start`, the critic's own commands, mandatory requirement proofs, `unproven` as a blocker, and structured rejection._
21. **[03. Mechanical Completion Engine & The 9-Point Terminal Checklist](./07-gates-and-completion/03-mechanical-completion-engine.md)**  
    _Deterministic completion via `run:complete`, closing grants first, and reading the sealed run with `doctor` and `summary:view`._

---

### [Chapter 08: Durability & Crash Recovery](./08-durability-recovery/01-tamper-proof-hash-chains.md)

22. **[01. Event-Sourced Storage & Tamper-Proof Hash Chains](./08-durability-recovery/01-tamper-proof-hash-chains.md)**  
    _Append-only hash chains, `events.jsonl`, canonical JSON encoding, and tamper detection._
23. **[02. POSIX File Locking & Durable Writes](./08-durability-recovery/02-posix-flock-and-fdatasync.md)**  
    _Advisory file locking with `flock`, `fdatasync`, atomic temporary file replacement, and directory syncing._
24. **[03. Stale Worker, Crash Forensics & Torn Tail Quarantine](./08-durability-recovery/03-stale-worker-and-torn-tail-recovery.md)**  
    _Torn tail quarantine protocol, stale lease reclamation, Watchdog lifecycle monitoring (`watchdog:phase-cleanup`), and crash resilience._

---

### [Chapter 09: Branching, Grants & Evidence Honesty](./09-branching-and-honesty/01-execution-time-branching.md)

25. **[01. Execution-Time Branching & Collect](./09-branching-and-honesty/01-execution-time-branching.md)**  
    _`branch:open` … `branch:collect`, the four safety rules, lease suspension, dynamic Living Tracer replay, and why a branch never enters the plan DAG._
26. **[02. The Agent Grant Ledger & Lineage](./09-branching-and-honesty/02-agent-grant-ledger.md)**  
    _`agent:register` / `agent:report` / `agent:release` / `agent:list`, Host Telemetry Probe merging, and per-agent telemetry that is never inferred._
27. **[03. Evidence Classes & The Honesty Model](./09-branching-and-honesty/03-evidence-classes-and-honesty.md)**  
    _`harness_observed` / `agent_reported` / `host_reported` / `derived` / `unknown`, Dual-Time Telemetry pairing, and how the exported graph renders absence._

---

### [Chapter 10: Complete End-to-End Tutorial & CLI Manual](./10-tutorial-and-cli/01-end-to-end-tutorial.md)

28. **[01. Complete End-to-End Tutorial](./10-tutorial-and-cli/01-end-to-end-tutorial.md)**  
    _An executed walkthrough from prompt to sealed capsule — including `dag:render` Sugiyama visualization, `dag:trace` living dynamic step tracing, and `watchdog:verify` lifecycle auditing._
29. **[02. Comprehensive CLI Command Reference](./10-tutorial-and-cli/02-cli-command-reference.md)**  
    _The complete Zero-JSON colon CLI reference covering all 16 command domains, standard exit codes, and global flag conventions._
30. **[03. Troubleshooting, Blunder Dictionary & FAQ](./10-tutorial-and-cli/03-troubleshooting-and-faq.md)**  
    _The error code and blunder dictionary (`FALSE_SERIALIZATION_BLUNDER`, `WRITE_SCOPE_VIOLATION`), recovery workflows, and authoritative FAQ._

---

## 🎯 High-Level Architecture Overview

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                      USER PROMPT (Raw Bytes)                                      │
└─────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                  │
                                                  ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                          1. IMMUTABLE RUN CAPSULE (.capsules/<slug>/)                             │
│  • prompt.md (mode 0444, SHA-256 bound)    • manifest.json (runtime pin, environment hash)        │
│  • events.jsonl (SHA-256 HMAC hash chain)  • state.json (single projected atomic state)           │
│  • Kernel POSIX flock concurrency guard    • harness.config.json (probes=1, repair_budget=6)      │
└─────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                  │
                                                  ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                          2. REQUIREMENTS & LINE DISPOSITION ENGINE                                │
│  • 100% prompt line coverage invariant     • Atomic requirement nodes mapped via --req-lines      │
│  • Unmapped lines disposed as context      • Authority-gated obligations (needs_authority)        │
└─────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                  │
                                                  ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                          3. STRICT DEPENDENCY GRAPH & TOPOLOGY (state.graph)                      │
│  • 8 formal node types, 10 edge types      • Tarjan SCC linear cycle detector (detectCyclesTarjan)│
│  • Mandatory C6 topology declarations      • Sugiyama 4-phase hierarchical DAG (dag:render)       │
└─────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                  │
                                                  ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                          3B. DUAL ADVERSARIAL COMPILATION GATES                                   │
│  • Gate 1: Mechanical Plan Audit (plan:audit / Invariants A1-A6 block plan:compile)               │
│  • Gate 2: Independent Plan-Validator (plan:validate-start/review blocks task:claim)              │
│  • Dynamic Gate Falsifiability Engine (gate:prove on scratch copy reverts)                        │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                  │
                                                  ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                          4. CONFLICT-FREE WAVE SCHEDULER (proposeBatch)                           │
│  • Single scheduling authority             • 6-factor deterministic ranking comparator            │
│  • Glob-aware scope conflict detection     • Brent Work/Span scaling (P = ceil(W / S))            │
│  • Anti-serialization interlock: FALSE_SERIALIZATION_BLUNDER blocks lazy serial dispatch          │
│  • Multi-coordinator wave partitioning for > 5 lanes or cross-domain stacks                       │
└─────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                  │
                                                  ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                          5. CONTINUOUS PARALLEL EXECUTION & LEASING                               │
│                                                                                                   │
│  [ Master Coordinator ] ---agent:register---> state.agents workforce ledger                       │
│    │                                                                                              │
│    ├──► [ Tier 3 Implementer ]  task:claim -> run:exec -> task:submit                             │
│    │          │                                                                                   │
│    │          └──► branch:open -> [ sub-implementers ] -> branch:collect (parent lease frozen)    │
│    │                                                                                              │
│    └──► [ Tier 3 Validator ]  task:validate-start (fresh identity every round)                    │
│               │                                                                                   │
│         +-----+-----------------------+                                                           │
│         │                             │                                                           │
│    task:probe (Probe demand)     task:reject (Defect finding)                                     │
│    probe_round +1                repair_round +1 (budget 6, then escalated)                       │
│    task stays validating         task -> changes_requested -> task:claim --role repairer          │
│         │                             │                                                           │
│         v                             v                                                           │
│    task:review --status pass --resolve <finding>=<cmd-receipt> (100% findings resolved)           │
│                                                                                                   │
└─────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                  │
                                                  ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                          6. RUN-WIDE VERIFICATION & COMPLETENESS CRITIC                           │
│  • run:exec gate-run-completion            • Independent Completeness Critic (critic:start)       │
│  • Independent critic command receipts     • 100% requirement proof binding (/tmp/proofs.json)    │
└─────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                  │
                                                  ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                          7. MECHANICAL TERMINAL SEALING & AUDIT EXPORT                            │
│  • Clean workforce grant teardown (agent:release) prior to seal                                   │
│  • Cryptographic capsule seal: run:complete --auth-token <critic-certificate>                     │
│  • Summary suite export (summary:export): graph.json, timeline.json, metrics.json, summary.md    │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🧭 Persona-Based Recommended Reading Paths

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          RECOMMENDED READING PATHS                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. JUNIOR DEVELOPER / FIRST-TIME USER:                                     │
│     Start with Chapter 01 §01 (Mental Model)                                │
│       ──► Chapter 01 §03 (Lifecycle Walkthrough)                            │
│       ──► Chapter 10 §01 (Complete End-to-End Tutorial)                     │
│       ──► Chapter 10 §03 (Troubleshooting & FAQ)                            │
│                                                                             │
│  2. IMPLEMENTER AGENT (Tier 3 Worker):                                      │
│     Start with Chapter 04 §02 (Role Contracts & Packets)                    │
│       ──► Chapter 05 §01 (Leasing & Heartbeats)                             │
│       ──► Chapter 05 §02 (Write Scopes & Directory Invariants)              │
│       ──► Chapter 09 §01 (Execution-Time Branching)                         │
│       ──► Chapter 05 §03 (Structured Submissions)                           │
│                                                                             │
│  3. VALIDATOR & COMPLETENESS CRITIC (Adversarial Roles):                    │
│     Start with Chapter 06 §01 (Adversarial Philosophy)                      │
│       ──► Chapter 06 §02 (Finding Schema & Probe Demands)                   │
│       ──► Chapter 07 §01 (Mandatory Gate Systems)                           │
│       ──► Chapter 07 §02 (Completeness Critic Verification Protocol)        │
│       ──► Chapter 03 §03 (gate:prove Falsifiability Engine)                 │
│                                                                             │
│  4. DISTRIBUTED SYSTEMS & AI ARCHITECT:                                     │
│     Start with Chapter 01 §02 (Storage Model & Kernel flock)                │
│       ──► Chapter 03 §01 (Graph Theory & Tarjan SCC Detection)              │
│       ──► Chapter 03 §02 (Topological Batching & Brent Work/Span)           │
│       ──► Chapter 08 §01 (Cryptographic Hash Chains & Tamper Detection)     │
│       ──► Chapter 08 §03 (Crash Recovery & Torn Tail Quarantine)            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

[Proceed to Chapter 01: Mental Model & Foundations ➔](./01-foundations/01-why-long-tasks-fail.md)

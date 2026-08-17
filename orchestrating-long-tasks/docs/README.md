# Orchestrating Long Tasks — Master Documentation & Architectural Manual

Welcome to the definitive architectural manual and developer tutorial for the **`orchestrating-long-tasks`** agent skill.

This documentation is designed to take any developer—from junior engineers unfamiliar with distributed systems and formal state machines to senior systems architects—on a complete, deeply technical, step-by-step journey through how autonomous AI agents can safely, deterministically, and reliably orchestrate long-running, multi-phase, multi-agent coding tasks using a Zero-JSON CLI and Two-Tier Agent Architecture.

---

## 🧭 Navigation Matrix & Table of Contents

Every document in this directory includes previous/next navigation links at the top and bottom, structured section headings, architectural diagrams, concrete code snippets, and failure mode case studies.

### [Chapter 01: Mental Model & Architectural Foundations](./01-foundations/01-why-long-tasks-fail.md)

1. **[01. Why Long Tasks Fail in Autonomous Agents](./01-foundations/01-why-long-tasks-fail.md)**
   _Context decay, sycophancy, hallucinated progress, write collisions, and the core philosophy: "Prose is not state, memory is not proof."_
2. **[02. Capsule & Storage Model](./01-foundations/02-capsule-and-storage-model.md)**
   _The `.capsules/<run-id>/` directory layout, `prompt.md` immutability, `manifest.json`, `events.jsonl` cryptographic hash chain, `state.json` projection, and POSIX kernel `flock` atomicity._
3. **[03. The 9-Stage Lifecycle Walkthrough](./01-foundations/03-lifecycle-walkthrough.md)**
   _Bird's-eye view of the full lifecycle from prompt capture to mechanical run completion, alongside the formal task state machine._

---

### [Chapter 02: Prompt Compilation & Requirements Engine](./02-requirements/01-prompt-capture-and-integrity.md)

4. **[01. Prompt Capture & Byte-Exact Integrity](./02-requirements/01-prompt-capture-and-integrity.md)**
   _Preserving prompt bytes byte-for-byte via `plan:init`, capture modes (`stdin`, `file`), SHA-256 integrity binding, and preventing scope drift._
5. **[02. Line Disposition & Atomic Decomposition Algorithm](./02-requirements/02-line-disposition-algorithm.md)**
   _The 100% line coverage rule, mathematical disposition mapping, decomposing compound sentences into atomic requirements, and `plan:compile` verification._
6. **[03. Authority Decisions & External Gate Lifecycle](./02-requirements/03-authority-decisions-and-dispositions.md)**
   _Handling user-gated obligations (`needs_authority`), recording `grant`/`decline` decisions, clean task cancellation without fabricated proofs, and mixed task behavior._

---

### [Chapter 03: Graph Scheduling & Write-Scope Isolation](./03-graph-scheduler/01-dependency-graph-theory.md)

7. **[01. Dependency Graph Theory & Schema](./03-graph-scheduler/01-dependency-graph-theory.md)**
   _The 8 node types, 10 edge types, directed acyclic graph (DAG) execution rules, and relational schemas._
8. **[02. Topological Conflict-Free Batch Scheduling](./03-graph-scheduler/02-topological-conflict-free-batching.md)**
   _The exact scheduling algorithm: Ready calculation, 6-factor priority ranking, filesystem write-scope overlap detection, and `queue:pop` concurrency._
9. **[03. Plan Revision & Immutability Rules](./03-graph-scheduler/03-plan-revision-and-freezing.md)**
   _Plan versioning ($0 \to 1 \to 2$), structural freeze during execution, document archiving, and runtime state preservation._

---

### [Chapter 04: Multi-Agent Deployment & Two-Tier Hierarchy](./04-multi-agent/01-host-agnostic-architecture.md)

10. **[01. Host-Agnostic Architecture & Adapters](./04-multi-agent/01-host-agnostic-architecture.md)**
    _Two-Tier Agent Hierarchy (Tier 1 Chat $\to$ Tier 2 Coordinator $\to$ Tier 3 Workers), zero-dependency design, avoiding direct LLM API calls, and host adapters._
11. **[02. Role Briefs & Task Execution Contracts](./04-multi-agent/02-immutable-role-packets.md)**
    _Compact markdown briefs ($\le 30$ lines), 5 core roles (`planner`, `implementer`, `validator`, `repairer`, `completeness-critic`), and configurable repair limits._
12. **[03. Bearer Token Protocol & Dispatch Security](./04-multi-agent/03-bearer-token-security.md)**
    _One-time stdout-delivered tokens, SHA-256 digest-only persistence, deadline expiry, and secure recovery without leaking secrets._

---

### [Chapter 05: Task Lifecycle & Monitored Execution](./05-task-execution/01-leasing-and-heartbeats.md)

13. **[01. Leasing, Deadlines & Heartbeat Keepalive](./05-task-execution/01-leasing-and-heartbeats.md)**
    _Task leases, moving deadlines forward with `task:heartbeat`, cooperative release, and recovering stale tasks._
14. **[02. Write Scopes & Directory Containment Invariants](./05-task-execution/02-atomic-filesystem-scopes.md)**
    _Strict write containment, normalized ancestor matching, boundary breach quarantine, and shared file integration patterns._
15. **[03. Structured Submission & Monitored Command Evidence](./05-task-execution/03-submission-and-evidence-collection.md)**
    _`task:submit`, `run:exec` watchdog runner, capturing `trusted_host_observed_v1` evidence, and repository bindings._

---

### [Chapter 06: Adversarial Validation & Bounded Repair Loop](./06-validation-repair/01-adversarial-validation-philosophy.md)

16. **[01. Adversarial Validation Philosophy & Context Sanitization](./06-validation-repair/01-adversarial-validation-philosophy.md)**
    _Why self-grading fails, strict role separation, allowlisted context generation, and stripping implementer prose/confidence via `task:validate-start`._
17. **[02. Structured Finding Schema & Evidence Requirements](./06-validation-repair/02-structured-finding-schema.md)**
    _Finding structure (`F-xxx`), mandatory remediation and revalidation commands via `task:reject`, and mechanical proof for resolution._
18. **[03. Bounded Repair Routing & Configurable Repair Limits](./06-validation-repair/03-repair-routing-and-escalation.md)**
    _Automated repair feedback loop, configurable limits (`harness.config.json` with default 5 rounds), and escalation handling._

---

### [Chapter 07: Gates & Completeness Critic Verification](./07-gates-and-completion/01-mandatory-gate-systems.md)

19. **[01. Mandatory Gate Systems & Verification Contracts](./07-gates-and-completion/01-mandatory-gate-systems.md)**
    _Task gates vs run gates, direct argv grammar rules, and live repository bindings._
20. **[02. Completeness Critic Verification Protocol](./07-gates-and-completion/02-completeness-critic-verification.md)**
    _The final auditing barrier: `critic:start`, requirement and artifact inspection, and `critic:review`._
21. **[03. Mechanical Completion Engine & The 8-Point Terminal Checklist](./07-gates-and-completion/03-mechanical-completion-engine.md)**
    _Deterministic completion evaluation via `run:complete`, the 8-point checklist, and `run:status`._

---

### [Chapter 08: Durability & Crash Recovery](./08-durability-recovery/01-tamper-proof-hash-chains.md)

22. **[01. Event-Sourced Storage & Tamper-Proof Hash Chains](./08-durability-recovery/01-tamper-proof-hash-chains.md)**
    _Append-only hash chains, `events.jsonl`, canonical JSON encoding, and tamper detection._
23. **[02. POSIX File Locking & Durable Writes](./08-durability-recovery/02-posix-flock-and-fdatasync.md)**
    _Advisory file locking with `flock`, `fdatasync`, atomic temporary file replacement, and directory syncing._
24. **[03. Stale Worker, Crash Forensics & Torn Tail Quarantine](./08-durability-recovery/03-stale-worker-and-torn-tail-recovery.md)**
    _Torn tail quarantine protocol, stale lease reclamation, and crash resilience._

---

### [Chapter 09: Complete End-to-End Tutorial & CLI Manual](./09-tutorial-and-cli/01-end-to-end-tutorial.md)

25. **[01. Complete End-to-End Tutorial](./09-tutorial-and-cli/01-end-to-end-tutorial.md)**
    _A hands-on, practical walkthrough from an initial prompt to full completion, illustrating every CLI step, file creation, and state transition._
26. **[02. Comprehensive CLI Command Reference Manual](./09-tutorial-and-cli/02-cli-command-reference.md)**
    _Exhaustive reference for all Zero-JSON colon CLI commands (`plan:init`, `plan:add`, `plan:compile`, `queue:pop`, `task:claim`, `task:submit`, `task:validate-start`, `task:review`, `run:exec`, `critic:start`, `run:complete`, `summary:export`, `gvui:import`)._
27. **[03. Troubleshooting, Common Pitfalls & FAQ](./09-tutorial-and-cli/03-troubleshooting-and-faq.md)**
    _Common operational errors, diagnosing integrity issues, resolving gate failures, and answers to frequently asked questions._

---

## 🎯 High-Level Architecture Overview

```text
+---------------------------------------------------------------------------------------------------+
|                                      USER PROMPT (Raw Bytes)                                      |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                 1. IMMUTABLE RUN CAPSULE (.capsules/<run>/)                        |
|  - prompt.md (SHA-256 verified via plan:init) - events.jsonl (Append-only hash chain)             |
|  - manifest.json                              - state.json (Authoritative projection)             |
|  - Zero-JSON Colon CLI (harness.ts)           - harness.config.json (Default 5 repair rounds)     |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                 2. PROMPT COMPILATION & REQUIREMENTS                              |
|  - 100% Line Disposition Table (plan:compile) - Atomic Requirement Decomposition                  |
|  - Candidate Verification Gates               - Authority Gating (actionable vs needs_authority)  |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                 3. RELATIONAL DEPENDENCY GRAPH                                    |
|  - Task Nodes (Disjoint write scopes)         - Gate Nodes (Literal argv contracts)               |
|  - Dependency DAG (Cycle-free: plan:add)      - Disjoint Write Scope Isolation                    |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                 4. SCHEDULER & DISPATCH ENGINE                                    |
|  - Dependency Resolution (queue:next)         - Write-Scope Collision Check (queue:pop)           |
|  - Deterministic Priority Ranking             - Host Concurrency Limit (default_max_parallel)     |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                 5. TWO-TIER AGENT EXECUTION LANES                                 |
|                                                                                                   |
|  [ Tier 2: Background Run Coordinator ]                                                           |
|    │                                                                                              |
|    ├─> [ Tier 3 Implementer Agent ] <--- Leased Scope + Markdown Brief (Bearer Token Protected)   |
|    │         │                                                                                    |
|    │         v                                                                                    |
|    │   [ task:submit ]  ---> Changed files inside write scope + local verification                |
|    │         │                                                                                    |
|    │         v                                                                                    |
|    ├─> [ Tier 3 Independent Validator ] <--- Allowlisted context only (task:validate-start)       |
|              │                                                                                    |
|       +------+------+                                                                             |
|       |             |                                                                             |
|     (Pass)       (Reject) ---> Structured Findings (task:reject) ---> [ Repair ] (Default max 5)  |
|       |                                                                                           |
|       v                                                                                           |
|    [ Task Gates: run:exec ] ---> Trusted Host Observed Verification (trusted_host_observed_v1)    |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                 6. RUN GATES & COMPLETENESS CRITIC                                |
|  - Global Run Integration Gates (run:exec)    - Fresh Completeness Critic Review (critic:start)   |
|  - Zero Unresolved Findings                   - Zero Unassigned / Stale Leases                    |
|  - Live Repository Binding Re-check           - Critic Verdict (critic:review)                    |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                 7. MECHANICAL TERMINAL COMPLETION                                 |
|                                  (run:complete evaluates checklist)                               |
+---------------------------------------------------------------------------------------------------+
```

---

[Next: Chapter 01 — Why Long Tasks Fail in Autonomous Agents ➔](./01-foundations/01-why-long-tasks-fail.md)

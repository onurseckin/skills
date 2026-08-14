# Orchestrating Long Tasks — Master Documentation & Architectural Manual

Welcome to the definitive architectural manual and developer tutorial for the **`orchestrating-long-tasks`** agent skill.

This documentation is designed to take any developer—from junior engineers unfamiliar with distributed systems and formal state machines to senior systems architects—on a complete, deeply technical, step-by-step journey through how autonomous AI agents can safely, deterministically, and reliably orchestrate long-running, multi-phase, multi-agent coding tasks.

---

## 🧭 Navigation Matrix & Table of Contents

Every document in this directory includes previous/next navigation links at the top and bottom, structured section headings, architectural diagrams, concrete code snippets, and failure mode case studies.

### [Chapter 01: Mental Model & Architectural Foundations](./01-foundations/01-why-long-tasks-fail.md)
1. **[01. Why Long Tasks Fail in Autonomous Agents](./01-foundations/01-why-long-tasks-fail.md)**
   *Context decay, sycophancy, hallucinated progress, write collisions, and the core philosophy: "Prose is not state, memory is not proof."*
2. **[02. Capsule & Storage Model](./01-foundations/02-capsule-and-storage-model.md)**
   *The `.harness/<run-id>/` directory layout, `prompt.md` immutability, `manifest.json`, `events.jsonl` cryptographic hash chain, `state.json` projection, and POSIX kernel `flock` atomicity.*
3. **[03. The 9-Stage Lifecycle Walkthrough](./01-foundations/03-lifecycle-walkthrough.md)**
   *Bird's-eye view of the full lifecycle from prompt capture to mechanical run completion, alongside the formal task state machine.*

---

### [Chapter 02: Prompt Compilation & Requirements Engine](./02-requirements/01-prompt-capture-and-integrity.md)
4. **[01. Prompt Capture & Byte-Exact Integrity](./02-requirements/01-prompt-capture-and-integrity.md)**
   *Preserving prompt bytes byte-for-byte, capture modes (`file`, `stdin`, `verbatim_context_copy`), SHA-256 integrity binding, and preventing scope drift.*
5. **[02. Line Disposition & Atomic Decomposition Algorithm](./02-requirements/02-line-disposition-algorithm.md)**
   *The 100% line coverage rule, mathematical disposition mapping, decomposing compound sentences into atomic requirements, and plural line links.*
6. **[03. Authority Decisions & External Gate Lifecycle](./02-requirements/03-authority-decisions-and-dispositions.md)**
   *Handling user-gated obligations (`needs_authority`), recording `grant`/`decline` decisions, clean task cancellation without fabricated proofs, and mixed task behavior.*

---

### [Chapter 03: Graph Scheduling & Write-Scope Isolation](./03-graph-scheduler/01-dependency-graph-theory.md)
7. **[01. Dependency Graph Theory & Schema](./03-graph-scheduler/01-dependency-graph-theory.md)**
   *The 8 node types, 10 edge types, directed acyclic graph (DAG) execution rules, and semantic relational graphs.*
8. **[02. Topological Conflict-Free Batch Scheduling](./03-graph-scheduler/02-topological-conflict-free-batching.md)**
   *The exact scheduling algorithm: Ready calculation, 6-factor priority ranking, filesystem write-scope overlap detection, and concurrency packing.*
9. **[03. Plan Revision & Immutability Rules](./03-graph-scheduler/03-plan-revision-and-freezing.md)**
   *Plan versioning ($0 \to 1 \to 2$), structural freeze during execution, document archiving, and runtime state preservation.*

---

### [Chapter 04: Multi-Agent Deployment & Role Packets](./04-multi-agent/01-host-agnostic-architecture.md)
10. **[01. Host-Agnostic Architecture & Adapters](./04-multi-agent/01-host-agnostic-architecture.md)**
    *Zero-dependency design, avoiding direct LLM API calls, host adapters (Google Antigravity, Claude Code, OpenAI Codex, ChatGPT), and coordinator role separation.*
11. **[02. Immutable Role Packets & Templates](./04-multi-agent/02-immutable-role-packets.md)**
    *Role templates (`planner`, `implementer`, `validator`, `repairer`, `completeness-critic`), appending `common-instructions.md`, and cryptographic packet sealing.*
12. **[03. Bearer Token Protocol & Dispatch Security](./04-multi-agent/03-bearer-token-security.md)**
    *One-time host-delivered tokens, SHA-256 digest-only persistence, deadline expiry, and secure recovery without leaking secrets.*

---

### [Chapter 05: Task Lifecycle, Execution & Watchdog Runner](./05-task-execution/01-leasing-and-heartbeats.md)
13. **[01. Leases, Heartbeats & Expiry Recovery](./05-task-execution/01-leasing-and-heartbeats.md)**
    *Task leases, moving deadlines forward with heartbeats, cooperative release, and recovering stale tasks into `retry_ready` or `changes_requested`.*
14. **[02. The Watchdog Command Runner Engine](./05-task-execution/02-watchdog-command-runner.md)**
    *Shell-free direct execution, detached process groups (`setpgid`), host-ancestor kill protection, wall-clock/idle timeouts, and idempotent retry backoff.*
15. **[03. Trusted-Host Observed Evidence & Git Security Seams](./05-task-execution/03-trusted-host-observed-evidence.md)**
    *The `trusted_host_observed_v1` contract, pre/post repository snapshot binding, sanitized Git subprocess execution, and forbidden assurance inflation.*

---

### [Chapter 06: Adversarial Validation & Bounded Repair Loop](./06-validation-repair/01-adversarial-validation-philosophy.md)
16. **[01. Adversarial Validation Philosophy & Anti-Anchoring](./06-validation-repair/01-adversarial-validation-philosophy.md)**
    *Why self-grading fails, strict role separation, allowlisted context generation, and stripping implementer prose/confidence.*
17. **[02. Structured Rejections & Findings Architecture](./06-validation-repair/02-structured-rejection-and-findings.md)**
    *Finding structure (`F-xxx`), mandatory remediation and revalidation commands, rejecting prose-only reviews, and task transition to `changes_requested`.*
18. **[03. Repair Routing, Replacement Policies & Escalation](./06-validation-repair/03-repair-routing-and-escalation.md)**
    *Routing repairs to the original implementer, replacement policies (`unavailable`, `stale`, `repeated_failure`), fresh validator re-checks, and the 3-round escalation limit.*
19. **[04. Orphan Evidence Handling & Audited Dispositions](./06-validation-repair/04-orphan-evidence-handling.md)**
    *Handling late arriving submissions, immutable evidence quarantine, and terminal dispositions (`rejected`, `superseded`, `ignored_non_authoritative`).*

---

### [Chapter 07: Gates & Completeness Critic Verification](./07-gates-and-completion/01-task-and-run-gates.md)
20. **[01. Task Gates, Run Gates & Strict Command Grammar](./07-gates-and-completion/01-task-and-run-gates.md)**
    *Mandatory vs optional gates, strict command grammar (bare executables, no trailing args on scripts, custom verifier paths), and cryptographic fingerprint matching.*
21. **[02. Completeness Critic Lifecycle & Mechanical Completion](./07-gates-and-completion/02-completeness-critic-lifecycle.md)**
    *The final completion barrier: `begin-critic`, building the critic packet, `review-completion`, `remediate-completion` command loops, and the zero-blocker `complete` gate.*

---

### [Chapter 08: Durability, Crash Recovery & Multi-Client Installation](./08-durability-recovery/01-event-sourcing-and-crash-recovery.md)
22. **[01. Event Sourcing, Projection Recovery & Handoffs](./08-durability-recovery/01-event-sourcing-and-crash-recovery.md)**
    *Append-only hash chains, forensic tail recovery, torn write handling, diagnostic `doctor`, and zero-context agent handoff via `handoff.md`.*
23. **[02. The Multi-Client Installation Engine](./08-durability-recovery/02-multi-client-installer-engine.md)**
    *Zero-dependency installer for Codex, ChatGPT, Claude Code, and Antigravity, atomic transactional release copies, tree digests, symlink safety, and rollback journals.*

---

### [Chapter 09: Complete End-to-End Tutorial & CLI Manual](./09-tutorial-and-cli/01-step-by-step-junior-dev-tutorial.md)
24. **[01. Step-by-Step Junior Developer Tutorial](./09-tutorial-and-cli/01-step-by-step-junior-dev-tutorial.md)**
    *A hands-on, practical walkthrough from an initial prompt to full completion on a sample project, illustrating every CLI step, file creation, and state transition.*
25. **[02. Complete CLI Command Reference](./09-tutorial-and-cli/02-complete-cli-command-reference.md)**
    *Exhaustive, flag-by-flag manual for all 25+ CLI commands, including exact input payloads, stdout/stderr JSON schemas, exit codes, and examples.*
26. **[03. Troubleshooting Guide, Failure Modes & FAQ](./09-tutorial-and-cli/03-troubleshooting-and-faq.md)**
    *Common operational errors, diagnosing integrity issues, resolving gate failures, and answers to frequently asked architectural questions.*

---

## 🎯 High-Level Architecture Overview

Below is the conceptual architecture showing how a user prompt moves through the immutable storage capsule, the graph scheduler, multi-agent dispatch, adversarial validation, gate verification, and final mechanical completion:

```text
+---------------------------------------------------------------------------------------------------+
|                                      USER PROMPT (Raw Bytes)                                      |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                 1. IMMUTABLE RUN CAPSULE (.harness/<run>/)                        |
|  - prompt.md (SHA-256 verified)         - events.jsonl (Append-only hash chain)                   |
|  - manifest.json                        - state.json (Authoritative projection)                   |
|  - Pinned Bun Runtime (.harness/<run>/runtime/harness.ts)                                         |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                 2. PROMPT COMPILATION & REQUIREMENTS                              |
|  - 100% Line Disposition Table          - Atomic Requirement Decomposition                        |
|  - Candidate Verification Gates         - Authority Gating (actionable vs needs_authority)        |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                 3. RELATIONAL DEPENDENCY GRAPH                                    |
|  - Task Nodes (Normalized write scopes) - Gate Nodes (Literal argv contracts)                     |
|  - Dependency DAG (Cycle-free)          - Artifact & Decision Nodes                               |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                 4. SCHEDULER & DISPATCH ENGINE                                    |
|  - Dependency Resolution (Prereqs Done) - Write-Scope Collision Check (Disjoint paths)            |
|  - Deterministic Priority Ranking       - Host Concurrency Limit (max-parallel)                   |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                 5. MULTI-AGENT EXECUTION LANES                                    |
|                                                                                                   |
|  [ Implementer Agent ]  <--- Leased Scope + Immutable Task Packet (Token Protected)               |
|            |                                                                                      |
|            v                                                                                      |
|  [ Submission Report ]  ---> Changed files inside write scope + command evidence                  |
|            |                                                                                      |
|            v                                                                                      |
|  [ Independent Validator ] <--- Allowlisted context only (No implementer confidence/prose)        |
|            |                                                                                      |
|     +------+------+                                                                               |
|     |             |                                                                               |
|   (Pass)       (Reject) ---> Structured Findings (F-xxx) ---> [ Repairer Agent ] (Max 3 rounds)   |
|     |                                                                |                            |
|     v                                                                +---> Fresh Validator Recheck|
|  [ Task Gates ] ---> Trusted Host Observed Verification (Pre/Post Repository Bindings)            |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                 6. RUN GATES & COMPLETENESS CRITIC                                |
|  - Global Run Integration Gates         - Fresh Completeness Critic Review                        |
|  - Zero Unresolved Findings             - Zero Unassigned / Stale Leases                          |
|  - Live Repository Binding Re-check     - Audited Orphan Evidence Dispositions                    |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                 7. MECHANICAL TERMINAL COMPLETION                                 |
|                                     (complete command passes)                                     |
+---------------------------------------------------------------------------------------------------+
```

---

[Next: Chapter 01 — Why Long Tasks Fail in Autonomous Agents ➔](./01-foundations/01-why-long-tasks-fail.md)

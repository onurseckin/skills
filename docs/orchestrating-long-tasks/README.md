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
8. **[02. Topological Conflict-Free Batching & The Recorded Topology](./03-graph-scheduler/02-topological-conflict-free-batching.md)**
   _`proposeBatch` as the single scheduling authority, 6-factor ranking, glob-aware scope conflict, Work/Span complexity analysis ($T_1$, $T_\infty$), and `state.topology`._
9. **[03. Plan Revision, Replanning & Immutability](./03-graph-scheduler/03-plan-revision-and-freezing.md)**
   _Structural freeze, Living Dynamic DAG Expansion (`dag:trace`, `DynamicDagState`), telemetry replay, `plan:replan` into a disjoint repair wave, and immutable histories._

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
29. **[02. CLI Command Reference](./10-tutorial-and-cli/02-cli-command-reference.md)**
    _A pointer to the generated `references/cli-capabilities.md` manifest, full domain index including reporting and authority watchdog operations, and CLI conventions._
30. **[03. Troubleshooting, Common Pitfalls & FAQ](./10-tutorial-and-cli/03-troubleshooting-and-faq.md)**
    _The refusals you will actually hit, verbatim, with what each one means and how to satisfy it._

---

## 🎯 High-Level Architecture Overview

```text
+---------------------------------------------------------------------------------------------------+
|                                      USER PROMPT (Raw Bytes)                                      |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                          1. IMMUTABLE RUN CAPSULE (.capsules/<run>/)                              |
|  - prompt.md, mode 0444, SHA-256 bound  (plan:init)                                               |
|  - events.jsonl: append-only hash chain - state.json: the only projection                         |
|  - planning/ (plan:enhance, derived)    - harness.config.json: probes 1, repair rounds 6          |
|  - plan:init --run takes a bare id, or one .capsules/ prefix stripped; any embedded / is refused  |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                          2. REQUIREMENTS: 100% LINE DISPOSITION (plan:compile)                    |
|  - One requirement per task, bound by --requirement-lines                                         |
|  - Unclaimed lines disposed as `context`, visibly, never dropped                                  |
|  - Mandatory --completion-gate; the compiler invents none                                         |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                          3. GRAPH + RECORDED TOPOLOGY (state.graph, state.topology)               |
|  - Cycle-free depends_on DAG            - Disjoint, glob-aware write scopes                       |
|  - Waves and per-task decisions recorded once, read by everything downstream                      |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                    3B. PLAN AUDIT + THE PLAN'S OWN ADVERSARY (plan:audit, plan-validator)         |
|  - Six structural invariants (A1-A6) block plan:compile; override needs --accept-audit <id>:<why> |
|  - Every --deps edge needs a one-line --dep-reason, or plan:compile refuses to seal               |
|  - Independent plan-validator may reject the revision; claimTask hard-stops until it re-passes    |
|  - gate:prove reverts a task's scope in a scratch copy and requires the gate to fail (proof feeds |
|    back into A3/A6 instead of the static heuristic alone)                                         |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                          4. SCHEDULER: proposeBatch, ONE AUTHORITY                                |
|  - queue:wave is read-only ranking; queue:pop claims one task at a time as agents free up         |
|  - 6-factor ranking, greedy conflict-free packing, capped by default_max_parallel                 |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                          5. DISPATCH & EXECUTION LANES                                            |
|                                                                                                   |
|  [ Tier 2 Coordinator ] --agent:register--> every subagent enters state.agents before it works    |
|    |                                                                                              |
|    +--> [ Tier 3 Implementer ]  task:claim --role implementer -> run:exec -> task:submit          |
|    |          |                                                                                   |
|    |          +--branch:open--> [ sub-implementer | sub-investigator ] --branch:collect-->        |
|    |                            parent lease frozen; git-observed files on collect                |
|    |                                                                                              |
|    +--> [ Tier 3 Validator ]  task:validate-start (fresh identity every round)                    |
|               |                                                                                   |
|        +------+---------------------+                                                             |
|        |                            |                                                             |
|   task:probe  "prove X"        task:reject  "X is broken"                                         |
|   probe_round +1               repair_round +1 (budget 6, then escalated)                         |
|   task stays validating        task -> changes_requested -> task:claim --role repairer            |
|        |                                                                                          |
|        v                                                                                          |
|   task:review --status pass --resolve <finding>=<command>  (every open finding, no exceptions)    |
|  - task:submit refuses a scope whose content digest matches claim-time, unless --no-op --reason   |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                          6. RUN GATE & COMPLETENESS CRITIC                                        |
|  - run:exec gate-run-completion         - critic:start, then the critic runs its OWN commands     |
|  - Requirement proofs are mandatory     - An unproven requirement blocks completion               |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                          7. MECHANICAL TERMINAL COMPLETION                                        |
|  - agent:release every grant FIRST, then run:complete; a sealed run is terminal                   |
|  - summary:export writes the graph, timeline and metrics, every value carrying its evidence_class |
+---------------------------------------------------------------------------------------------------+
```

---

[Next: Chapter 01 — Why Long Tasks Fail in Autonomous Agents ➔](./01-foundations/01-why-long-tasks-fail.md)

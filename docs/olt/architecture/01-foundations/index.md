# Chapter 01: Foundations & Core Invariants

---

[Previous: Master Architecture Index](../index.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 01-01 Zero-Assumption Philosophy](01-01-zero-assumption-philosophy.md)

---

## 1. Chapter Overview & Epistemic Scope

Welcome to Chapter 01 of the OLT (Orchestrating Long Tasks) Architecture Book. This chapter establishes the fundamental theoretical principles, epistemic rules, and mechanical safety invariants that govern the entire OLT autonomous engineering engine.

Large-scale agentic execution fails systematically when systems rely on unstated assumptions, implicit environment parameters, or unverified agent assertions. Chapter 01 codifies the Zero-Assumption Philosophy, details the Four Hard Zeros ($Z_4$) and extended bounds ($Z_8$), formalizes the 15 Positive System Invariants ($\mathcal{C}_{1 \dots 15}$ categorized across Ingestion, Scheduling, Verification, and Durability), defines the Deterministic Capsule State Machine, and outlines the Reflog Safety & Git Staging Protocol.

```text
+--------------------------------------------------------------------------------------------------+
│                               CHAPTER 01: FOUNDATIONS TOPOLOGY                                   │
+--------------------------------------------------------------------------------------------------+
│                                                                                                  │
│   ┌───────────────────────────┐                     ┌───────────────────────────┐                │
│   │ 01-01: Zero-Assumption    │                     │ 01-02: Hard Zeros &       │                │
│   │ Philosophy & Epistemics   │ ═══════════════════►│ Formal Invariant Catalog  │                │
│   └─────────────┬─────────────┘                     └─────────────┬─────────────┘                │
│                 │                                                 │                              │
│                 ▼                                                 ▼                              │
│   ┌───────────────────────────┐                     ┌───────────────────────────┐                │
│   │ 01-03: Deterministic      │                     │ 01-04: Reflog Safety &    │                │
│   │ Capsule State Machine     │ ═══════════════════►│ Subdomain Git Staging     │                │
│   └───────────────────────────┘                     └───────────────────────────┘                │
│                                                                                                  │
+--------------------------------------------------------------------------------------------------+
```

---

## 2. Chapter Table of Contents & Learning Path

```text
+--------------------------------------------------------------------------------------------------+
│                                 CHAPTER 01 TOPIC DIRECTORY                                       │
+--------------------------------------------------+--------------+--------------------------------+
│ Document                                         │ Classification│ Core Architectural Focus       │
+--------------------------------------------------+--------------+--------------------------------+
│ 01-01 Zero-Assumption Philosophy                │ Theory       │ Epistemic grounding & Z_4      │
│ 01-02 The Hard Zeros & Invariant Catalog        │ Specification│ 15 Positive Invariants (C1-C15)│
│ 01-03 Deterministic Capsule State Machine        │ Architecture │ SSoT, event sourcing & folds   │
│ 01-04 Reflog Safety & Git Staging                │ Operations   │ Git staging, reflog & recovery │
+--------------------------------------------------+--------------+--------------------------------+
```

### [01-01: Zero-Assumption Philosophy & Epistemic Verification](01-01-zero-assumption-philosophy.md)

Explores the epistemic foundation of OLT: state must be observed and proven rather than inferred. Details the Four Hard Zeros ($Z_{\text{hallucination}}=0$, $Z_{\text{mutation}}=0$, $Z_{\text{scope}}=0$, $Z_{\text{assumption}}=0$), the Verification Triad (Static AST, Dynamic Runtime, Cryptographic Ledger), and the mathematical gate predicate $\mathcal{V}(s, a, e)$.

### [01-02: The Hard Zeros & Positive Invariant Catalog](01-02-the-hard-zeros-and-invariants.md)

Presents the complete catalog of system invariants ($\mathcal{C}_1$ through $\mathcal{C}_{15}$) alongside the extended Hard Zeros ($Z_8$). Formalizes prompt sealing, monotonic lease HMAC tokens, path scope confinement, dual-channel verification interlocks, Tarjan SCC cycle-breaking, cognitive validator hard-locks, and Cowan context sanitization.

### [01-03: Deterministic Capsule State Machine](01-03-deterministic-capsule-state-machine.md)

Deconstructs the on-disk capsule directory layout (`.olt/capsules/<slug>/`). Details the 8-state lifecycle state machine ($\Sigma$), event-sourced projection semigroup folds ($S_t = \text{FoldLeft}(\mathcal{P}, S_0, [e_1 \dots e_t])$), POSIX advisory locking via `flock`, and the torn-tail auto-healing algorithm.

### [01-04: Reflog Safety & Subdomain Git Staging](01-04-reflog-safety-and-git-staging.md)

Details the immediate staging invariant (`git add -A`), zero uncommitted progress guarantees, low-level Git plumbing mechanics (`hash-object`, `update-index`, `write-tree`), and the 4-step disaster recovery playbook using `git reflog` and Merkle event hashes to survive crashes with zero state loss.

---

## 3. Invariant Category Taxonomy

The 15 Positive Invariants ($\mathcal{C}_1 \dots \mathcal{C}_{15}$) are partitioned across four foundational operational domains:

```text
+--------------------------------------------------------------------------------------------------+
│                             INVARIANT TAXONOMY & ENFORCEMENT PILLARS                             │
+-------------------------+-----------------------------------+------------------------------------+
│ Operational Domain      │ Constituent Invariants            │ Primary Enforcement Mechanism      │
+-------------------------+-----------------------------------+------------------------------------+
│ Ingestion & Security    │ C1 (Sealing), C2 (Leasing),       │ Read-only chmod 0444, HMAC tokens, │
│                         │ C3 (Scope), C10 (Worktree)        │ and Path Confinement Engine        │
+-------------------------+-----------------------------------+------------------------------------+
│ Scheduling & Wave Flow  │ C6 (Cycle Break), C8 (Quiet),     │ Tarjan SCC cut, Telemetry routing, │
│                         │ C11 (Anti-Batch), C14 (SLA Watch) │ and 300-second Heartbeat Watchdog  │
+-------------------------+-----------------------------------+------------------------------------+
│ Validation & Quality    │ C4 (Dual-Channel), C7 (Hard-Lock),│ TypeScript AST Compiler Scan,      │
│                         │ C12 (Cowan Budget), C13 (AST Pure)│ Hermetic Bun Test Runner receipts  │
+-------------------------+-----------------------------------+------------------------------------+
│ Durability & Recovery   │ C5 (Monotonic), C9 (Git Staging), │ SHA-256 Merkle Chaining, POSIX     │
│                         │ C15 (Merkle Durability)           │ flock, and Git Subdomain Staging   │
+-------------------------+-----------------------------------+------------------------------------+
```

---

## 4. Core Invariant Mathematical Reference Table

$$ \begin{array}{|l|l|l|}
\hline
\textbf{Invariant} & \textbf{Formal Formulation} & \textbf{Operational Description} \\ \hline
\text{Prompt Hash } (\mathcal{C}_1) & h_{\text{prompt}} = \text{SHA256}(P) & \text{Prompt sealing under Unix mode 0444 read-only} \\ \hline
\text{Monotonic Lease } (\mathcal{C}_2) & \text{seq}_k > \text{seq}_{k-1} & \text{Exclusive HMAC token sequence progression} \\ \hline
\text{Scope Guard } (\mathcal{C}_3) & p \in \mathcal{S}_{\text{granted}} \land p \notin \mathcal{S}_{\text{forbidden}} & \text{Worktree path confinement enforcement} \\ \hline
\text{Dual Verification } (\mathcal{C}_4) & V_{\text{cog}} \land (\text{ExitCode}=0) \land (\text{ASTFaults}=0) & \text{Cognitive and mechanical verification gate} \\ \hline
\text{Monotonic Lifecycle } (\mathcal{C}_5) & \text{INIT} \prec \dots \prec \text{CONVERGED} & \text{Forward-only state transition partial ordering} \\ \hline
\text{Cycle Cut } (\mathcal{C}_6) & e_{\text{cut}} = \arg\min_{e \in C} \text{Weight}(e) & \text{Tarjan SCC cycle breaking in dependency DAG} \\ \hline
\text{Validator Hard-Lock } (\mathcal{C}_7) & \text{Role}(A) = \text{Val} \implies \text{Exec} \equiv \emptyset & \text{Mechanical lock on terminal execution privileges} \\ \hline
\text{Quiet Mandate } (\mathcal{C}_8) & \text{StdIO}_{\text{user}} \cap \text{Chatter}_{\text{agents}} \equiv \emptyset & \text{Telemetry and mailboxes isolate agent comms} \\ \hline
\text{Git Staging } (\mathcal{C}_9) & \Delta \mathcal{W} \neq \emptyset \implies \text{git add -A} & \text{Immediate post-milestone Git index staging} \\ \hline
\text{Worktree Isolation } (\mathcal{C}_{10}) & \mathcal{W}_i \subset \texttt{.olt/worktrees/} & \text{Hermetic out-of-repo worker worktrees} \\ \hline
\text{Anti-Batching } (\mathcal{C}_{11}) & |\text{Tasks}(A)| \equiv 1 & \text{Strict 1:1 worker-to-task assignment} \\ \hline
\text{Cowan Budget } (\mathcal{C}_{12}) & \text{Tokens}(\text{Payload}) \le 150{,}000 & \text{LLM context budget sanitization and bounding} \\ \hline
\text{AST Purity } (\mathcal{C}_{13}) & \text{AnyCount} = 0 \land L_{\text{src}} \le 300 & \text{TypeScript Compiler API AST structural bounds} \\ \hline
\text{Straggler SLA } (\mathcal{C}_{14}) & \Delta t_{\text{heartbeat}} \le 300\text{s} & \text{5-minute watchdog lease revocation and requeue} \\ \hline
\text{Merkle Chain } (\mathcal{C}_{15}) & h_i = \text{SHA256}(h_{i-1} \mathbin{\Vert} \text{Canon}(e_i)) & \text{Tamper-evident chronological event ledgering} \\ \hline
\end{array}$$

```mermaid
graph LR
    subgraph Chapter_01_Foundations ["Chapter 01: Foundations"]
        A["01-01 Zero Assumption"] --> B["01-02 Invariant Catalog"]
        B --> C["01-03 State Machine"]
        C --> D["01-04 Reflog Safety"]
    end
    D --> E["Chapter 02: Four-Tier Hierarchy"]
```

---

## 5. Architectural Cross-References

The foundational mechanics introduced in this chapter serve as prerequisites for subsequent architecture chapters:

- **[Chapter 02: Four-Tier Workforce Hierarchy](../02-four-tier-hierarchy/index.md)**: Extends $\mathcal{C}_7$ and $Z_{\text{mutation}}$ into strict role contracts and supervisory boundaries.
- **[Chapter 05: Concurrency & Straggler SLA](../05-concurrency-straggler-sla/index.md)**: Deepens $\mathcal{C}_{14}$ (5-Minute Straggler SLA) with Brent's Work-Span theorem and Coffman-Graham width bounds.
- **[Chapter 06: Topological Scheduler & DAG Execution](../06-topological-scheduler-dags/index.md)**: Formalizes $\mathcal{C}_6$ cycle detection and dynamic wave decoupling.
- **[Chapter 07: Distributed Leasing & Worker Execution](../07-distributed-leasing-execution/index.md)**: Deepens $\mathcal{C}_2$ and $\mathcal{C}_3$ with HMAC lease tokens and heartbeat anti-theft locking.
- **[Chapter 08: Adversarial Validation & Monotonic Repair](../08-adversarial-validation-repair/index.md)**: Implements $\mathcal{C}_4$ dual-channel verification and cognitive review cycles.
- **[Chapter 10: Durability, Recovery & Capsule Ledger](../10-durability-recovery-capsules/index.md)**: Exhaustively details $\mathcal{C}_{15}$ SHA-256 Merkle chaining and POSIX flock advisory locking.

---

## 6. Summary & Transition

The foundational guarantees codified in Chapter 01 establish the bedrock upon which all higher-tier autonomous agents, DAG schedulers, distributed leases, and validation engines operate.

Advance directly to the first topic: [01-01: Zero-Assumption Philosophy & Epistemic Verification](01-01-zero-assumption-philosophy.md), or proceed to [Chapter 02: Four-Tier Workforce Hierarchy](../02-four-tier-hierarchy/index.md).

---

[Previous: Master Architecture Index](../index.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 01-01 Zero-Assumption Philosophy](01-01-zero-assumption-philosophy.md)

---
$$

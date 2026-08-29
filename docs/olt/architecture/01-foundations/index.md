# Chapter 01: Foundations & Core Invariants

---

[Previous: Master Architecture Index](../index.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 01-01 Zero-Assumption Philosophy](01-01-zero-assumption-philosophy.md)

---

## 1. Chapter Overview & Epistemic Scope

Welcome to Chapter 01 of the OLT Architecture Book. This chapter establishes the fundamental theoretical principles, epistemic rules, and mechanical safety invariants that govern the entire OLT (Orchestrating Long Tasks) autonomous engineering engine.

Large-scale agentic execution fails when systems rely on unstated assumptions, implicit environment parameters, or unverified agent assertions. Chapter 01 codifies the Zero-Assumption Philosophy, details the 4 Hard Zeros ($Z_4$), formalizes the 15 Positive System Invariants ($\mathcal{C}_{1 \dots 15}$ thematically grouped across Ingestion, Execution, Validation, and Durability), defines the Deterministic Capsule State Machine, and outlines the Reflog Safety & Subdomain Git Staging protocol.

```text
+--------------------------------------------------------------------------------------------------+
│                               CHAPTER 01: FOUNDATIONS TOPOLOGY                                   │
+--------------------------------------------------------------------------------------------------+
│                                                                                                  │
│    ┌───────────────────────────┐                    ┌───────────────────────────┐                │
│    │ 01-01: Zero-Assumption    │                    │ 01-02: Hard Zeros &       │                │
│    │ Philosophy & Epistemics   │ ══════════════════►│ Formal Invariant Catalog  │                │
│    └─────────────┬─────────────┘                    └─────────────┬─────────────┘                │
│                  │                                                │                              │
│                  ▼                                                ▼                              │
│    ┌───────────────────────────┐                    ┌───────────────────────────┐                │
│    │ 01-03: Deterministic      │                    │ 01-04: Reflog Safety &    │                │
│    │ Capsule State Machine     │ ══════════════════►│ Subdomain Git Staging     │                │
│    └───────────────────────────┘                    └───────────────────────────┘                │
│                                                                                                  │
+--------------------------------------------------------------------------------------------------+
```

---

## 2. Chapter Table of Contents & Learning Path

```text
+--------------------------------------------------+--------------+--------------------------------+
│ Document                                         │ Classification│ Core Architectural Focus       │
+--------------------------------------------------+--------------+--------------------------------+
│ 01-01 Zero-Assumption Philosophy                │ Theory       │ Epistemic grounding & Z_4      │
│ 01-02 The Hard Zeros & Invariant Catalog        │ Specification│ 15 Positive Invariants (C1-C15)│
│ 01-03 Deterministic Capsule State Machine        │ Architecture │ SSoT, event sourcing & folds   │
│ 01-04 Reflog Safety & Git Staging                │ Operations   │ Git staging, reflog & recovery │
+--------------------------------------------------+--------------+--------------------------------+
```

### [01-01: Zero-Assumption Philosophy & Core Invariants](01-01-zero-assumption-philosophy.md)

Explores the epistemic foundation of OLT: state must be observed and proven rather than inferred. Introduces the Four Hard Zeros ($Z_{\text{hallucination}}=0$, $Z_{\text{mutation}}=0$, $Z_{\text{scope}}=0$, $Z_{\text{assumption}}=0$), the Verification Triad, and the mathematical predicate for falsifiable gate verification $\mathcal{V}(s, a, e)$.

### [01-02: The 4 Hard Zeros & Formal Invariant Catalog](01-02-the-hard-zeros-and-invariants.md)

Presents the complete catalog of system invariants ($\mathcal{C}_1$ through $\mathcal{C}_{15}$). Formalizes prompt sealing, monotonic lease HMAC tokens, path scope confinement, dual-channel verification interlocks, Tarjan SCC cycle-breaking, cognitive validator hard-locks, and Cowan context sanitization.

### [01-03: Deterministic Capsule State Machine](01-03-deterministic-capsule-state-machine.md)

Deconstructs the on-disk capsule directory layout (`.olt/capsules/<slug>/`). Details the seven-phase lifecycle state machine ($\Sigma$), event-sourced projection mathematical folds ($S_t = \text{Fold}(S_0, [e_1 \dots e_t])$), and the torn-tail auto-healing algorithm.

### [01-04: Reflog Safety & Subdomain Git Staging](01-04-reflog-safety-and-git-staging.md)

Details the immediate staging invariant (`git add -A`), zero uncommitted progress guarantees, and the 4-step disaster recovery playbook using `git reflog` and Merkle event hashes to survive crashes with zero state loss.

---

## 3. Core Invariant Mathematical Reference Table

$$ \begin{array}{|l|l|l|}
\hline
\textbf{Invariant} & \textbf{Formal Equation} & \textbf{Description} \\ \hline
\text{Prompt Hash} & h_{\text{prompt}} = \text{SHA256}(P) & \text{Prompt sealing under 0444 read-only mode} \\ \hline
\text{Monotonic Lease} & \text{seq}_k > \text{seq}_{k-1} & \text{Exclusive token sequence progression} \\ \hline
\text{Scope Guard} & p \in \mathcal{S}_{\text{granted}} \land p \notin \mathcal{S}_{\text{forbidden}} & \text{Path confinement enforcement} \\ \hline
\text{Dual Verification} & V_{\text{cog}} \land (\text{ExitCode}=0) \land (\text{AST}=0) & \text{Cognitive and mechanical verification} \\ \hline
\text{State Fold} & S_t = \mathcal{P}(S_{t-1}, e_t) & \text{Deterministic event replay} \\ \hline
\text{Merkle Chain} & h_i = \text{SHA256}(h_{i-1} \mathbin{\Vert} \text{Canon}(e_i)) & \text{Tamper-evident chronological ledgering} \\ \hline
\text{Straggler SLA} & \Delta t_{\text{heartbeat}} \le 300\text{s} & \text{5-minute watchdog lease revocation} \\ \hline
\end{array}$$

```mermaid
graph LR
    subgraph "Chapter 01 Foundations"
        A[01-01 Zero Assumption] --> B[01-02 Invariant Catalog]
        B --> C[01-03 State Machine]
        C --> D[01-04 Reflog Safety]
    end
    D --> E["Chapter 02: Four-Tier Hierarchy"]
```

---

## 4. Summary & Transition

The foundational guarantees codified in Chapter 01 establish the bedrock upon which all higher-tier autonomous agents, DAG schedulers, distributed leases, and validation engines operate.

Proceed to [01-01: Zero-Assumption Philosophy](01-01-zero-assumption-philosophy.md) or advance directly to [Chapter 02: Four-Tier Workforce Hierarchy](../02-four-tier-hierarchy/index.md).

---

[Previous: Master Architecture Index](../index.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 01-01 Zero-Assumption Philosophy](01-01-zero-assumption-philosophy.md)

---
$$

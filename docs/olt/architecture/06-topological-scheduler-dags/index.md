# Chapter 06: Topological Scheduler & DAG Compilation

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > Chapter 06: Topological Scheduler & DAG Compilation

---

[⏮️ Previous: Chapter 05: Concurrency Scaling & Straggler SLA](../05-concurrency-straggler-sla/index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 06-01 DAG Compilation & Kahn's Algorithm](06-01-dag-compilation-and-kahns-algorithm.md)
---

## 1. Chapter Overview

At the heart of OLT's deterministic execution lies the **Topological Scheduler**. Software engineering tasks are inherently relational: interfaces must precede implementations, schema migrations must precede API updates, and unit tests must follow code changes.

The Topological Scheduler compiles requirements into a **Directed Acyclic Graph (DAG)** $G = (V, E)$, verifies cycle-freedom via **Tarjan's SCC Algorithm**, calculates disjoint wave barriers via **Dynamic Scope Decoupling**, and renders high-density visual ASCII graphs via the **Sugiyama Layered Layout Engine**.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             CHAPTER 06: DAG SCHEDULER TOPOLOGY                                   │
├──────────────────────────┬──────────────────────────┬────────────────────────────────────────────┤
│ Sub-Topic                │ Key Architectural Model  │ Primary Invariants Enforced                │
├──────────────────────────┼──────────────────────────┼────────────────────────────────────────────┤
│ 01. Kahn's Algorithm     │ Topological Wavefronts   │ O(|V| + |E|) Deterministic Ordering        │
│ 02. Tarjan SCC Cycles    │ Strongly Connected Comp  │ Lowlink Cycle Breaking & Feedback Arcs     │
│ 03. Scope Decoupling     │ Conflict Matrix Coloring │ Disjoint Parallel Waves (Wi ∩ Wj = ∅)      │
│ 04. Sugiyama Layout      │ 4-Phase Layered Layout   │ Barycentric Minimization & Unicode ASCII   │
└──────────────────────────┴──────────────────────────┴────────────────────────────────────────────┘
```

---

## 2. Table of Contents

1. **[06-01: DAG Compilation & Kahn's Algorithm](./06-01-dag-compilation-and-kahns-algorithm.md)**  
   _Directed Acyclic Graph compilation, in-degree queue tracking, and wavefront partitioning._
2. **[06-02: Tarjan SCC Cycle Detection](./06-02-tarjan-scc-cycle-detection.md)**  
   _Strongly Connected Components (SCC), discovery/lowlink indices, and feedback arc set breaking._
3. **[06-03: Dynamic Wave Decoupling & Scopes](./06-03-dynamic-wave-decoupling-and-scopes.md)**  
   _File scope overlap detection, conflict matrix computation, and graph vertex coloring._
4. **[06-04: Sugiyama Layered Layout Engine](./06-04-sugiyama-layered-layout-engine.md)**  
   _4-phase Sugiyama layout pipeline, crossing minimization, and high-density ASCII rendering._

---

[⏮️ Previous: Chapter 05: Concurrency Scaling & Straggler SLA](../05-concurrency-straggler-sla/index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 06-01 DAG Compilation & Kahn's Algorithm](06-01-dag-compilation-and-kahns-algorithm.md)
---

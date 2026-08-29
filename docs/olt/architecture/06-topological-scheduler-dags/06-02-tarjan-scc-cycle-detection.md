# Tarjan's SCC Cycle Detection & Contract Extraction

---

[Previous: 06-01 DAG Compilation & Kahn](06-01-dag-compilation-and-kahns-algorithm.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 06-03 Dynamic Wave Decoupling](06-03-dynamic-wave-decoupling-and-scopes.md)

---

## 1. Executive Summary & Graph Cycle Pathologies

In complex multi-agent architectures, agents decomposing interdependent tasks often introduce circular dependency deadlocks (e.g. Task A requires Task B's types, but Task B requires Task A's runtime contracts). Without cycle breaking, topological schedulers freeze indefinitely.

The OLT (Orchestrating Long Tasks) engine implements **Tarjan's Strongly Connected Components (SCC) Cycle Detection & Contract Extraction Protocol**. Under this system:

1. **Linear-Time Cycle Detection ($\mathcal{O}(|V| + |E|)$)**: Tarjan's Depth-First Search algorithm computes DFS discovery numbers $\text{dfn}(u)$ and lowlink values $\text{low}(u)$ to detect all strongly connected components ($|\text{SCC}| > 1$).
2. **Automated Minimum-Weight Cut**: When a cycle is detected, the scheduler identifies the lowest-weight edge and extracts an explicit TypeScript Interface Contract, breaking the cycle cleanly.

```text
+--------------------------------------------------------------------------------------------------+
│                             TARJAN SCC CYCLE BREAKING TOPOLOGY                                   │
+--------------------------------------------------------------------------------------------------+
│                                                                                                  │
│   CIRCULAR DEPENDENCY: Task A <═════════════════════════════════════════► Task B                 │
│                                                                                                  │
│   TARJAN DFS EVALUATION: dfn(A)=1, low(A)=1, dfn(B)=2, low(B)=1 ──► |SCC| = 2 (Cycle Detected)   │
│                                           │                                                      │
│                                           ▼                                                      │
│   CYCLE BREAKING VIA CONTRACT EXTRACTION:                                                        │
│   1. Extract Shared Type Contract: types/auth-contract.ts (Wave 1)                               │
│   2. Rewire Task A: Depends on auth-contract.ts (Wave 2)                                         │
│   3. Rewire Task B: Depends on auth-contract.ts (Wave 2)                                         │
│                                           │                                                      │
│                                           ▼                                                      │
│   RESULT: Cycle Broken into Clean Linear DAG: Contract ──► { Task A, Task B }                    │
│                                                                                                  │
+--------------------------------------------------------------------------------------------------+
```

---

## 2. Mathematical Formalization of Tarjan's Algorithm

Let $G = (V, E)$ be a directed graph.

For each vertex $u \in V$, Tarjan's algorithm maintains:

- $\text{dfn}(u)$: Depth-first search discovery timestamp.
- $\text{low}(u)$: Smallest discovery timestamp reachable from $u$ via a tree edge or back edge within the active recursion stack $S$.

### Recursive Lowlink Formulation

$$ \text{low}(u) = \min \begin{cases}
\text{dfn}(u) \\
\min_{(u, v) \in E, \; v \notin \text{visited}} \text{low}(v) \\
\min_{(u, v) \in E, \; v \in S} \text{dfn}(v)
\end{cases}$$

A vertex $u$ is the root of a Strongly Connected Component if and only if:

$$\text{low}(u) = \text{dfn}(u)$$

If $|\text{SCC}(u)| > 1$, a cyclic dependency exists.

```mermaid
flowchart TD
    StartDFS[Start DFS Traversal: assign dfn u and low u] --> PushStack[Push node u to recursion stack S]
    PushStack --> ForEachNeighbor{For each edge u -> v}

    ForEachNeighbor -->|v not visited| RecurseV[Recurse DFS v: update low u = min low u, low v]
    ForEachNeighbor -->|v in stack S| UpdateBackEdge[Update low u = min low u, dfn v]
    ForEachNeighbor -->|All neighbors evaluated| CheckRoot{Is low u == dfn u?}

    CheckRoot -->|No| ReturnDFS[Return to parent caller]
    CheckRoot -->|Yes: Component Root| PopSCC[Pop stack until node u -> Component C]

    PopSCC --> SizeCheck{Is |C| > 1 (Cycle)?}
    SizeCheck -->|Yes: Cycle Found| BreakCycle[Extract Type Contract & Break Minimum Weight Edge]
    SizeCheck -->|No: Trivial Node| ReturnDFS
    BreakCycle --> DAGCertified([Acyclic DAG Formed])
```

---

## 3. Architectural Invariants Summary

1. **Zero Deadlocks**: Graph compilation guarantees acyclicity before any worker subagent is spawned.
2. **Contract Extraction**: Cyclic ties are resolved by factoring shared interfaces into earlier waves.
3. **Deterministic Repair**: Edge cuts follow deterministic priority weights.

---

[Previous: 06-01 DAG Compilation & Kahn](06-01-dag-compilation-and-kahns-algorithm.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 06-03 Dynamic Wave Decoupling](06-03-dynamic-wave-decoupling-and-scopes.md)

---
$$

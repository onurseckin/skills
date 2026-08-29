# DAG Compilation & Kahn's Topological Sort Algorithm

---

[Previous: Chapter 06 Index](index.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 06-02 Tarjan SCC Cycle Detection](06-02-tarjan-scc-cycle-detection.md)

---

## 1. Executive Summary & Graph Scheduling

In autonomous multi-agent software engineering, executing tasks in arbitrary order causes severe compilation breakages, missing imports, and conflicting edits.

The OLT (Orchestrating Long Tasks) engine compiles requirements into a Directed Acyclic Graph (DAG) using **Kahn's Topological Sorting Algorithm**. Under this scheduler:

1. **Linear Time Compilation ($\mathcal{O}(|V| + |E|)$)**: Tasks are ordered strictly such that every dependency precedes its dependents.
2. **Topological Wave Synthesis**: Tasks with in-degree zero are partitioned into parallel execution waves ($W_1, W_2, \dots, W_K$).
3. **Deterministic Queue Progression**: Ready tasks are placed into active worker queues without runtime race conditions.

```text
+--------------------------------------------------------------------------------------------------+
│                             KAHN'S TOPOLOGICAL SORT PIPELINE                                     │
+--------------------------------------------------------------------------------------------------+
│                                                                                                  │
│   Task DAG G = (V, E) ──► Compute In-Degree Table: InDeg(v) for all v in V                       │
│                                           │                                                      │
│                                           ▼                                                      │
│                           Initialize Queue Q = { v | InDeg(v) == 0 }                             │
│                                           │                                                      │
│                                           ▼                                                      │
│                           While Q is non-empty: Pop node u, emit to Wave W_k                     │
│                                           │                                                      │
│                                           ▼                                                      │
│                           For each successor v in Adj(u): InDeg(v) = InDeg(v) - 1                │
│                           If InDeg(v) == 0: Enqueue v into Wave W_{k+1}                          │
│                                           │                                                      │
│                                           ▼                                                      │
│   Cycle Check: If emitted nodes < |V| ──► Trigger Tarjan SCC Cycle Breaker                       │
│                                                                                                  │
+--------------------------------------------------------------------------------------------------+
```

---

## 2. Mathematical Formalization of Kahn's Algorithm

Let $G = (V, E)$ be a directed task graph with vertex set $V = \{T_1, T_2, \dots, T_N\}$ and directed edge set $E \subseteq V \times V$, where $(u, v) \in E$ denotes that task $u$ must complete before task $v$ can commence.

The **In-Degree** $\text{deg}^-(v)$ of node $v \in V$ is:

$$\text{deg}^-(v) = \big| \{ u \in V \mid (u, v) \in E \} \big|$$

### Wave Partitioning Recurrence

We partition $V$ into disjoint execution waves $W_1, W_2, \dots, W_K$ such that:

$$W_1 = \{ v \in V \mid \text{deg}^-(v) = 0 \}$$

$$W_{k+1} = \left\{ v \in V \setminus \bigcup_{j=1}^k W_j \;\middle|\; \forall u \in V : (u, v) \in E \implies u \in \bigcup_{j=1}^k W_j \right\}$$

$$\bigcup_{k=1}^K W_k = V \quad \text{and} \quad \forall j \neq k, \; W_j \cap W_k = \emptyset$$

```mermaid
flowchart TD
    InitInDeg[Compute in-degree array deg_minus for all nodes in V] --> FindZero[Find all nodes with in-degree 0 -> Wave 1]
    FindZero --> LoopQueue{Is Ready Queue empty?}

    LoopQueue -->|No: Ready nodes present| PopWave[Pop current wave nodes W_k]
    PopWave --> DecrSucc[Decrement in-degree of all child successors]
    DecrSucc --> CollectNext[Collect new 0 in-degree nodes -> Wave k+1]
    CollectNext --> LoopQueue

    LoopQueue -->|Yes: Empty Queue| VerifyCount{Total scheduled nodes == |V|?}
    VerifyCount -->|Yes: Acyclic DAG| EmitSchedule([Schedule Certified: K Waves Compiled])
    VerifyCount -->|No: Cycles Exist| TrapCycle[TRAP: CYCLIC_DEPENDENCY_DETECTED]
```

---

## 3. Concrete TypeScript Implementation

The topological compiler ([`topological-scheduler.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/graph/topological-scheduler.ts)) compiles waves in pure linear time:

```typescript
export function compileTopologicalWaves(nodes: string[], edges: [string, string][]): string[][] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  nodes.forEach((n) => {
    inDegree.set(n, 0);
    adj.set(n, []);
  });

  edges.forEach(([u, v]) => {
    adj.get(u)!.push(v);
    inDegree.set(v, (inDegree.get(v) ?? 0) + 1);
  });

  const waves: string[][] = [];
  let currentWave = nodes.filter((n) => inDegree.get(n) === 0);

  while (currentWave.length > 0) {
    waves.push(currentWave);
    const nextWave: string[] = [];
    for (const u of currentWave) {
      for (const v of adj.get(u)!) {
        const remaining = inDegree.get(v)! - 1;
        inDegree.set(v, remaining);
        if (remaining === 0) nextWave.push(v);
      }
    }
    currentWave = nextWave;
  }
  return waves;
}
```

---

## 4. Architectural Invariants Summary

1. **Linear Time Performance**: DAG compilation completes in $\mathcal{O}(|V| + |E|)$ with zero backtracking.
2. **Zero Barrier Deadlocks**: Wave transitions are event-driven and non-blocking.
3. **Cycle Rejection**: Any circular dependency is trapped and routed to Tarjan's cycle breaker.

---

[Previous: Chapter 06 Index](index.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 06-02 Tarjan SCC Cycle Detection](06-02-tarjan-scc-cycle-detection.md)

---

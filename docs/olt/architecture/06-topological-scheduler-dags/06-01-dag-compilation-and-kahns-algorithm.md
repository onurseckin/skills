# DAG Compilation & Kahn's Topological Algorithm

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 06](./index.md) > 06-01 Kahn's Algorithm

---

[⏮️ Previous: Chapter 06: Topological Scheduler & DAGs Overview](index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 06-02 Tarjan SCC Cycle Detection](06-02-tarjan-scc-cycle-detection.md)
---

## 1. Graph Compilation from Requirements

The preplanning factory transforms requirements into an execution DAG $G = (V, E)$ where:

- $V = \{T_1, T_2, \dots, T_n\}$ is the set of atomic implementation tasks.
- $E \subseteq V \times V$ is the set of directed precedence edges ($(u, v) \in E \implies u \prec v$).

```text
                        TOPOLOGICAL WAVE COMPILATION
  W0 (In-degree = 0):    [Task 1: Schema]      [Task 2: Types]
                                \                /
  W1 (In-degree = 0):           [Task 3: Auth Core]
                                  /            \
  W2 (In-degree = 0):   [Task 4: Routes]    [Task 5: Tests]
```

---

## 2. Kahn's Wavefront Algorithm ($\mathcal{O}(|V| + |E|)$)

OLT partitions $V$ into sequential execution waves $W_0, W_1, \dots, W_k$ using Kahn's algorithm:

```typescript
export function compileWavefronts(dag: DAG): Task[][] {
  const inDegree = new Map<string, number>();
  dag.nodes.forEach((n) => inDegree.set(n.id, 0));
  dag.edges.forEach((e) => inDegree.set(e.target, inDegree.get(e.target)! + 1));

  const waves: Task[][] = [];
  let currentWave = dag.nodes.filter((n) => inDegree.get(n.id) === 0);

  while (currentWave.length > 0) {
    waves.push(currentWave);
    const nextWave: Task[] = [];
    for (const node of currentWave) {
      for (const edge of dag.getOutgoingEdges(node.id)) {
        const d = inDegree.get(edge.target)! - 1;
        inDegree.set(edge.target, d);
        if (d === 0) nextWave.push(dag.getNode(edge.target));
      }
    }
    currentWave = nextWave;
  }
  return waves;
}
```

---

[⏮️ Previous: Chapter 06: Topological Scheduler & DAGs Overview](index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 06-02 Tarjan SCC Cycle Detection](06-02-tarjan-scc-cycle-detection.md)
---

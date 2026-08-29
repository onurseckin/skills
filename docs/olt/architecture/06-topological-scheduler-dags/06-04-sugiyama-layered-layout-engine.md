# Sugiyama Layered Layout Engine & Terminal ASCII Rendering

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 06](./index.md) > 06-04 Sugiyama Layout Engine

---

[⏮️ Previous: 06-03 Dynamic Wave Decoupling & Scopes](06-03-dynamic-wave-decoupling-and-scopes.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: Chapter 07: Distributed Leasing & Execution](../07-distributed-leasing-execution/index.md)
---

## 1. The 4-Phase Sugiyama Pipeline

To render complex execution DAGs directly in terminal logs and CLI status outputs, OLT implements the classic **4-Phase Sugiyama Layered Graph Layout**:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                      4-PHASE SUGIYAMA LAYOUT PIPELINE                       │
├──────────────────────────┬──────────────────────────────────────────────────┤
│ Phase 1: Layer Assign    │ Longest-path ranking / Coffman-Graham layering.  │
│ Phase 2: Crossing Min    │ Barycentric heuristic iterative sweep.           │
│ Phase 3: Coordinate Calc │ Horizontal X-coordinate assignment & balancing.  │
│ Phase 4: ASCII / Unicode │ Orthogonal edge routing & box card rendering.    │
└──────────────────────────┴──────────────────────────────────────────────────┘
```

---

## 2. Barycentric Crossing Minimization

For each layer $L_k$, the horizontal position of vertex $v$ is computed as the average position of its neighbors in layer $L_{k-1}$:

$$\text{Barycenter}(v) = \frac{1}{|\text{Pred}(v)|} \sum_{u \in \text{Pred}(v)} \text{X-Pos}(u)$$

Sorting vertices by their barycentric value iteratively eliminates visual edge crossings.

---

## 3. High-Density Terminal ASCII Output

```text
  ┌───────────────────────┐         ┌───────────────────────┐
  │ Task 1: Auth Schema   │         │ Task 2: Token Types   │
  │ Scope: src/auth/db    │         │ Scope: src/types      │
  └───────────┬───────────┘         └───────────┬───────────┘
              │                                 │
              └───────────────┬─────────────────┘
                              ▼
                  ┌───────────────────────┐
                  │ Task 3: Token Signer  │
                  │ Scope: src/auth/sign  │
                  └───────────────────────┘
```

---

[⏮️ Previous: 06-03 Dynamic Wave Decoupling & Scopes](06-03-dynamic-wave-decoupling-and-scopes.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: Chapter 07: Distributed Leasing & Execution](../07-distributed-leasing-execution/index.md)
---

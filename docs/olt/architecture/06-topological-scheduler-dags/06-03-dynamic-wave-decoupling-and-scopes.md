# Dynamic Wave Decoupling & Scope Overlap Matrices

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 06](./index.md) > 06-03 Dynamic Wave Decoupling

---

[⏮️ Previous: 06-02 Tarjan SCC Cycle Detection](06-02-tarjan-scc-cycle-detection.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 06-04 Sugiyama Layered Layout Engine](06-04-sugiyama-layered-layout-engine.md)
---

## 1. Filesystem Write Scope Conflicts

Even if two tasks $T_a$ and $T_b$ have no logical precedence dependency ($T_a \not\prec T_b \land T_b \not\prec T_a$), they **cannot run concurrently if their write scopes overlap**:

$$\text{ScopeOverlap}(T_a, T_b) \iff \text{Scope}(T_a) \cap \text{Scope}(T_b) \neq \emptyset$$

\`\`\`text
SCOPE CONFLICT MATRIX
Task 1 (auth/) Task 2 (auth/) Task 3 (db/) Task 4 (ui/)
Task 1 --- CONFLICT OK OK
Task 2 CONFLICT --- OK OK
Task 3 OK OK --- OK
Task 4 OK OK OK ---
\`\`\`

---

## 2. Conflict Graph Vertex Coloring

To execute maximum parallel work without file write collisions, OLT builds a **Scope Conflict Graph** $G_c = (V, E_c)$ and applies graph vertex coloring:

- Nodes $V$ are tasks in the same topological tier.
- Edges $E_c$ connect tasks with overlapping write scopes.
- Colors $C_0, C_1, \dots$ represent disjoint parallel execution waves:

$$\forall (u, v) \in E_c, \quad \text{Color}(u) \neq \text{Color}(v)$$

---

[⏮️ Previous: 06-02 Tarjan SCC Cycle Detection](06-02-tarjan-scc-cycle-detection.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 06-04 Sugiyama Layered Layout Engine](06-04-sugiyama-layered-layout-engine.md)
---

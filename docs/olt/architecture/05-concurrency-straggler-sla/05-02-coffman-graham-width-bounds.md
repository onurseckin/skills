# Coffman-Graham Width Bounds & Level Assignment

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 05](./index.md) > 05-02 Coffman-Graham Width Bounds

---

[⏮️ Previous: 05-01 Brent Work-Span Theorem](05-01-brent-work-span-theorem.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 05-03 Five-Minute Straggler SLA Rule](05-03-five-minute-straggler-sla-rule.md)
---

## 1. Processor-Constrained Precedence Scheduling

When the optimal concurrency $P_{\text{opt}}$ exceeds available host execution capacity $P_{\text{host}}$, the scheduler must partition tasks into discrete topological levels without violating precedence constraints.

The **Coffman-Graham Algorithm** provides an optimal two-processor scheduling sequence and a high-performance heuristic for general $P$-processor bounds.

```text
                     COFFMAN-GRAHAM LEVEL ASSIGNMENT
  Level 3: [Task 4] (Label: 5)
             ▲
  Level 2: [Task 2] (Label: 3)    [Task 3] (Label: 4)
             ▲                      ▲
  Level 1: [Task 1] (Label: 1) ───┘
```

---

## 2. Lexicographical Label Assignment Algorithm

1. Assign label $1$ to an unlabelled task with in-degree $0$.
2. For each subsequent task $v$, let $L(v)$ be the descending sorted set of labels of all its immediate predecessors.
3. Choose the unlabelled task whose predecessor label set $L(v)$ is lexicographically smallest, and assign the next sequential integer label.
4. Schedule tasks into execution slots in reverse order of assigned labels.

---

## 3. Wave Width Bounding

Using Coffman-Graham level assignments, OLT guarantees that no execution wave $W_k$ exceeds the maximum width bound:

$$\text{Width}(W_k) \le P_{\text{effective}} = \min(P_{\text{host}}, P_{\text{quota}}, 40)$$

---

[⏮️ Previous: 05-01 Brent Work-Span Theorem](05-01-brent-work-span-theorem.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 05-03 Five-Minute Straggler SLA Rule](05-03-five-minute-straggler-sla-rule.md)
---

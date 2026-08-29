# Dynamic Load Throttling & Backpressure Control

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 05](./index.md) > 05-04 Dynamic Load Throttling

---

[⏮️ Previous: 05-03 Five-Minute Straggler SLA Rule](05-03-five-minute-straggler-sla-rule.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: Chapter 06: Topological Scheduler & DAGs](../06-topological-scheduler-dags/index.md)
---

## 1. LLM Rate Limit Avoidance (TPM / RPM)

High-concurrency agent swarms easily trigger upstream API rate limits (Tokens Per Minute - TPM, Requests Per Minute - RPM). When an agent receives an HTTP 429 / Rate Limit error, naive retry loops cause cascading stampedes.

OLT implements a **Token Bucket Backpressure Governor**:

$$\text{TokensAvailable}(t) = \min\left(\text{Capacity}, \text{TokensAvailable}(t - \Delta t) + r \cdot \Delta t\right)$$

```text
                       DYNAMIC BACKPRESSURE CONTROLLER
  Wave Dispatcher Queue ──────► [Token Bucket Governor] ──────► Host API
                                         ▲
                                         │ Feedback Loop (HTTP 429 / Latency)
                                [Adaptive Throttler]
```

---

## 2. Cowan Chunk Budgeting (150k Token Envelope)

To prevent attention degradation and out-of-memory crashes, OLT limits each agent context window to **150,000 tokens** (Cowan's cognitive budget).

If prompt context exceeds 150k tokens:

1. Historical tool execution logs are truncated to summary receipts.
2. AST query slices replace full source code inclusions.
3. Reference documentation is injected on-demand via vector search.

---

[⏮️ Previous: 05-03 Five-Minute Straggler SLA Rule](05-03-five-minute-straggler-sla-rule.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: Chapter 06: Topological Scheduler & DAGs](../06-topological-scheduler-dags/index.md)
---

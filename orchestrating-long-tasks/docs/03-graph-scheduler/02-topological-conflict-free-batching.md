# 02. Topological Conflict-Free Batch Scheduling

[⬅ Previous: Dependency Graph Theory](./01-dependency-graph-theory.md) | [Master Table of Contents](../README.md) | [Next: Plan Revision & Freezing ➡](./03-plan-revision-and-freezing.md)

---

## ⚡ The Challenge of Multi-Agent Concurrency

When an AI system dispatches multiple coding agents in parallel, chaos easily ensues if two agents attempt to edit the same file or overlapping directory trees at the same time:

- Agent 1 writes `src/auth/session.ts`.
- Agent 2 writes `src/auth/index.ts`.
- Filesystem race conditions cause torn reads, clobbered functions, and broken imports.

The `orchestrating-long-tasks` scheduler solves this through **Topological Conflict-Free Batch Scheduling** via `queue:next`, `queue:list`, and `queue:pop`.

---

## 🧮 The 5-Step Scheduling Algorithm

When the coordinator inspects `queue:next` or invokes `queue:pop`, the scheduler executes a 5-step deterministic algorithm:

```text
[ Graph in state.json ]
          │
          ▼
1. Filter Ready Candidates (All prerequisites are 'done' & no un-granted authority)
          │
          ▼
2. 6-Factor Deterministic Priority Ranking (P1 -> P2 -> P3 -> P4 -> P5 -> P6)
          │
          ▼
3. Conflict-Free Write Scope Filter (Greedy packing without path collisions)
          │
          ▼
4. Concurrency Limit Clamp (Batch size <= max-parallel)
          │
          ▼
[ Return Dispatch Batch & Atomically Lease Tasks to Agents ]
```

---

## 🥇 Step 2: The 6-Factor Deterministic Ranking Formula

Candidate tasks that are unblocked are sorted using a multi-dimensional comparator. If two tasks tie on the first factor, the engine evaluates the next factor:

| Rank Factor  | Property Evaluated     | Sort Direction                         | Rationale                                                              |
| :----------- | :--------------------- | :------------------------------------- | :--------------------------------------------------------------------- |
| **Factor 1** | `priority`             | **Descending** (Highest first)         | Explicit business/architectural importance set in plan.                |
| **Factor 2** | `critical_depth`       | **Descending** (Longest path first)    | Longest dependency chain downstream; unblocks the most future work.    |
| **Factor 3** | `distinct_descendants` | **Descending** (Most dependents first) | Number of unique downstream tasks waiting on this result.              |
| **Factor 4** | `created_order`        | **Ascending** (Oldest first)           | First-in, first-out fairness based on plan authoring order.            |
| **Factor 5** | `effort`               | **Ascending** (Smallest first)         | Shortest job first (SJF) optimization to quickly clear bandwidth.      |
| **Factor 6** | `id`                   | **Ascending** (ASCII alphabetical)     | Total deterministic tie-breaker (eliminates nondeterministic sorting). |

---

## 🛡️ Step 3: Write-Scope Collision Detection

The scheduler evaluates the `write_scope` of each candidate against already-selected tasks in the batch. Two write scopes conflict if:

1. **Exact Match:** Task A has `write_scope: ["src/auth"]` and Task B has `write_scope: ["src/auth"]`.
2. **Ancestor / Descendant Collision:** Task A has `write_scope: ["src"]` and Task B has `write_scope: ["src/auth"]` (Ancestor contains descendant).

### Worked Example:

Suppose we have 4 ready tasks and `default_max_parallel: 3`:

- **Task 1:** Priority 100, `write_scope: ["src/auth"]`
- **Task 2:** Priority 95, `write_scope: ["src/auth/session"]` _(Conflicts with Task 1!)_
- **Task 3:** Priority 90, `write_scope: ["src/database"]` _(Disjoint)_
- **Task 4:** Priority 85, `write_scope: ["src/api"]` _(Disjoint)_

**Resulting Dispatch:**

1. **Task 1** is leased via `queue:pop` / `task:claim` (Highest priority).
2. **Task 2** is **held back** (Write scope `src/auth/session` is a descendant of `src/auth`).
3. **Task 3** is leased (Disjoint from Task 1).
4. **Task 4** is leased (Disjoint from Tasks 1 and 3).

**Dispatched Batch:** `[Task 1, Task 3, Task 4]`.
Task 2 remains queued safely until Task 1 completes and releases its write lease!

---

[⬅ Previous: Dependency Graph Theory](./01-dependency-graph-theory.md) | [Master Table of Contents](../README.md) | [Next: Plan Revision & Freezing ➡](./03-plan-revision-and-freezing.md)

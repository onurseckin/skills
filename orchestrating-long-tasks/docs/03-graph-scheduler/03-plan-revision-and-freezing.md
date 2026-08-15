# 03. Plan Revision & Immutability Rules

[⬅ Previous: Topological Conflict-Free Batching](./02-topological-conflict-free-batching.md) | [Master Table of Contents](../README.md) | [Next: Chapter 04 — Host-Agnostic Architecture ➡](../04-multi-agent/01-host-agnostic-architecture.md)

---

## ❄️ The Structural Freeze Invariant

Once a plan has been applied to a run (`plan-apply`) and execution begins, the harness imposes strict immutability boundaries on the task graph:

> **Structural task contracts, write scopes, produced artifacts, and prerequisite dependencies freeze permanently during active execution.**

Why is this necessary?

- If an agent could rewrite its own task dependencies midway through execution, it could skip prerequisites.
- If an agent could alter its write scope, it would invalidate the scheduler's concurrency guarantees and overwrite parallel workers.

---

## 📈 Plan Revisions ($0 \to 1 \to 2$)

When an unexpected architectural requirement emerges during execution, the coordinator can apply an explicit **Plan Revision** (`plan-apply --expected-revision <N>`).

A plan revision must obey strict versioning rules:

1. **Monotonic Increment:** The revision number must increase by exactly one ($0 \to 1 \to 2$).
2. **Immutable Source Requirements:** The original prompt requirements cannot be deleted or re-scoped.
3. **Preservation of History:** All completed tasks (`done`), satisfied requirements, gate receipts, and findings history are preserved across revisions.
4. **Historical Archiving:** The exact prior `requirements.json` and `graph.json` documents are archived permanently in the event chain.

---

## 📊 What Freezes vs. What Evolves

| Property                 | Behavior During Execution / Revision | Rationale                                                                   |
| :----------------------- | :----------------------------------- | :-------------------------------------------------------------------------- |
| **`prompt.md`**          | **100% Immutable (Frozen)**          | Cryptographically bound to manifest SHA-256.                                |
| **Done Task Contracts**  | **Frozen**                           | Completed work cannot be mutated or downgraded.                             |
| **Active Leased Scopes** | **Frozen**                           | Cannot expand or contract write leases while an agent holds them.           |
| **Task Status**          | **Evolves Dynamically**              | Managed by the harness state machine (`ready` $\to$ `leased` $\to$ `done`). |
| **Finding Records**      | **Appended Immutably**               | Findings are opened and resolved via command receipts.                      |
| **Gate Receipts**        | **Appended Immutably**               | Successful gate executions attach permanently.                              |
| **New Tasks / Edges**    | **Added via Revision**               | New downstream tasks can be introduced in Revision $N+1$.                   |

---

[⬅ Previous: Topological Conflict-Free Batching](./02-topological-conflict-free-batching.md) | [Master Table of Contents](../README.md) | [Next: Chapter 04 — Host-Agnostic Architecture ➡](../04-multi-agent/01-host-agnostic-architecture.md)

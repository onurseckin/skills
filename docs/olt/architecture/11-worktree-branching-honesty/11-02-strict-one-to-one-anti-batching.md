# Strict One-to-One Anti-Batching Leases

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 11](./index.md) > 11-02 Strict Anti-Batching

---

[⏮️ Previous: 11-01 Out-of-Repo Git Worktree Isolation](11-01-out-of-repo-git-worktree-isolation.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 11-03 Honesty Verification Gates](11-03-honesty-gates-and-anti-fabrication.md)
---

## 1. The Anti-Batching Invariant

A critical anti-pattern in agent swarms is **Task Batching**: an agent leases Task 1, but secretly implements Task 2 and Task 3 in the same pass. This causes:

- Hidden dependency leaks.
- Context window exhaustion.
- Impossible rollback granularity.

OLT enforces the **Strict 1:1 Lease Invariant**:

$$\forall a \in \text{Agents}, \quad |\text{ActiveTasks}(a)| \le 1$$

$$\text{ModifiedFiles}(a) \subseteq \text{GrantedScope}(T_{\text{active}}(a))$$

---

[⏮️ Previous: 11-01 Out-of-Repo Git Worktree Isolation](11-01-out-of-repo-git-worktree-isolation.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 11-03 Honesty Verification Gates](11-03-honesty-gates-and-anti-fabrication.md)
---

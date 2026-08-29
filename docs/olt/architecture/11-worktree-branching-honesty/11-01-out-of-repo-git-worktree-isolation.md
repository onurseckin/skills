# Out-of-Repo Git Worktree Isolation

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 11](./index.md) > 11-01 Worktree Isolation

---

[⏮️ Previous: Chapter 11: Worktree Branching & Honesty Gates Overview](index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 11-02 Strict 1:1 Anti-Batching Leases](11-02-strict-one-to-one-anti-batching.md)
---

## 1. Physical Workspace Isolation

When an implementer claims a task, OLT provisions an ephemeral git worktree located outside the main repository root:

```bash
git worktree add -b task-101-work .olt/worktrees/task-101 HEAD
```

```text
                        WORKTREE ISOLATION TOPOLOGY
  Main Repository Root (/app)
   └── .git/
        └── worktrees/
             ├── task-101/ ──► Working Tree: .olt/worktrees/task-101 (Worker A)
             └── task-102/ ──► Working Tree: .olt/worktrees/task-102 (Worker B)
```

Workers execute and stage code in their isolated worktrees. Upon validation pass, the coordinator executes a clean, fast-forward merge into the main branch.

---

[⏮️ Previous: Chapter 11: Worktree Branching & Honesty Gates Overview](index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 11-02 Strict 1:1 Anti-Batching Leases](11-02-strict-one-to-one-anti-batching.md)
---

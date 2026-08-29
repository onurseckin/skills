# Chapter 11: Worktree Branching Isolation & Honesty Gates

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > Chapter 11: Worktree Branching Isolation & Honesty Gates

---

[⏮️ Previous: Chapter 10: Durability, Recovery & Merkle Chains](../10-durability-recovery-capsules/index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 11-01 Out-of-Repo Git Worktree Isolation](11-01-out-of-repo-git-worktree-isolation.md)
---

## 1. Chapter Overview

Parallel coding agents operating on the same repository directory inevitably overwrite each other's files, corrupt git index staging, and cause merge conflicts.

OLT eliminates write collisions through **Out-of-Repo Git Worktrees**, **Strict 1:1 Anti-Batching Leases**, **Honesty Verification Gates**, and the **Dynamic Agent Grant Ledger**.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                           CHAPTER 11: WORKTREE & HONESTY TOPOLOGY                                │
├──────────────────────────┬──────────────────────────┬────────────────────────────────────────────┤
│ Sub-Topic                │ Key Architectural Model  │ Primary Invariants Enforced                │
├──────────────────────────┼──────────────────────────┼────────────────────────────────────────────┤
│ 01. Worktree Isolation   │ Ephemeral Out-of-Repo    │ Physical Directory Isolation per Worker    │
│ 02. 1:1 Anti-Batching    │ 1 Agent to 1 Task Lease  │ Zero Multi-Task Batching & Context Bleed   │
│ 03. Honesty Gates        │ Anti-Fabrication Engine  │ Penalty Models & Ban on Simulated Proofs   │
│ 04. Grant Ledger         │ Dynamic RBAC Elevation   │ Audited Permission Revocation & Scopes     │
└──────────────────────────┴──────────────────────────┴────────────────────────────────────────────┘
```

---

## 2. Table of Contents

1. **[11-01: Out-of-Repo Git Worktree Isolation](./11-01-out-of-repo-git-worktree-isolation.md)**  
   _Ephemeral git worktrees under `.olt/worktrees/<task_id>/`, conflict avoidance, clean merge-back._
2. **[11-02: Strict One-to-One Anti-Batching](./11-02-strict-one-to-one-anti-batching.md)**  
   _Strict 1-agent to 1-task lease invariant, eliminating hidden dependencies and context bleed._
3. **[11-03: Honesty Gates & Anti-Fabrication](./11-03-honesty-gates-and-anti-fabrication.md)**  
   _Honesty verification gates, rejection of unverified passes, penalty models for fabrication._
4. **[11-04: Agent Grant Ledger & Authority Locks](./11-04-agent-grant-ledger-and-authority-locks.md)**  
   _Dynamic Agent Grant Ledger, capability elevation protocol, audited permission revocation._

---

[⏮️ Previous: Chapter 10: Durability, Recovery & Merkle Chains](../10-durability-recovery-capsules/index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 11-01 Out-of-Repo Git Worktree Isolation](11-01-out-of-repo-git-worktree-isolation.md)
---

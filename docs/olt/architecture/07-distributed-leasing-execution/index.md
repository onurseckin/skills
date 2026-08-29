# Chapter 07: Distributed Leasing & Task Execution

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > Chapter 07: Distributed Leasing & Task Execution

---

[⏮️ Previous: Chapter 06: Topological Scheduler & DAGs](../06-topological-scheduler-dags/index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 07-01 Monotonic Lease Protocol & Tokens](07-01-monotonic-lease-protocol-and-tokens.md)
---

## 1. Chapter Overview

Autonomous multi-agent swarms require robust distributed mutual exclusion. When dozens of agents execute concurrently across independent git worktrees or background processes, task claims must be atomic, idempotent, and theft-proof.

OLT implements a **Distributed Task Leasing Protocol** combining **Monotonic Lease Tokens**, **Advisory Flock Heartbeats**, **Zombie Auto-Recovery**, and **Cowan Token Budgeting**.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                           CHAPTER 07: TASK LEASING TOPOLOGY                                      │
├──────────────────────────┬──────────────────────────┬────────────────────────────────────────────┤
│ Sub-Topic                │ Key Architectural Model  │ Primary Invariants Enforced                │
├──────────────────────────┼──────────────────────────┼────────────────────────────────────────────┤
│ 01. Monotonic Leases     │ HMAC Token Protocol      │ Atomic task:claim & Strict Bearer Check    │
│ 02. Heartbeats & Anti-Th │ TTL Expiration Watchdog  │ 30s Heartbeat, 90s TTL, Fencing Locks      │
│ 03. Zombie Auto-Recovery │ Watchdog State Reaper    │ Dead Worker Lease Revoke & retry_ready     │
│ 04. Cowan Token Budget   │ 150k Cognitive Envelope  │ Prompt Sanitization & Injection Sandbox    │
└──────────────────────────┴──────────────────────────┴────────────────────────────────────────────┘
```

---

## 2. Table of Contents

1. **[07-01: Monotonic Lease Protocol & Tokens](./07-01-monotonic-lease-protocol-and-tokens.md)**  
   _Task claim mechanics, monotonic HMAC lease tokens, and ownership verification._
2. **[07-02: Heartbeats & Anti-Theft Locking](./07-02-heartbeats-and-anti-theft-locking.md)**  
   _Heartbeat refresh intervals ($T_{\text{hb}} = 30\text{s}$), lease TTL, and anti-theft fencing._
3. **[07-03: Stale Worker & Zombie Auto-Recovery](./07-03-stale-worker-and-zombie-auto-recovery.md)**  
   _Watchdog manager, dead worker lease revocation, and automated `retry_ready` transitions._
4. **[07-04: Cowan Token Budgeting & Sanitization](./07-04-cowan-token-budgeting-and-sanitization.md)**  
   _Cowan 150k token limits, prompt context sanitization, and prompt injection defenses._

---

[⏮️ Previous: Chapter 06: Topological Scheduler & DAGs](../06-topological-scheduler-dags/index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 07-01 Monotonic Lease Protocol & Tokens](07-01-monotonic-lease-protocol-and-tokens.md)
---

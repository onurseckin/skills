# OLT Health, Diagnostics & Status Guide

---

[⏮️ Previous: Quickstart](quickstart.md) | [📂 Reference Index](index.md) | [📚 All Chapters Index](../architecture/index.md) | [⏭️ Next: Reference Index](index.md)
---

Welcome to the **OLT Health, Diagnostics & Status Guide**. This reference manual provides operator instructions for monitoring system health, evaluating doctor engines, and diagnosing runtime issues.

---

## 🩺 System Preflight & Doctor Engines

Run doctor engines before launching critical runs or when diagnosing environment failures:

```bash
# Comprehensive environment preflight check (Node/Bun, Git, POSIX flock)
bun harness.ts doctor:env

# Deep filesystem and repository integrity diagnostic
bun harness.ts doctor:system

# Verify capsule Merkle event chain and lock health
bun harness.ts doctor:capsule --run <run-id>

# Run policy permission health and RBAC drift verification
bun harness.ts doctor:policy
```

---

## 📊 Live Status & Inspection Commands

```bash
# View active run state, wave progress, and task leases
bun harness.ts run:status --run <run-id>

# Inspect topological DAG in ASCII and view in-degree dependencies
bun harness.ts graph:dag --run <run-id>

# Inspect active task write scope and modified files
bun harness.ts inspection:scope --run <run-id> --task <task-id>

# View Merkle event audit trail
bun harness.ts inspection:log --run <run-id>

# Check Mind supervisor autonomous loop state and quota status
bun harness.ts mind:status --run <run-id>
```

---

## 🛠️ Crash Recovery & Self-Healing

When an unhandled crash or network interruption occurs:

```bash
# Reclaim expired leases and dead worker tasks
bun harness.ts run:recover --run <run-id>

# Repair torn event log tail and reconstruct projection state from zero
bun harness.ts doctor:repair --run <run-id>
```

---

## 🧭 Related Architecture Chapters

- For Merkle chains, flock locks, and torn-tail repair: [Chapter 10: Durability, Recovery & Merkle Chains](../architecture/10-durability-recovery-capsules/index.md)
- For the complete error code dictionary: [Chapter 16: Error Catalog & Empirical Blunders](../architecture/16-error-catalog-and-blunders/index.md)
- For verification engine specifications: [Chapter 17: Verification Engines & Gate Provers](../architecture/17-verification-engines-and-gates/index.md)

---

[⏮️ Previous: Quickstart](quickstart.md) | [📂 Reference Index](index.md) | [📚 All Chapters Index](../architecture/index.md) | [⏭️ Next: Reference Index](index.md)
---

# POSIX Flock Advisory Locking & Deadlock Prevention

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 10](./index.md) > 10-03 POSIX Flock Locking

---

[⏮️ Previous: 10-02 SHA-256 Merkle Event Chains](10-02-sha256-merkle-event-chains.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 10-04 Projection-Patch State Reconstruction](10-04-projection-patch-state-reconstruction.md)
---

## 1. Kernel Advisory Locking Mechanics

To coordinate concurrent subagents across different OS processes without database daemons, OLT relies on **POSIX `flock` Advisory Locks**:

```typescript
import { openSync, closeSync } from "node:fs";
// POSIX flock wrapper
const fd = openSync(".olt/capsules/<slug>/locks/capsule.lock", "w");
// Acquire exclusive lock with 5000ms timeout
```

If the lock cannot be acquired within 5000ms, the process terminates immediately with **Exit Code 4 (`LOCK_TIMEOUT`)**, preventing deadlock.

---

[⏮️ Previous: 10-02 SHA-256 Merkle Event Chains](10-02-sha256-merkle-event-chains.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 10-04 Projection-Patch State Reconstruction](10-04-projection-patch-state-reconstruction.md)
---

# Projection Patch State Reconstruction & Torn-Tail Healing

---

[Previous: 10-03 POSIX Flock Advisory Locking](10-03-posix-flock-advisory-locking.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: Chapter 11 Index](../11-worktree-branching-honesty/index.md)
---

## 1. Executive Summary & The Dual-Storage Architecture

In event-sourced architectures, maintaining both an append-only event stream (`events.jsonl`) and a materialized state snapshot (`state.json`) introduces a dual-storage synchronization challenge:

- If a server crashes while writing `state.json`, the snapshot becomes corrupted or incomplete.
- If a process dies mid-write to `events.jsonl`, a partial line ("torn tail") is left at the end of the file.

The **OLT (Orchestrating Long Tasks)** engine implements **Projection Patch State Reconstruction & Torn-Tail Auto-Healing**. Under this model:

1. **Events as Ground Truth**: `events.jsonl` is the canonical authority. `state.json` is strictly an indexed, recomputable projection cache.
2. **Deterministic State Replay**: If `state.json` is missing or out of sync, the engine folds `events.jsonl` sequentially from genesis, reconstructing the exact state in $\mathcal{O}(N)$ time.
3. **Torn-Tail Auto-Healing**: Corrupted trailing bytes caused by sudden power loss are automatically detected, truncated to the last valid Merkle event boundary, and healed seamlessly.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               STATE RECONSTRUCTION & FOLD PIPELINE                               │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│   events.jsonl (Append-Only)                                                                     │
│   ├── Event 1: { seq: 1, type: "init" }           ──►  State S_1                                 │
│   ├── Event 2: { seq: 2, type: "plan:compiled" }  ──►  State S_2 = Fold(S_1, e_2)               │
│   ├── Event 3: { seq: 3, type: "task:claimed" }   ──►  State S_3 = Fold(S_2, e_3)               │
│   └── Event 4: { seq: 4, type: "task:validated" } ──►  State S_4 = Fold(S_3, e_4)               │
│                                                              │                                   │
│                                                              ▼                                   │
│                                                   Materialized state.json                        │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Mathematical Specification of the Pure Projection Fold

Let $\mathcal{S}$ denote the state space and $\mathcal{E}$ denote the set of valid event records.

Let $\mathcal{P}: \mathcal{S} \times \mathcal{E} \rightarrow \mathcal{S}$ be the **Pure Projection Function**:

$$\mathcal{P}(S_{k-1}, e_k) = S_k$$

Given initial genesis state $S_0$ derived from `manifest.json` and event stream $\mathbf{E} = \langle e_1, e_2, \dots, e_N \rangle$:

$$S_N = \text{FoldLeft}\big(\mathcal{P}, \; S_0, \; \mathbf{E}\big) = \mathcal{P}\Big( \dots \mathcal{P}(\mathcal{P}(S_0, e_1), e_2) \dots, e_N \Big)$$

```mermaid
flowchart TD
    ReadManifest[Read manifest.json: derive S_0] --> OpenLedger[Open events.jsonl stream]
    OpenLedger --> ReadNext{Read next line e_k}

    ReadNext -->|Line Valid| ValidateHash{Hash Valid: SHA256 h_prev || e_k == hash_k?}
    ValidateHash -->|Yes: Hash Matches| ApplyFold[Compute S_k = P S_prev, e_k]
    ApplyFold --> ReadNext

    ValidateHash -->|No: Torn Tail Detected| TruncateTorn[Truncate events.jsonl to last valid offset]
    ReadNext -->|EOF Reached| WriteSnapshot[Write Materialized Snapshot to state.json]
    TruncateTorn --> WriteSnapshot
    WriteSnapshot --> Reconstructed([State Projection Fully Synchronized])
```

---

## 3. The Torn-Tail Auto-Healing Algorithm

When an abnormal termination leaves a partial line at the end of `events.jsonl` ([`state-reconstruction.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/engine/store/state-reconstruction.ts)):

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               TORN-TAIL AUTO-HEALING ALGORITHM                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│   1. Open events.jsonl with read/write access.                                                   │
│   2. Track byte offset `lastValidOffset = 0` and `lastValidHash = h_0`.                          │
│   3. Stream lines:                                                                               │
│      a. Try JSON.parse(line). If parse fails -> BREAK to Step 4.                                 │
│      b. Verify Merkle hash chaining. If hash mismatch -> BREAK to Step 4.                        │
│      c. Update lastValidOffset = currentStreamOffset, lastValidHash = line.hash.                 │
│   4. If loop exited before clean EOF (Torn Tail Detected):                                       │
│      a. Execute `ftruncate(fd, lastValidOffset)`.                                                │
│      b. Emit TORN_TAIL_HEALED telemetry record with bytes_pruned = fileSize - lastValidOffset.   │
│   5. Re-fold valid events into state.json.                                                       │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. State Patch Projection Architecture

For high-frequency telemetry updates, OLT applies incremental in-memory patches rather than full file rewrites:

```typescript
export function applyEventPatch(currentState: CapsuleState, event: CapsuleEvent): CapsuleState {
  switch (event.type) {
    case "task:claimed":
      return {
        ...currentState,
        tasks: {
          ...currentState.tasks,
          [event.payload.taskId]: {
            ...currentState.tasks[event.payload.taskId],
            status: "LEASED",
            holder: event.actor,
          },
        },
      };
    case "task:validated":
      return {
        ...currentState,
        tasks: {
          ...currentState.tasks,
          [event.payload.taskId]: {
            ...currentState.tasks[event.payload.taskId],
            status: "COMPLETED",
          },
        },
      };
    default:
      return currentState;
  }
}
```

---

## 5. Architectural Invariants Summary

1. **Zero Dual-Storage Drift**: `state.json` is always byte-for-byte regenerable from `events.jsonl`.
2. **Automatic Crash Recovery**: Incomplete writes never leave the system in an unrecoverable state.
3. **Pure Projection Logic**: State projection functions are pure and free of side effects.

---

[Previous: 10-03 POSIX Flock Advisory Locking](10-03-posix-flock-advisory-locking.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: Chapter 11 Index](../11-worktree-branching-honesty/index.md)
---

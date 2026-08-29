# Projection-Patch State Reconstruction & Torn-Tail Healing

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 10](./index.md) > 10-04 State Reconstruction

---

[⏮️ Previous: 10-03 POSIX Flock Advisory Locking](10-03-posix-flock-advisory-locking.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: Chapter 11: Worktree Branching & Honesty Gates](../11-worktree-branching-honesty/index.md)
---

## 1. State Reconstruction from Zero

If `state.json` is corrupted, deleted, or torn by a sudden kernel crash, the runtime executes a complete reconstruction from zero:

$$S_0 \xrightarrow{E_1} S_1 \xrightarrow{E_2} S_2 \dots \xrightarrow{E_n} S_n$$

```mermaid
flowchart TD
    Crash[Process Crash Detected] --> ReadLog[Read events.jsonl from Beginning]
    ReadLog --> ValidateHashes{Verify Merkle Hash Chain}
    ValidateHashes -->|Torn Tail Line Detected| TruncateTorn[Self-Heal: Truncate Incomplete Last Line]
    ValidateHashes -->|Clean| Fold[Fold Events: S_n = foldl(mutator, S_0, Events)]
    TruncateTorn --> Fold
    Fold --> WriteState[Atomic Write: state.json]
    WriteState --> Resume[Resume Execution Safely]
```

---

[⏮️ Previous: 10-03 POSIX Flock Advisory Locking](10-03-posix-flock-advisory-locking.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: Chapter 11: Worktree Branching & Honesty Gates](../11-worktree-branching-honesty/index.md)
---

# Track 8 Implementation Plan: Mind Feedback & Archival Syntax Architecture

**Target Plan File**: `docs/planning/mind-feedback-and-archival-syntax/PLAN.md`  
**Track**: Track 8 — Mind Feedback Queue, Task Queue, Pushbacks, Archival & Partition Syntax  
**Certification Status**: **CERTIFIED & APPROVED (5/5 Rounds Complete)** by `plan_critic_01`  
**Assigned Defects**:

1. `defect-mind-feedback-queue-syntax-error`
2. `defect-mind-task-queue-chunk-split-errors`
3. `defect-mind-pushbacks-and-rotate-syntax-errors`
4. `defect-mind-subchunk-missing-partitions`

---

## Level 1: Problem Statement & Root Cause Analysis

### 1.1 Defect IDs & High-Level Problem Formulation

- **`defect-mind-feedback-queue-syntax-error`**:
  SyntaxError unexpected closing brace in `feedback-queue-chunk2.ts:7:3` resulting from aborted monolithic chunk splitting. Legacy chunk files are obsolete and must be purged in favor of the canonical modular subpackage `olt/scripts/src/mind/feedback/queue/`.
- **`defect-mind-task-queue-chunk-split-errors`**:
  Oversized task queue files (`transitions.ts:405` LOC, `dequeue.ts:381` LOC) exceeding the $\le 300$ LOC budget, split chunk syntax anomalies (`task-queue-chunk1.ts`, `task-queue-chunk2.ts`), and duplicate export confusion around `renderCharterLine` across lifecycle and proposal brief modules.
- **`defect-mind-pushbacks-and-rotate-syntax-errors`**:
  Partition syntax errors (TS1005, TS1109, TS1128) in `pushbacks-chunk1.ts`, `pushbacks-chunk2.ts`, and `rotate-chunk2.ts` caused by dangling statements in pushback markdown parsing and generation rotation transactions.
- **`defect-mind-subchunk-missing-partitions`**:
  Module resolution failures (TS2307) caused by dangling relative import paths pointing to non-existent chunk files (`proposal-chunk5.ts`, `memory-chunk3.ts`, `feedback-queue-chunk1.ts`).

### 1.2 Line Coordinates & Codebase Grounding

- [`olt/scripts/src/task/queue/transitions.ts:1-405`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/task/queue/transitions.ts#L1-L405): 405 LOC exceeds 300 LOC budget. Completion logic (`completeTask`, `completeTaskUnlocked`, lines 228-405) will be extracted to `completion.ts`.
- [`olt/scripts/src/task/queue/dequeue.ts:1-381`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/task/queue/dequeue.ts#L1-L381): 381 LOC exceeds 300 LOC budget. Lease management logic (`claimTaskLease`, `renewTaskLease`, `releaseTaskLease`, `startTaskValidation`, lines 87-380) will be extracted to `lease.ts`.
- [`olt/scripts/src/task/queue/filters.ts:1-27`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/task/queue/filters.ts#L1-L27): 27 LOC containing only `TaskQueueStats` and `TaskQueueFilterOptions`. Consolidated into `types.ts`.
- [`olt/scripts/src/task/queue/lease-helpers.ts:1-88`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/task/queue/lease-helpers.ts#L1-L88): 88 LOC consolidated directly into `lease.ts`.
- [`olt/scripts/src/mind/proposals/brief/formatters.ts:9`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/mind/proposals/brief/formatters.ts#L9): Canonical definition of `renderCharterLine(status, sha)`.
- [`olt/scripts/src/mind/lifecycle/charter/index.ts:1-25`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/mind/lifecycle/charter/index.ts#L1-L25): Strict charter parsing exports without duplicating `renderCharterLine`.

---

## Level 2: Architectural Constraints & Invariants

1. **Physical LOC Budget ($\le 300$ LOC / file)**:
   - `olt/scripts/src/task/queue/types.ts`: ~285 LOC
   - `olt/scripts/src/task/queue/lease.ts`: ~278 LOC
   - `olt/scripts/src/task/queue/maintenance.ts`: 220 LOC
   - `olt/scripts/src/task/queue/transitions.ts`: ~210 LOC
   - `olt/scripts/src/task/queue/storage.ts`: 180 LOC
   - `olt/scripts/src/task/queue/completion.ts`: ~175 LOC
   - `olt/scripts/src/task/queue/dequeue.ts`: ~160 LOC
   - `olt/scripts/src/task/queue/locks.ts`: 160 LOC
   - `olt/scripts/src/task/queue/enqueue.ts`: 140 LOC
   - `olt/scripts/src/task/queue/index.ts`: ~80 LOC
2. **Directory Density Budget ($\le 10$ files / directory)**:
   - `olt/scripts/src/task/queue/`: Exactly 10 files
   - `olt/scripts/src/mind/feedback/`: 3 files + 2 subdirectories
   - `olt/scripts/src/mind/feedback/queue/`: 8 files
   - `olt/scripts/src/mind/feedback/pushbacks/`: 5 files
   - `olt/scripts/src/mind/lifecycle/charter/`: 4 files
   - `olt/scripts/src/mind/archival/rotate/`: 5 files
   - `olt/scripts/src/mind/archival/completed/`: 5 files
   - `olt/scripts/src/mind/archival/quiesce/`: 3 files
   - `olt/scripts/src/mind/archival/recycler/`: 6 files
   - `olt/scripts/src/mind/memory/core/`: 9 files
   - `olt/scripts/src/mind/memory/digest/`: 6 files
   - `olt/scripts/src/mind/memory/sources/`: 3 files
   - `olt/scripts/src/mind/memory/value/`: 3 files
3. **Strict Named Facades (0 Wildcard `export *`)**: Every barrel file exports symbols explicitly by name.
4. **Zero Comments Policy**: 0 comments across all production code files.
5. **Zero `any` & Strict Type Safety**: 0 `any`, 0 suppressions across all modules.

---

## Level 3: 8-Vector Expansion Matrix

| Vector                       | Edge Condition / Threat Model                                                               | Hardened Mitigation & Invariant Assertion                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **V1: EMPTY_PAYLOAD**        | Empty task queue file, 0-byte JSONL, or empty feedback list `[]`                            | `readTaskQueue` and `readFeedbackQueue` return `[]` safely without throwing; empty string lines are skipped.                              |
| **V2: TIMEOUT_STAGNATION**   | Expired lease blocking dependent task execution                                             | `reclaimExpiredLeasesUnlocked` automatically expires stale leases and unblocks candidate tasks on dequeue.                                |
| **V3: CONCURRENCY_MUTATION** | Concurrent process writes to JSONL queue files                                              | `withTaskQueueTransaction` / `withFeedbackQueueTransaction` use flock file locks and atomic temp file renames.                            |
| **V4: HOST_BOUNDARY**        | Corrupt/malformed line in queue file                                                        | `readTaskQueueStrict` detects JSON parse error or missing required schema properties and throws `HarnessError("INVALID_ARGUMENT")`.       |
| **V5: STATE_TRANSITION**     | Illegal task transition (e.g. `COMPLETED` $\to$ `IN_PROGRESS` or `FAILED` $\to$ `ADMITTED`) | Explicit state assertions in `admitTaskUnlocked`, `claimTaskLeaseUnlocked`, `completeTaskUnlocked` throw `HarnessError("INVALID_STATE")`. |
| **V6: TYPE_INVARIANT**       | Single active lease invariant violation                                                     | `assertSingleActiveLease` prevents an agent holding more than 1 concurrent unexpired task lease.                                          |
| **V7: CLI_TELEMETRY**        | Queue stats aggregation on large queues                                                     | `getQueueStats` accurately counts all 10 queue states, active leases, and expired leases in $O(N)$ single pass.                           |
| **V8: ADVERSARIAL_GATE**     | Attempt to complete task with invalid lease token or unverified proof                       | `validateCompletionReceipts` and lease token comparison enforce authenticity before completing tasks.                                     |

---

## Level 4: Disjoint Write Scope Decomposition

### Write Scope 1: Task Queue Modular Partitioning

- **Files**:
  - `olt/scripts/src/task/queue/types.ts`: Integrate `TaskQueueStats` & `TaskQueueFilterOptions`.
  - `olt/scripts/src/task/queue/filters.ts`: Removed (consolidated into `types.ts`).
  - `olt/scripts/src/task/queue/lease-helpers.ts`: Removed (consolidated into `lease.ts`).
  - `olt/scripts/src/task/queue/lease.ts`: Created (~278 LOC).
  - `olt/scripts/src/task/queue/dequeue.ts`: Refactored (~160 LOC).
  - `olt/scripts/src/task/queue/completion.ts`: Created (~175 LOC).
  - `olt/scripts/src/task/queue/transitions.ts`: Refactored (~210 LOC).
  - `olt/scripts/src/task/queue/index.ts`: Updated named re-exports.

### Write Scope 2: Feedback Queue & Pushbacks Subpackages

- **Files**:
  - `olt/scripts/src/mind/feedback/queue/`: 8 files verified for zero chunk artifacts.
  - `olt/scripts/src/mind/feedback/pushbacks/`: 5 files verified for zero chunk artifacts.

### Write Scope 3: Lifecycle Charter Verification

- **Files**:
  - `olt/scripts/src/mind/lifecycle/charter/index.ts`: Verifies charter parsing without duplicate `renderCharterLine`.

### Write Scope 4: Archival Rotate & Memory Core Subpackages

- **Files**:
  - `olt/scripts/src/mind/archival/rotate/`: 5 files verified.
  - `olt/scripts/src/mind/memory/core/`: 9 files verified.

---

## Level 5: Topological Execution DAG & Brent Concurrency Waves

- **Total Work ($W$)**: 4 work units.
- **Span ($S$)**: 2 sequential steps.
- **Parallelism ($P = \lceil W/S \rceil$)**: 2 concurrent lanes.

```
Wave 1 (Leaf Module Refactoring & Subpackage Consolidation):
  ├── Task 1.1: Task Queue Types Integration & Lease/Completion Extraction [types.ts, lease.ts, completion.ts, dequeue.ts, transitions.ts]
  └── Task 1.2: Feedback Queue & Pushback Ingestion Modular Cleanup [feedback/queue/, feedback/pushbacks/]

Wave 2 (Barrel Facades & Generation Rotation Verification):
  ├── Task 2.1: Task Queue Barrel Facade Lineage Alignment [task/queue/index.ts, charter/index.ts]
  └── Task 2.2: Archival Rotate & Memory Facade Integrity Audit [archival/rotate/, memory/core/]
```

---

## Level 6: Fast Incremental Verification Gates

```bash
# Gate 1: Feedback Queue & Category Engine Tests
bun test tests/unit/mind/feedback-queue.test.ts
bun test tests/unit/mind/feedback-category.test.ts

# Gate 2: Task Queue Stateful Transitions, Leases & Dequeue Tests
bun test tests/unit/task/queue/task-queue.test.ts
bun test tests/unit/task/queue/dequeue.test.ts

# Gate 3: Pushback Ingestion & Markdown Parsing Tests
bun test tests/unit/mind/pushbacks.test.ts

# Gate 4: Generational Archival & Mind Generation Rotation Tests
bun test tests/unit/mind/mind-rotate.test.ts
bun test tests/unit/mind/generational-archival.test.ts

# Gate 5: BM25 Cognitive Memory Indexing & Querying Tests
bun test tests/unit/mind/memory.test.ts

# Gate 6: Repository-Wide Strict TypeScript Typecheck
bun run typecheck
```

---

## Level 7: Adversarial Counterfactual Falsifiability Probes (AGP)

1. **Probe AGP-1 (Single Active Lease Guarantee)**:
   - Attempt to claim two leases concurrently for the same agent ID; verify `assertSingleActiveLease` throws `HarnessError("INVALID_STATE")`.
2. **Probe AGP-2 (Atomic Persistence Commit Hook Failure)**:
   - Introduce synthetic commit failure before rename via `__setFeedbackQueuePersistenceTestHook`; verify original queue remains 100% intact and uncorrupted.
3. **Probe AGP-3 (Charter & Proposal Brief Uniqueness)**:
   - Attempt to re-export `renderCharterLine` in `lifecycle/charter/index.ts`; verify build typecheck rejects namespace collision.
4. **Probe AGP-4 (Zero Sub-Chunk Import Leakage)**:
   - Verify zero relative imports to `*-chunk*.ts` exist in any source file; typecheck produces exit code 0.

---

## Level 8: Sealing, Release, & Turn 1 Zero-Exploration Readiness Briefing

- **Zero-Exploration Ready**: Exact symbol signatures, line budgets, and file paths established.
- **Deterministic Verification**: All 6 gates executable immediately.
- **Certified By**: `plan_critic_01` (Official Executive Certification: Round 5 Approved).

# Pillar 4: Autonomous Mind Creative Overload & Robust Queue Drainage

**Directive Reference**: `p91`  
**Status**: ✅ **APPROVED & LOCKED BY USER**  
**Location**: `docs/planning/generation-8/PILLAR_4_MIND_OVERLOAD_AND_QUEUE_DRAINAGE.md`

---

## 1. Problem Statement: Idling Supervisors & Zombie Queue Accumulation

1. **Mind Idling**: In prior versions, when the queue was small or empty, Mind entered passive standby loops ("idle minigames") instead of aggressively researching, evaluating modern standards, and generating high-leverage work streams.
2. **Zombie Queue Items**: Completed tasks, processed feedback, and resolved blunders were not consistently drained into canonical archival files, causing clutter and state ambiguity.

---

## 2. Core Architecture: Non-Idle Overload & Deterministic Archival

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                   MIND CREATIVE OVERLOAD & BULLETPROOF QUEUE DRAINAGE                            │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  [ Mind Creative Overload Cadence ]                                                              │
│  • Mind continuously inspects `harness.ts doctor` and `report` metrics.                          │
│  • When active fleets are below maximum capacity:                                                │
│    - Mind executes autonomous discovery tools (`scanCodeQuality`, `scanTestCoverage`, etc.).     │
│    - Researches high-leverage architectural expansions and modern design patterns.               │
│    - Overloads the DAG queue with rich, highly parallelizable multi-task streams ($P > 1$).      │
│                                                                                                  │
│  [ Clean FIFO Queue Drainage ]                                                                   │
│  • Canonical Queue Storage under `.capsules/mind/queue/`:                                        │
│    ├── `feedback-queue.jsonl` (Active pending backlog)                                           │
│    ├── `completed-tasks.jsonl` (Empirical completion archive with commit SHAs and test receipts)│
│    ├── `blunders.jsonl` (Active unresolved blunders)                                             │
│    └── `completed-blunders.jsonl` (Resolved blunders with remediation proofs)                   │
│  • Automatic FIFO popping and archival upon run seal ensures 0 zombie items in active queues.    │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Approved & Locked Decisions

### ✅ Decision 4.1 — Strict Non-Idle Invariant

- Mind is strictly forbidden from reporting "idle in standby". When the queue is low or empty, Mind actively researches the codebase and web standards to formulate rich, parallelizable backlogs.

### ✅ Decision 4.2 — Automated FIFO Archival

- Completed tasks and blunders are automatically drained into `completed-tasks.jsonl` and `completed-blunders.jsonl` upon run seal, permanently removing processed items from the active queue.

### ✅ Decision 4.3 — Single Source of Truth (`.capsules/mind/queue/`)

- All queue operations are consolidated strictly under `.capsules/mind/queue/`, eliminating root-level legacy JSONL drift.

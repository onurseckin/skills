# Pillar 4: Autonomous Mind Creative Overload, FIFO Backlog Archival & Visualizer Telemetry

**Directive Reference**: `p92`  
**Status**: 🔒 **LOCKED & READY FOR IMPLEMENTATION**  
**Location**: `docs/planning/plan-92/PILLAR_4_MIND_OVERLOAD_AND_QUEUE_DRAINAGE.md`

---

## 1. Problem Statement: Passive Idling & Lost Visualizer Telemetry

1. **Mind Passive Idling**: Without an active backlog, supervisors often enter passive polling loops rather than actively researching improvements, auditing test coverage, and generating high-leverage parallel tasks ($P > 1$).
2. **Zombie Queue Clutter**: Completed tasks and resolved defects remaining in active queue files create cognitive clutter and state ambiguity.
3. **Telemetry Blindness**: When agents read/write arbitrary files directly, visualizer tools (such as ASCII Sugiyama DAGs and graph visualizers) cannot reconstruct the real-time execution trace.

---

## 2. Core Architecture: Creative Overload, FIFO Drainage & Telemetry Streams

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                   MIND CREATIVE OVERLOAD & BULLETPROOF BACKLOG DRAINAGE                          │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  [ STEP 1: Autonomous Creative Overload Cadence ]                                                │
│  • When active fleets are below concurrency ceiling:                                             │
│    - Mind runs discovery tools (`scanCodeQuality`, `scanTestCoverage`, `scanCharterGaps`).       │
│    - Researches high-leverage architectural expansions and modern design patterns.               │
│    - Populates `olt/backlog.jsonl` with rich, highly parallelizable multi-task streams ($P > 1$).│
│                                │                                                                 │
│                                ▼                                                                 │
│  [ STEP 2: Deterministic FIFO Backlog Archival on Git Commit ]                                   │
│  • Storage under `olt/`:                                                                         │
│    ├── `backlog.jsonl`           <-- Active pending tasks and features                           │
│    ├── `completed-tasks.jsonl`   <-- Permanent archive with commit SHAs and test receipts        │
│    ├── `defects.jsonl`           <-- Active identified defects/remediations                      │
│    └── `completed-defects.jsonl` <-- Permanent archive of verified defect remediations          │
│  • Upon release commit, processed items are atomically popped from `backlog.jsonl` and appended │
│    to `completed-tasks.jsonl`, guaranteeing 0 zombie records in the active backlog!              │
│                                │                                                                 │
│                                ▼                                                                 │
│  [ STEP 3: Real-Time Visualizer Telemetry Stream (`olt/telemetry.jsonl`) ]                       │
│  • Every Harness CLI command emits structured JSON events:                                       │
│    `{ timestamp, actor, task_id, wave, action, token_estimate, status }`                         │
│  • Feeds live ASCII Sugiyama DAGs and graph visualizers with 100% precision.                    │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Target Implementation Files in Skill Monorepo

| Target File Path                                                     | Planned Modifications & Responsibilities                                                  |
| :------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| `orchestrating-long-tasks/scripts/src/mind/smart-task-manager.ts`    | Implements automated FIFO popping from `backlog.jsonl` into `completed-tasks.jsonl`.      |
| `orchestrating-long-tasks/scripts/src/mind/blunder-manager.ts`       | Implements automated defect archival from `defects.jsonl` into `completed-defects.jsonl`. |
| `orchestrating-long-tasks/scripts/src/mind/discovery-engine.ts`      | Autonomous code quality, coverage, and charter gap scanner.                               |
| `orchestrating-long-tasks/scripts/src/reporting/telemetry-stream.ts` | Structured event logger for visualizer ingestion.                                         |
| `tests/unit/mind/backlog-drainage.test.ts`                           | Unit tests for atomic FIFO popping and archival verification.                             |

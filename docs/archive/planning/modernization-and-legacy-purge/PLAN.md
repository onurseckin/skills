# Architecture Plan: Modernization & Legacy Purge

## 1. Executive Summary & Core Principle

**Principle:** Modern systems only. Zero backward compatibility debt.

The repository will operate exclusively against the modern `.olt/` governance and execution architecture. All legacy migration shims, multi-variant fallback ladders (e.g. searching `.olt/capsules/`, `.olt/`, `FEEDBACK_QUEUE.jsonl`, `TODO_*`), legacy pre-ledger readers, and obsolete test fixtures will be permanently excised.

---

## 2. Inventory of Legacy Systems to Purge

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          LEGACY SYSTEMS PURGE LIST                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  [ 1. Legacy Capsule & File Resolution Fallbacks ]                              │
│    • Purge multi-variant resolution ladders across paths.ts, feedback-queue.ts, │
│      blunders.ts, completed-tasks.ts, archival.ts, watchdog-manager.ts           │
│    • Single modern layout:                                                      │
│        - Policy:             .olt/policy.json                                   │
│        - Backlog:            .olt/backlog.jsonl                                 │
│        - Completed Tasks:    .olt/completed-tasks.jsonl                         │
│        - Defects:            .olt/defects.jsonl                                 │
│        - Completed Defects:  .olt/completed-defects.jsonl                      │
│        - Telemetry:          .olt/telemetry.jsonl                               │
│        - Memory:             .olt/memory.json                                   │
│        - Watchdogs:          .olt/watchdogs.json                                │
│        - Capsules:           .olt/capsules/<run-id>/                            │
│        - Ephemeral Scratch:  .olt/scratch/                                      │
│                                                                                 │
│  [ 2. Legacy Migration Mechanics & Pre-Ledger Loaders ]                         │
│    • Remove migrateFeedbackQueue(), migrateCompletedTasksLedger(), etc.         │
│    • Remove legacy pre-ledger state transition shims                            │
│    • Remove legacy capsule fixture generators (legacy-capsule-fixture.ts)       │
│                                                                                 │
│  [ 3. Legacy Todo & Directory Fallbacks ]                                       │
│    • Remove TODO_* constants and useTodo flags                                  │
│    • Remove legacy capsule archival movers (.olt/capsules/archive/)                 │
│                                                                                 │
│  [ 4. Stale Role & Command Inconsistencies ]                                    │
│    • Remove references to retired command orchestrator:run                      │
│    • Ensure meta-audit and task:check are registered directly in CLI registry   │
│    • Align role contracts (orchestrator.md, coordinator.md) to modern tiers     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. High-Cohesion Source Modularization (`olt/scripts/src/`)

Reorganize 25+ top-level directories in `olt/scripts/src/` into 5 cohesive namespaces:

```text
olt/scripts/src/
├── core/                  # Fundamental primitives & infrastructure
│   ├── contracts/         # JSON schemas, packet types, evidence types
│   ├── errors/            # HarnessError and exit code definitions
│   ├── json/              # Canonical JSON serialization & SHA-256
│   ├── config/            # Policy loader & harness configurations
│   └── paths/             # Clean .olt/ path resolvers (single source of truth)
│
├── engine/                # Execution & planning orchestration
│   ├── scheduler/         # Topology analysis, Brent Work/Span (P = W / S), DAG
│   ├── planner/           # Requirements parsing, enhanced plan, auto-partition
│   ├── compiler/          # Graph compiling, revision guards, scope analysis
│   ├── store/             # Capsule loading, transactions, integrity verification
│   ├── runner/            # Argv execution, command recording, sandboxing
│   └── worktree/          # Git worktree lifecycle, isolation, reclaim
│
├── mind/                  # Tier 0 Product Owner & supervisory intelligence
│   ├── po/                # Infinite PO mode, candidate intake, atomic dispatch
│   ├── admission/         # 6 admission gates, falsifiability verification
│   ├── memory/            # Cross-generational cognitive memory indexing
│   ├── telemetry/         # Work/Span metrics, APCA badges, live tracer
│   └── budget/            # Pulse limits, quiet hours, wall-clock tracking
│
├── cli/                   # User and agent command interface
│   ├── registry/          # Declarative command definitions & flag specs
│   ├── commands/          # Command handlers (clean colon syntax)
│   ├── options/           # Flag parsers & validation
│   └── formatters/        # Compact markdown briefs (< 30 lines) & tables
│
└── reporting/             # Forensics, observability & diagnostics
    ├── meta-auditor/      # 7 behavioral heuristics, efficiency scoring
    ├── diagnostics/       # Script-backed receipts, doctor, health checks
    └── renderers/         # Sugiyama ASCII DAG badges, Unicode trees
```

---

## 4. Test Namespace Mirroring (`tests/unit/olt/`)

Align `tests/unit/` 1:1 with `olt/scripts/src/`:

```text
tests/unit/olt/
├── core/
│   ├── contracts/
│   ├── errors/
│   ├── json/
│   ├── config/
│   └── paths/
├── engine/
│   ├── scheduler/
│   ├── planner/
│   ├── compiler/
│   ├── store/
│   ├── runner/
│   └── worktree/
├── mind/
│   ├── po/
│   ├── admission/
│   ├── memory/
│   ├── telemetry/
│   └── budget/
├── cli/
│   ├── registry/
│   ├── commands/
│   ├── options/
│   └── formatters/
└── reporting/
    ├── meta-auditor/
    ├── diagnostics/
    └── renderers/
```

---

## 5. Decisions for Alignment

| #      | Topic            | Proposed Modern Direction                                                | Alternative / Legacy                             |
| :----- | :--------------- | :----------------------------------------------------------------------- | :----------------------------------------------- |
| **D1** | Capsule Location | Strictly `.olt/capsules/<run-id>/`                                       | Allow root `.olt/capsules/` fallback (REJECTED)  |
| **D2** | Governance Files | Strictly `.olt/*.jsonl` and `.olt/*.json`                                | Support old uppercase/queue fallbacks (REJECTED) |
| **D3** | Migration Shims  | Drop all migration functions; files are already in modern format         | Keep runtime migration logic (REJECTED)          |
| **D4** | Test Fixtures    | Dynamic in-memory fixture generators in `tests/support/`                 | Checked-in static JSON files (REJECTED)          |
| **D5** | CLI Commands     | Register `task:check` and `meta-audit` as top-level first-class commands | Keep loose/unregistered names (REJECTED)         |
